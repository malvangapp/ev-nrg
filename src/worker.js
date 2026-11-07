/**
 * EV-NRG backend on Cloudflare Workers + D1.
 *
 * Static files in public/ are served by Workers Static Assets; only /api reaches this code.
 * The API keeps the contract of the old Apps Script backend: POST { action, token, ...payload }
 * and every successful call answers with the complete data set ({ ok: true, cars, charges, ... }).
 *
 * Secrets (set with `npx wrangler secret put <NAME>`):
 *   PASSPHRASE    – the login password
 *   TOKEN_SECRET  – any long random string, used to sign login tokens
 */
const TIRE_POSITIONS = ['FL', 'FR', 'RL', 'RR']; // front left/right, rear left/right
const TIRE_TYPES = ['summer', 'winter', 'all'];
const TIRE_LABEL = { summer: 'Sommer', winter: 'Vinter', all: 'Helår' };
const TOKEN_DAYS = 180;
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/api') return env.ASSETS.fetch(request);
    if (request.method === 'GET') return json({ ok: true, name: 'EV-NRG', backend: 'cloudflare', version: 8 });
    if (request.method !== 'POST') return json({ ok: false, error: 'Metode ikke tilladt' }, 405);
    try {
      const req = await request.json();
      if (req.action === 'login') return json(await login(env, req.passphrase));
      if (!(await validToken(env, req.token))) return json({ ok: false, code: 'AUTH', error: 'Log ind igen' });
      const handler = HANDLERS[req.action];
      if (!handler) return json({ ok: false, error: 'Ukendt handling' });
      await handler(env.DB, req);
      return json(await getAll(env.DB));
    } catch (err) {
      if (!err.userMessage) console.error(err);
      return json({ ok: false, error: err.userMessage || 'Der opstod en fejl: ' + err.message });
    }
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json;charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function fail(msg) {
  const e = new Error(msg);
  e.userMessage = msg;
  throw e;
}

const uuid = () => crypto.randomUUID();

// ---------- auth ----------
const enc = new TextEncoder();

async function sign(env, payload) {
  if (!env.TOKEN_SECRET) fail('TOKEN_SECRET er ikke sat på serveren');
  const key = await crypto.subtle.importKey('raw', enc.encode(env.TOKEN_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(payload)));
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Constant-time string compare, so neither the password nor a signature can be guessed by timing.
function same(a, b) {
  a = String(a); b = String(b);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

async function login(env, passphrase) {
  if (!env.PASSPHRASE || typeof passphrase !== 'string' || !same(passphrase, env.PASSPHRASE)) {
    await new Promise((r) => setTimeout(r, 1500));
    return { ok: false, error: 'Forkert adgangskode' };
  }
  const exp = String(Date.now() + TOKEN_DAYS * 86400000);
  return { ok: true, token: exp + '.' + (await sign(env, exp)) };
}

async function validToken(env, token) {
  if (typeof token !== 'string' || token.indexOf('.') < 0) return false;
  const [exp, sig] = token.split('.');
  return Number(exp) > Date.now() && same(await sign(env, exp), sig);
}

// ---------- reading ----------
async function getAll(db) {
  const [cars, tires, fittings, charges, odometer] = await db.batch([
    db.prepare('SELECT * FROM cars ORDER BY sort, id'),
    db.prepare('SELECT * FROM tires ORDER BY rowid'),
    db.prepare('SELECT * FROM fittings ORDER BY rowid'),
    db.prepare('SELECT * FROM charges ORDER BY date, rowid'),
    db.prepare('SELECT * FROM odometer ORDER BY date, rowid'),
  ]);
  return {
    ok: true,
    cars: cars.results.map((c) => ({ id: c.id, name: c.name, kmAtPurchase: c.km_at_purchase, image: c.image, licensePlate: c.license_plate, vin: c.vin })),
    tires: tires.results.map((t) => ({ id: t.id, car: t.car, name: t.name, type: t.type, startKm: t.start_km })),
    fittings: fittings.results.map((f) => ({ id: f.id, tire: f.tire, pos: f.position, dateOn: f.date_on, kmOn: f.km_on, dateOff: f.date_off, kmOff: f.km_off })),
    charges: charges.results.map((c) => ({ id: c.id, date: c.date, car: c.car, kwh: c.kwh, price: c.price_dkk, nonHome: c.non_home === 1 })),
    odometer: odometer.results.map((o) => ({ id: o.id, date: o.date, car: o.car, km: o.km })),
  };
}

// ---------- validation ----------
async function carExists(db, id) {
  if (!(await db.prepare('SELECT 1 FROM cars WHERE id = ?').bind(String(id)).first())) fail('Ukendt bil');
}

function checkDate(d) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '')) fail('Ugyldig dato');
}

