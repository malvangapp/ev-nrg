/**
 * EV-NRG backend. Paste into the Google Sheet's script editor (Extensions > Apps Script),
 * run setup() once, then deploy as a web app (execute as: me, access: anyone).
 *
 * Columns are found by their header name (case and punctuation are ignored), so the
 * order of columns in the sheet does not matter and missing columns are added at the end.
 */
const SCHEMA = {
  Charges: ['id', 'date', 'car', 'kwh', 'price_dkk', 'created', 'updated', 'non_home'],
  Odometer: ['id', 'date', 'car', 'km'],
  Cars: ['car_id', 'name', 'km_at_purchase', 'image', 'license_plate'],
  // Tire register: one row per physical tire, belonging to one car.
  TireStock: ['id', 'car', 'name', 'type', 'start_km'],
  // Fitting log: one row each time a tire goes on a car; km_off is empty while it is still mounted.
  TireLog: ['id', 'tire', 'position', 'date_on', 'km_on', 'date_off', 'km_off'],
};
const TIRE_POSITIONS = ['FL', 'FR', 'RL', 'RR']; // front left/right, rear left/right
const TIRE_TYPES = ['summer', 'winter', 'all'];
// Header spellings accepted in addition to the schema name.
const ALIASES = { non_home: ['ude', 'udehjemme', 'ikkehjemme', 'vaekhjemme', 'away', 'public'] };
// A row only counts as data when this column has a value.
const KEY_COLUMN = { Charges: 'date', Odometer: 'date', Cars: 'car_id', TireStock: 'name', TireLog: 'tire' };
const TEXT_COLUMNS = { Charges: ['date', 'created', 'updated'], Odometer: ['date'], TireLog: ['date_on', 'date_off'] };
const TOKEN_DAYS = 180;

function setup() {
  const ss = SpreadsheetApp.getActive();
  Object.keys(SCHEMA).forEach(function (name) {
    const sheet = ss.getSheetByName(name) || ss.insertSheet(name);
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, SCHEMA[name].length).setValues([SCHEMA[name]]).setFontWeight('bold');
    }
    const map = columnMap(sheet, name); // adds any missing column
    sheet.setFrozenRows(1);
    (TEXT_COLUMNS[name] || []).forEach(function (col) {
      sheet.getRange(2, map[col] + 1, Math.max(sheet.getMaxRows() - 1, 1), 1).setNumberFormat('@');
    });
  });
  const charges = ss.getSheetByName('Charges');
  const nonHome = columnMap(charges, 'Charges').non_home;
  charges.getRange(2, nonHome + 1, Math.max(charges.getMaxRows() - 1, 1), 1).insertCheckboxes();

  const cars = ss.getSheetByName('Cars');
  if (cars.getLastRow() < 2) {
    cars.getRange(2, 1, 2, 4).setValues([
      ['elroq', 'Skoda Elroq', 0, 'assets/cars/elroq.png'],
      ['id3', 'VW ID.3', 0, 'assets/cars/id3.png'],
    ]);
  }
  const first = ss.getSheetByName('Sheet1') || ss.getSheetByName('Ark1');
  if (first && ss.getSheets().length > 1 && first.getLastRow() === 0) ss.deleteSheet(first);

  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('TOKEN_SECRET')) props.setProperty('TOKEN_SECRET', Utilities.getUuid() + Utilities.getUuid());
  if (!props.getProperty('PASSPHRASE')) props.setProperty('PASSPHRASE', 'skift-mig');
  Logger.log('Færdig. Sæt PASSPHRASE under Project Settings > Script properties.');
}

function doGet() {
  return json({ ok: true, name: 'EV-NRG', version: 5 });
}

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    if (req.action === 'login') return json(login(req.passphrase));
    if (!validToken(req.token)) return json({ ok: false, code: 'AUTH', error: 'Log ind igen' });
    const handler = HANDLERS[req.action];
    if (!handler) return json({ ok: false, error: 'Ukendt handling' });
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      handler(req);
      SpreadsheetApp.flush();
      return json(getAll());
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return json({ ok: false, error: err.userMessage || 'Der opstod en fejl: ' + err });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function fail(msg) {
  const e = new Error(msg);
  e.userMessage = msg;
  throw e;
}

// ---------- auth ----------
function sign(payload) {
  const secret = PropertiesService.getScriptProperties().getProperty('TOKEN_SECRET');
  const bytes = Utilities.computeHmacSha256Signature(payload, secret);
  return Utilities.base64EncodeWebSafe(bytes);
}

function login(passphrase) {
  const expected = PropertiesService.getScriptProperties().getProperty('PASSPHRASE');
  if (!expected || passphrase !== expected) {
    Utilities.sleep(1500);
    return { ok: false, error: 'Forkert adgangskode' };
  }
  const exp = String(Date.now() + TOKEN_DAYS * 86400000);
  return { ok: true, token: exp + '.' + sign(exp) };
}

