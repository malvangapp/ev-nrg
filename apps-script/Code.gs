/**
 * EV-NRG backend. Paste into the Google Sheet's script editor (Extensions > Apps Script),
 * run setup() once, then deploy as a web app (execute as: me, access: anyone).
 */
const SCHEMA = {
  Charges: ['id', 'date', 'car', 'kwh', 'price_dkk', 'created', 'updated', 'non_home'],
  Odometer: ['id', 'date', 'car', 'km'],
  Cars: ['car_id', 'name', 'km_at_purchase', 'image'],
};
const TEXT_COLUMNS = { Charges: ['date', 'created', 'updated'], Odometer: ['date'] };
const TOKEN_DAYS = 180;

function setup() {
  const ss = SpreadsheetApp.getActive();
  Object.keys(SCHEMA).forEach(function (name) {
    const sheet = ss.getSheetByName(name) || ss.insertSheet(name);
    sheet.getRange(1, 1, 1, SCHEMA[name].length).setValues([SCHEMA[name]]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    (TEXT_COLUMNS[name] || []).forEach(function (col) {
      sheet.getRange(2, SCHEMA[name].indexOf(col) + 1, sheet.getMaxRows() - 1, 1).setNumberFormat('@');
    });
  });
  const charges = ss.getSheetByName('Charges');
  charges.getRange(2, SCHEMA.Charges.indexOf('non_home') + 1, charges.getMaxRows() - 1, 1).insertCheckboxes();
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
  return json({ ok: true, name: 'EV-NRG' });
}

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    if (req.action === 'login') return json(login(req.passphrase));
    if (!validToken(req.token)) return json({ ok: false, code: 'AUTH', error: 'Log ind igen' });
    const handler = HANDLERS[req.action];
    if (!handler) return json({ ok: false, error: 'Ukendt handling' });
    if (req.action === 'getAll') return json(getAll());
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
    return json({ ok: false, error: err.userMessage || 'Der opstod en fejl' + (err.userMessage ? '' : ': ' + err) });
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
function readSheet(name) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(name);
  const head = SCHEMA[name];
  const last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, head.length).getValues()
    .filter(function (r) { return r[0] !== ''; })
    .map(function (r) {
      const o = {};
      head.forEach(function (h, i) {
        let v = r[i];
        if (v instanceof Date) v = Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
        o[h] = v;
      });
      return o;
    });
}

function isTrue(v) {
  return v === true || /^(true|ja|yes|1|x)$/i.test(String(v).trim());
}

function getAll() {
  const num = function (v) { return Number(v) || 0; };
  return {
    ok: true,
    cars: readSheet('Cars').map(function (c) { return { id: c.car_id, name: c.name, kmAtPurchase: num(c.km_at_purchase), image: c.image }; }),
    charges: readSheet('Charges').map(function (c) { return { id: c.id, date: String(c.date), car: c.car, kwh: num(c.kwh), price: num(c.price_dkk), nonHome: isTrue(c.non_home) }; }),
    odometer: readSheet('Odometer').map(function (o) { return { id: o.id, date: String(o.date), car: o.car, km: num(o.km) }; }),
  };
}

function findRow(name, id) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(name);
  const ids = sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 1), 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return { sheet: sheet, row: i + 2 };
  fail('Linjen findes ikke længere');
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
    if (o.car !== req.car || o.id === selfId) return;
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
    SpreadsheetApp.getActive().getSheetByName('Charges')
      .appendRow([Utilities.getUuid(), r.date, r.car, r.kwh, r.price, now, now, r.nonHome === true]);
  },
  updateCharge: function (r) {
    charge(r);
    const t = findRow('Charges', r.id);
    t.sheet.getRange(t.row, 2, 1, 4).setValues([[r.date, r.car, r.kwh, r.price]]);
    t.sheet.getRange(t.row, 7).setValue(new Date().toISOString());
    t.sheet.getRange(t.row, 8).setValue(r.nonHome === true);
  },
  deleteCharge: function (r) {
    const t = findRow('Charges', r.id);
    t.sheet.deleteRow(t.row);
  },
  addOdometer: function (r) {
    checkOdometer(r, null);
    SpreadsheetApp.getActive().getSheetByName('Odometer').appendRow([Utilities.getUuid(), r.date, r.car, r.km]);
  },
  updateOdometer: function (r) {
    checkOdometer(r, r.id);
    const t = findRow('Odometer', r.id);
    t.sheet.getRange(t.row, 2, 1, 3).setValues([[r.date, r.car, r.km]]);
  },
  deleteOdometer: function (r) {
    const t = findRow('Odometer', r.id);
    t.sheet.deleteRow(t.row);
  },
  updateCar: function (r) {
    checkNumber(r.kmAtPurchase, 'km ved køb', 0);
    const t = findRow('Cars', r.id);
    t.sheet.getRange(t.row, 3).setValue(r.kmAtPurchase);
  },
};