function checkNumber(v, label, min) {
  if (typeof v !== 'number' || !isFinite(v) || v < min) fail('Ugyldig ' + label);
}

async function checkCharge(db, r) {
  await carExists(db, r.car);
  checkDate(r.date);
  checkNumber(r.kwh, 'kWh', 0.001);
  checkNumber(r.price, 'pris', 0);
}

async function checkOdometer(db, r, selfId) {
  await carExists(db, r.car);
  checkDate(r.date);
  checkNumber(r.km, 'km-stand', 0);
  const clash = await db.prepare(
    `SELECT date, km FROM odometer WHERE car = ?1 AND id IS NOT ?2
       AND ((date <= ?3 AND km > ?4) OR (date >= ?3 AND km < ?4)) LIMIT 1`,
  ).bind(r.car, selfId, r.date, r.km).first();
  if (clash) fail(`Km-standen passer ikke med en anden aflæsning (${clash.date}: ${clash.km} km)`);
}

function tireValues(r) {
  const name = String(r.name || '').trim();
  if (!name || name.length > 40) fail('Giv dækket et navn');
  if (!TIRE_TYPES.includes(r.type)) fail('Ugyldig dæktype');
  const startKm = r.startKm === undefined ? 0 : r.startKm;
  checkNumber(startKm, 'km på dækket', 0);
  return { name, type: r.type, startKm };
}

async function mustChange(stmt) {
  const res = await stmt.run();
  if (!res.meta.changes) fail('Linjen findes ikke længere');
}

// Open fittings (still mounted) on a car.
async function openFittings(db, car) {
  const { results } = await db.prepare(
    'SELECT f.* FROM fittings f JOIN tires t ON t.id = f.tire WHERE t.car = ? AND f.km_off IS NULL',
  ).bind(car).all();
  return results;
}

// Statements that close the open fitting on each of the given positions.
function closeAt(db, open, positions, date, km) {
  return open.filter((f) => positions.includes(f.position)).map((f) => {
    if (km < f.km_on) fail(`Km-standen er lavere end da dækket blev monteret (${f.km_on} km)`);
    if (f.date_on && date < f.date_on) fail('Datoen ligger før dækket blev monteret');
    return db.prepare('UPDATE fittings SET date_off = ?, km_off = ? WHERE id = ?').bind(date, km, f.id);
  });
}