function validToken(token) {
  if (!token || token.indexOf('.') < 0) return false;
  const parts = token.split('.');
  return Number(parts[0]) > Date.now() && sign(parts[0]) === parts[1];
}

// ---------- data access ----------
function norm(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Returns the tab; a tab added in a newer version (e.g. Tires) is created on first use.
function sheetOf(name) {
  const ss = SpreadsheetApp.getActive();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, SCHEMA[name].length).setValues([SCHEMA[name]]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    (TEXT_COLUMNS[name] || []).forEach(function (col) {
      sheet.getRange(2, SCHEMA[name].indexOf(col) + 1, Math.max(sheet.getMaxRows() - 1, 1), 1).setNumberFormat('@');
    });
  }
  return sheet;
}

// Maps each schema field to its 0-based column by header name; adds a header at the end when missing.
function columnMap(sheet, name) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(norm);
  const map = {};
  SCHEMA[name].forEach(function (field) {
    const accepted = [norm(field)].concat(ALIASES[field] || []);
    for (let i = 0; i < headers.length; i++) {
      if (accepted.indexOf(headers[i]) >= 0) { map[field] = i; return; }
    }
    const col = sheet.getLastColumn() + 1;
    sheet.getRange(1, col).setValue(field).setFontWeight('bold');
    map[field] = col - 1;
  });
  return map;
}

function readSheet(name) {
  const sheet = sheetOf(name);
  const map = columnMap(sheet, name);
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const width = sheet.getLastColumn();
  const key = map[KEY_COLUMN[name]];
  const out = [];
  sheet.getRange(2, 1, last - 1, width).getValues().forEach(function (r, i) {
    if (r[key] === '') return;
    const o = { _row: i + 2 };
    SCHEMA[name].forEach(function (field) {
      let v = r[map[field]];
      if (v instanceof Date) v = Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      o[field] = v;
    });
    out.push(o);
  });
  return out;
}

// Rows typed straight into the sheet have no id yet; give them one so they can be edited in the app.
function healIds(name) {
  const sheet = sheetOf(name);
  const map = columnMap(sheet, name);
  const last = sheet.getLastRow();
  if (last < 2) return;
  const width = sheet.getLastColumn();
  sheet.getRange(2, 1, last - 1, width).getValues().forEach(function (r, i) {
    if (r[map[KEY_COLUMN[name]]] !== '' && r[map.id] === '') sheet.getRange(i + 2, map.id + 1).setValue(Utilities.getUuid());
  });
}

function isTrue(v) {
  return v === true || /^(true|ja|yes|1|x|✓)$/i.test(String(v).trim());
}

function getAll() {
  healIds('Charges');
  healIds('Odometer');
  healIds('TireStock');
  healIds('TireLog');
  const num = function (v) { return Number(v) || 0; };
  return {
    ok: true,
    cars: readSheet('Cars').map(function (c) { return { id: c.car_id, name: c.name, kmAtPurchase: num(c.km_at_purchase), image: c.image, licensePlate: String(c.license_plate || '') }; }),
    tires: readSheet('TireStock').map(function (t) { return { id: String(t.id), car: t.car, name: String(t.name), type: t.type, startKm: num(t.start_km) }; }),
    fittings: readSheet('TireLog').map(function (f) {
      return { id: String(f.id), tire: String(f.tire), pos: String(f.position), dateOn: String(f.date_on || ''), kmOn: num(f.km_on), dateOff: String(f.date_off || ''), kmOff: f.km_off === '' ? null : num(f.km_off) };
    }),
    charges: readSheet('Charges').map(function (c) { return { id: String(c.id), date: String(c.date), car: c.car, kwh: num(c.kwh), price: num(c.price_dkk), nonHome: isTrue(c.non_home) }; }),
    odometer: readSheet('Odometer').map(function (o) { return { id: String(o.id), date: String(o.date), car: o.car, km: num(o.km) }; }),
  };
}

function findRow(name, id) {
  const hit = readSheet(name).filter(function (r) { return String(r[SCHEMA[name][0]]) === String(id); })[0];
  if (!hit) fail('Linjen findes ikke længere');
  return { sheet: sheetOf(name), row: hit._row, map: columnMap(sheetOf(name), name) };
}

function setFields(t, values) {
  Object.keys(values).forEach(function (field) {
    t.sheet.getRange(t.row, t.map[field] + 1).setValue(values[field]);
  });
}

