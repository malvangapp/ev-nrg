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
  Cars: ['car_id', 'name', 'km_at_purchase', 'image'],
};
// Header spellings accepted in addition to the schema name.
const ALIASES = { non_home: ['ude', 'udehjemme', 'ikkehjemme', 'vaekhjemme', 'away', 'public'] };
// A row only counts as data when this column has a value.
const KEY_COLUMN = { Charges: 'date', Odometer: 'date', Cars: 'car_id' };
const TEXT_COLUMNS = { Charges: ['date', 'created', 'updated'], Odometer: ['date'] };
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
  return json({ ok: true, name: 'EV-NRG', version: 3 });
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

function sheetOf(name) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sheet) fail('Fanen "' + name + '" findes ikke. Kør setup igen.');
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
  const num = function (v) { return Number(v) || 0; };
  return {
    ok: true,
    cars: readSheet('Cars').map(function (c) { return { id: c.car_id, name: c.name, kmAtPurchase: num(c.km_at_purchase), image: c.image }; }),
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
    checkNumber(r.kmAtPurchase, 'km ved køb', 0);
    setFields(findRow('Cars', r.id), { km_at_purchase: r.kmAtPurchase });
  },
};