// ---------- handlers ----------
const HANDLERS = {
  getAll() {},

  async addCharge(db, r) {
    await checkCharge(db, r);
    const now = new Date().toISOString();
    await db.prepare('INSERT INTO charges (id, date, car, kwh, price_dkk, non_home, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(uuid(), r.date, r.car, r.kwh, r.price, r.nonHome === true ? 1 : 0, now, now).run();
  },
  async updateCharge(db, r) {
    await checkCharge(db, r);
    await mustChange(db.prepare('UPDATE charges SET date = ?, car = ?, kwh = ?, price_dkk = ?, non_home = ?, updated = ? WHERE id = ?')
      .bind(r.date, r.car, r.kwh, r.price, r.nonHome === true ? 1 : 0, new Date().toISOString(), String(r.id)));
  },
  async deleteCharge(db, r) {
    await mustChange(db.prepare('DELETE FROM charges WHERE id = ?').bind(String(r.id)));
  },

  async addOdometer(db, r) {
    await checkOdometer(db, r, null);
    await db.prepare('INSERT INTO odometer (id, date, car, km) VALUES (?, ?, ?, ?)').bind(uuid(), r.date, r.car, r.km).run();
  },
  async updateOdometer(db, r) {
    await checkOdometer(db, r, String(r.id));
    await mustChange(db.prepare('UPDATE odometer SET date = ?, car = ?, km = ? WHERE id = ?').bind(r.date, r.car, r.km, String(r.id)));
  },
  async deleteOdometer(db, r) {
    await mustChange(db.prepare('DELETE FROM odometer WHERE id = ?').bind(String(r.id)));
  },

  async updateCar(db, r) {
    const sets = [];
    const args = [];
    if (r.kmAtPurchase !== undefined) {
      checkNumber(r.kmAtPurchase, 'km ved køb', 0);
      sets.push('km_at_purchase = ?'); args.push(r.kmAtPurchase);
    }
    if (r.licensePlate !== undefined) {
      if (typeof r.licensePlate !== 'string' || r.licensePlate.length > 12) fail('Ugyldig nummerplade');
      sets.push('license_plate = ?'); args.push(r.licensePlate.trim().toUpperCase());
    }
    if (r.vin !== undefined) {
      const vin = String(r.vin).replace(/\s/g, '').toUpperCase();
      if (vin && !VIN_RE.test(vin)) fail('Stelnummer skal være 17 tegn (bogstaver og tal, ikke I, O og Q)');
      sets.push('vin = ?'); args.push(vin);
    }
    if (!sets.length) return;
    await mustChange(db.prepare(`UPDATE cars SET ${sets.join(', ')} WHERE id = ?`).bind(...args, String(r.id)));
  },

  async addTire(db, r) {
    await carExists(db, r.car);
    const v = tireValues(r);
    const count = r.count === undefined ? 1 : r.count;
    if (typeof count !== 'number' || count < 1 || count > 8 || count % 1) fail('Ugyldigt antal');
    const stmts = [];
    for (let i = 1; i <= count; i++) {
      stmts.push(db.prepare('INSERT INTO tires (id, car, name, type, start_km) VALUES (?, ?, ?, ?, ?)')
        .bind(uuid(), r.car, count > 1 ? `${v.name} ${i}` : v.name, v.type, v.startKm));
    }
    await db.batch(stmts);
  },
  async updateTire(db, r) {
    const v = tireValues(r);
    await mustChange(db.prepare('UPDATE tires SET name = ?, type = ?, start_km = ? WHERE id = ?').bind(v.name, v.type, v.startKm, String(r.id)));
  },
  async deleteTire(db, r) {
    const id = String(r.id);
    const [, del] = await db.batch([
      db.prepare('DELETE FROM fittings WHERE tire = ?').bind(id),
      db.prepare('DELETE FROM tires WHERE id = ?').bind(id),
    ]);
    if (!del.meta.changes) fail('Linjen findes ikke længere');
  },
  // Put the four tires that are on the car today into the register, fitted from the given km.
  async initTires(db, r) {
    await carExists(db, r.car);
    if (await db.prepare('SELECT 1 FROM tires WHERE car = ?').bind(r.car).first()) fail('Der er allerede dæk registreret');
    if (!TIRE_TYPES.includes(r.type)) fail('Ugyldig dæktype');
    checkNumber(r.km, 'km-stand', 0);
    if (r.date) checkDate(r.date);
    const stmts = [];
    TIRE_POSITIONS.forEach((pos, i) => {
      const id = uuid();
      stmts.push(db.prepare('INSERT INTO tires (id, car, name, type, start_km) VALUES (?, ?, ?, ?, 0)').bind(id, r.car, `${TIRE_LABEL[r.type]} ${i + 1}`, r.type));
      stmts.push(db.prepare('INSERT INTO fittings (id, tire, position, date_on, km_on) VALUES (?, ?, ?, ?, ?)').bind(uuid(), id, pos, r.date || '', r.km));
    });
    await db.batch(stmts);
  },
  // assignments: [{ pos, tire }]. A tire already on that position is taken off (and goes to stock).
  async mountTires(db, r) {
    await carExists(db, r.car);
    checkDate(r.date);
    checkNumber(r.km, 'km-stand', 0);
    if (!Array.isArray(r.assignments) || !r.assignments.length) fail('Vælg mindst ét dæk');
    const { results: stock } = await db.prepare('SELECT id, name FROM tires WHERE car = ?').bind(r.car).all();
    const open = await openFittings(db, r.car);
    const seenPos = new Set();
    const seenTire = new Set();
    r.assignments.forEach((a) => {
      if (!TIRE_POSITIONS.includes(a.pos)) fail('Ugyldig dækposition');
      if (seenPos.has(a.pos) || seenTire.has(String(a.tire))) fail('Samme plads eller dæk er valgt to gange');
      seenPos.add(a.pos); seenTire.add(String(a.tire));
      const tire = stock.find((t) => t.id === String(a.tire));
      if (!tire) fail('Dækket hører ikke til denne bil');
      if (open.some((f) => f.tire === tire.id)) fail(`Dækket "${tire.name}" er allerede monteret`);
    });
    await db.batch([
      ...closeAt(db, open, r.assignments.map((a) => a.pos), r.date, r.km),
      ...r.assignments.map((a) => db.prepare('INSERT INTO fittings (id, tire, position, date_on, km_on) VALUES (?, ?, ?, ?, ?)')
        .bind(uuid(), String(a.tire), a.pos, r.date, r.km)),
    ]);
  },
  // Take the tires on these positions off the car (they go to stock).
  async unmountTires(db, r) {
    await carExists(db, r.car);
    checkDate(r.date);
    checkNumber(r.km, 'km-stand', 0);
    if (!Array.isArray(r.positions) || !r.positions.length) fail('Vælg mindst ét dæk');
    r.positions.forEach((pos) => { if (!TIRE_POSITIONS.includes(pos)) fail('Ugyldig dækposition'); });
    const stmts = closeAt(db, await openFittings(db, r.car), r.positions, r.date, r.km);
    if (stmts.length) await db.batch(stmts);
  },
  async updateFitting(db, r) {
    checkDate(r.dateOn);
    checkNumber(r.kmOn, 'km-stand', 0);
    let dateOff = '';
    let kmOff = null;
    if (r.kmOff !== null && r.kmOff !== undefined) {
      checkDate(r.dateOff);
      checkNumber(r.kmOff, 'km-stand', 0);
      if (r.kmOff < r.kmOn) fail('Km-standen ved afmontering er lavere end ved montering');
      dateOff = r.dateOff;
      kmOff = r.kmOff;
    }
    await mustChange(db.prepare('UPDATE fittings SET date_on = ?, km_on = ?, date_off = ?, km_off = ? WHERE id = ?')
      .bind(r.dateOn, r.kmOn, dateOff, kmOff, String(r.id)));
  },
  async deleteFitting(db, r) {
    await mustChange(db.prepare('DELETE FROM fittings WHERE id = ?').bind(String(r.id)));
  },

  // Load an export file. mode 'merge' adds records whose id is not there yet; 'replace' swaps all data
  // (cars keep their name and image; km at purchase, plate and VIN are taken from the file).
  // Everything runs in one D1 batch, so a failing import changes nothing.
  async importAll(db, r) {
    const d = r.data || {};
    const replace = r.mode === 'replace';
    ['cars', 'charges', 'odometer', 'tires', 'fittings'].forEach((k) => {
      if (d[k] !== undefined && !Array.isArray(d[k])) fail('Ugyldig fil');
      if ((d[k] || []).length > 20000) fail('Filen er for stor');
    });
    const ids = async (table) => new Set((await db.prepare(`SELECT id FROM ${table}`).all()).results.map((x) => x.id));
    const carIds = await ids('cars');
    const existing = {
      charges: replace ? new Set() : await ids('charges'),
      odometer: replace ? new Set() : await ids('odometer'),
      tires: replace ? new Set() : await ids('tires'),
      fittings: replace ? new Set() : await ids('fittings'),
    };
    const keep = (table, list, build) => {
      const out = [];
      (list || []).forEach((item) => {
        const id = item.id ? String(item.id) : uuid();
        if (existing[table].has(id)) return;
        existing[table].add(id);
        out.push(build(item, id));
      });
      return out;
    };
    const known = (car) => { if (!carIds.has(car)) fail('Ukendt bil i filen: ' + car); };
    const now = new Date().toISOString();

    const stmts = [];
    if (replace) {
      ['fittings', 'tires', 'charges', 'odometer'].forEach((t) => stmts.push(db.prepare(`DELETE FROM ${t}`)));
      (d.cars || []).forEach((c) => {
        if (!carIds.has(c.id)) return;
        if (typeof c.kmAtPurchase === 'number' && c.kmAtPurchase >= 0) stmts.push(db.prepare('UPDATE cars SET km_at_purchase = ? WHERE id = ?').bind(c.kmAtPurchase, c.id));
        if (typeof c.licensePlate === 'string') stmts.push(db.prepare('UPDATE cars SET license_plate = ? WHERE id = ?').bind(c.licensePlate.slice(0, 12), c.id));
        if (typeof c.vin === 'string' && (c.vin === '' || VIN_RE.test(c.vin))) stmts.push(db.prepare('UPDATE cars SET vin = ? WHERE id = ?').bind(c.vin, c.id));
      });
    }
    stmts.push(...keep('charges', d.charges, (c, id) => {
      known(c.car); checkDate(c.date); checkNumber(c.kwh, 'kWh', 0.001); checkNumber(c.price, 'pris', 0);
      return db.prepare('INSERT INTO charges (id, date, car, kwh, price_dkk, non_home, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, c.date, c.car, c.kwh, c.price, c.nonHome === true ? 1 : 0, now, now);
    }));
    stmts.push(...keep('odometer', d.odometer, (o, id) => {
      known(o.car); checkDate(o.date); checkNumber(o.km, 'km-stand', 0);
      return db.prepare('INSERT INTO odometer (id, date, car, km) VALUES (?, ?, ?, ?)').bind(id, o.date, o.car, o.km);
    }));
    const tireIds = replace ? new Set() : new Set(existing.tires);
    stmts.push(...keep('tires', d.tires, (t, id) => {
      known(t.car);
      const v = tireValues({ name: t.name, type: t.type, startKm: t.startKm });
      tireIds.add(id);
      return db.prepare('INSERT INTO tires (id, car, name, type, start_km) VALUES (?, ?, ?, ?, ?)').bind(id, t.car, v.name, v.type, v.startKm);
    }));
    stmts.push(...keep('fittings', d.fittings, (f, id) => {
      if (!tireIds.has(String(f.tire))) fail('Montering peger på et dæk der ikke findes');
      if (!TIRE_POSITIONS.includes(f.pos)) fail('Ugyldig dækposition i filen');
      checkNumber(f.kmOn, 'km-stand', 0);
      if (f.dateOn) checkDate(f.dateOn);
      const open = f.kmOff === null || f.kmOff === undefined;
      if (!open) { checkNumber(f.kmOff, 'km-stand', 0); checkDate(f.dateOff); }
      return db.prepare('INSERT INTO fittings (id, tire, position, date_on, km_on, date_off, km_off) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(id, String(f.tire), f.pos, f.dateOn || '', f.kmOn, open ? '' : f.dateOff, open ? null : f.kmOff);
    }));
    if (stmts.length) await db.batch(stmts);
  },
};