function appendRecord(name, values) {
  const sheet = sheetOf(name);
  const map = columnMap(sheet, name);
  const row = [];
  for (let i = 0; i < sheet.getLastColumn(); i++) row.push('');
  Object.keys(values).forEach(function (field) { row[map[field]] = values[field]; });
  sheet.appendRow(row);
}

function carExists(id) {
  if (!readSheet('Cars').some(function (c) { return c.car_id === id; })) fail('Ukendt bil');
}

function checkDate(d) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '')) fail('Ugyldig dato');
}

function checkNumber(v, label, min) {
  if (typeof v !== 'number' || !isFinite(v) || v < min) fail('Ugyldig ' + label);
}

// ---------- handlers ----------
function charge(req) {
  carExists(req.car);
  checkDate(req.date);
  checkNumber(req.kwh, 'kWh', 0.001);
  checkNumber(req.price, 'pris', 0);
}

function checkOdometer(req, selfId) {
  carExists(req.car);
  checkDate(req.date);
  checkNumber(req.km, 'km-stand', 0);
  readSheet('Odometer').forEach(function (o) {
    if (o.car !== req.car || String(o.id) === String(selfId)) return;
    const km = Number(o.km);
    if ((o.date <= req.date && km > req.km) || (o.date >= req.date && km < req.km)) {
      fail('Km-standen passer ikke med en anden aflæsning (' + o.date + ': ' + km + ' km)');
    }
  });
}

const HANDLERS = {
  getAll: function () {},
  addCharge: function (r) {
    charge(r);
    const now = new Date().toISOString();
    appendRecord('Charges', {
      id: Utilities.getUuid(), date: r.date, car: r.car, kwh: r.kwh, price_dkk: r.price,
      created: now, updated: now, non_home: r.nonHome === true,
    });
  },
  updateCharge: function (r) {
    charge(r);
    setFields(findRow('Charges', r.id), {
      date: r.date, car: r.car, kwh: r.kwh, price_dkk: r.price,
      updated: new Date().toISOString(), non_home: r.nonHome === true,
    });
  },
  deleteCharge: function (r) {
    const t = findRow('Charges', r.id);
    t.sheet.deleteRow(t.row);
  },
  addOdometer: function (r) {
    checkOdometer(r, null);
    appendRecord('Odometer', { id: Utilities.getUuid(), date: r.date, car: r.car, km: r.km });
  },
  updateOdometer: function (r) {
    checkOdometer(r, r.id);
    setFields(findRow('Odometer', r.id), { date: r.date, car: r.car, km: r.km });
  },
  deleteOdometer: function (r) {
    const t = findRow('Odometer', r.id);
    t.sheet.deleteRow(t.row);
  },
  updateCar: function (r) {
    const values = {};
    if (r.kmAtPurchase !== undefined) {
      checkNumber(r.kmAtPurchase, 'km ved køb', 0);
      values.km_at_purchase = r.kmAtPurchase;
    }
    if (r.licensePlate !== undefined) {
      if (typeof r.licensePlate !== 'string' || r.licensePlate.length > 12) fail('Ugyldig nummerplade');
      values.license_plate = r.licensePlate.trim().toUpperCase();
    }
    setFields(findRow('Cars', r.id), values);
  },
  addTire: function (r) {
    carExists(r.car);
    const values = tireValues(r);
    const count = r.count === undefined ? 1 : r.count;
    if (typeof count !== 'number' || count < 1 || count > 8 || count % 1) fail('Ugyldigt antal');
    for (let i = 1; i <= count; i++) {
      appendRecord('TireStock', {
        id: Utilities.getUuid(), car: r.car, name: count > 1 ? values.name + ' ' + i : values.name,
        type: values.type, start_km: values.start_km,
      });
    }
  },
  updateTire: function (r) {
    setFields(findRow('TireStock', r.id), tireValues(r));
  },
  deleteTire: function (r) {
    // remove its fittings first (bottom-up so row numbers stay valid), then the tire itself
    readSheet('TireLog').filter(function (f) { return String(f.tire) === String(r.id); })
      .map(function (f) { return f._row; }).sort(function (a, b) { return b - a; })
      .forEach(function (row) { sheetOf('TireLog').deleteRow(row); });
    const t = findRow('TireStock', r.id);
    t.sheet.deleteRow(t.row);
  },
  // Put the four tires that are on the car today into the register, fitted from the given km.
  initTires: function (r) {
    carExists(r.car);
    if (readSheet('TireStock').some(function (t) { return t.car === r.car; })) fail('Der er allerede dæk registreret');
    if (TIRE_TYPES.indexOf(r.type) < 0) fail('Ugyldig dæktype');
    checkNumber(r.km, 'km-stand', 0);
    if (r.date) checkDate(r.date);
    const label = { summer: 'Sommer', winter: 'Vinter', all: 'Helår' }[r.type];
    TIRE_POSITIONS.forEach(function (pos, i) {
      const id = Utilities.getUuid();
      appendRecord('TireStock', { id: id, car: r.car, name: label + ' ' + (i + 1), type: r.type, start_km: 0 });
      appendRecord('TireLog', { id: Utilities.getUuid(), tire: id, position: pos, date_on: r.date || '', km_on: r.km, date_off: '', km_off: '' });
    });
  },
  // assignments: [{ pos, tire }]. A tire already on that position is taken off (and goes to stock).
  mountTires: function (r) {
    carExists(r.car);
    checkDate(r.date);
    checkNumber(r.km, 'km-stand', 0);
    if (!Array.isArray(r.assignments) || !r.assignments.length) fail('Vælg mindst ét dæk');
    const stock = readSheet('TireStock');
    const open = openFittings(stock);
    const seenPos = {};
    const seenTire = {};
    r.assignments.forEach(function (a) {
      if (TIRE_POSITIONS.indexOf(a.pos) < 0) fail('Ugyldig dækposition');
      if (seenPos[a.pos] || seenTire[a.tire]) fail('Samme plads eller dæk er valgt to gange');
      seenPos[a.pos] = seenTire[a.tire] = true;
      const tire = stock.filter(function (t) { return String(t.id) === String(a.tire); })[0];
      if (!tire || tire.car !== r.car) fail('Dækket hører ikke til denne bil');
      if (open.some(function (f) { return String(f.tire) === String(a.tire); })) fail('Dækket "' + tire.name + '" er allerede monteret');
    });
    r.assignments.forEach(function (a) { closeAt(open, r.car, a.pos, r.date, r.km, stock); });
    r.assignments.forEach(function (a) {
      appendRecord('TireLog', { id: Utilities.getUuid(), tire: a.tire, position: a.pos, date_on: r.date, km_on: r.km, date_off: '', km_off: '' });
    });
  },
  // Take the tires on these positions off the car (they go to stock).
  unmountTires: function (r) {
    carExists(r.car);
    checkDate(r.date);
    checkNumber(r.km, 'km-stand', 0);
    if (!Array.isArray(r.positions) || !r.positions.length) fail('Vælg mindst ét dæk');
    const stock = readSheet('TireStock');
    const open = openFittings(stock);
    r.positions.forEach(function (pos) {
      if (TIRE_POSITIONS.indexOf(pos) < 0) fail('Ugyldig dækposition');
      closeAt(open, r.car, pos, r.date, r.km, stock);
    });
  },
  updateFitting: function (r) {
    checkDate(r.dateOn);
    checkNumber(r.kmOn, 'km-stand', 0);
    const values = { date_on: r.dateOn, km_on: r.kmOn, date_off: '', km_off: '' };
    if (r.kmOff !== null && r.kmOff !== undefined) {
      checkDate(r.dateOff);
      checkNumber(r.kmOff, 'km-stand', 0);
      if (r.kmOff < r.kmOn) fail('Km-standen ved afmontering er lavere end ved montering');
      values.date_off = r.dateOff;
      values.km_off = r.kmOff;
    }
    setFields(findRow('TireLog', r.id), values);
  },
  deleteFitting: function (r) {
    const t = findRow('TireLog', r.id);
    t.sheet.deleteRow(t.row);
  },
};

function tireValues(r) {
  const name = String(r.name || '').trim();
  if (!name || name.length > 40) fail('Giv dækket et navn');
  if (TIRE_TYPES.indexOf(r.type) < 0) fail('Ugyldig dæktype');
  const startKm = r.startKm === undefined ? 0 : r.startKm;
  checkNumber(startKm, 'km på dækket', 0);
  return { name: name, type: r.type, start_km: startKm };
}

// Fittings that are still mounted (km_off empty), each tagged with its tire's car.
function openFittings(stock) {
  const carOf = {};
  stock.forEach(function (t) { carOf[String(t.id)] = t.car; });
  return readSheet('TireLog')
    .filter(function (f) { return f.km_off === ''; })
    .map(function (f) { f.car = carOf[String(f.tire)]; return f; });
}

// Close the open fitting on one car position, if any.
function closeAt(open, car, pos, date, km, stock) {
  open.filter(function (f) { return f.car === car && f.position === pos; }).forEach(function (f) {
    if (km < Number(f.km_on)) fail('Km-standen er lavere end da dækket blev monteret (' + f.km_on + ' km)');
    if (f.date_on && date < f.date_on) fail('Datoen ligger før dækket blev monteret');
    setFields({ sheet: sheetOf('TireLog'), row: f._row, map: columnMap(sheetOf('TireLog'), 'TireLog') }, { date_off: date, km_off: km });
  });
}
