const Api = (() => {
  const TOKEN_KEY = 'evnrg.token';
  const CACHE_KEY = 'evnrg.cache';
  const demo = !CONFIG.API_URL;

  const safe = (fn, fallback) => {
    try { return fn(); } catch { return fallback; }
  };
  const getToken = () => safe(() => localStorage.getItem(TOKEN_KEY), null);
  const setToken = (t) => safe(() => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY)));
  const getCache = () => safe(() => JSON.parse(localStorage.getItem(CACHE_KEY)), null);
  const setCache = (d) => safe(() => localStorage.setItem(CACHE_KEY, JSON.stringify(d)));

  class ApiError extends Error {
    constructor(message, code) { super(message); this.code = code; }
  }

  async function call(action, payload = {}) {
    if (demo) return demoCall(action, payload);
    let res;
    try {
      res = await fetch(CONFIG.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // avoids a CORS preflight
        body: JSON.stringify({ action, token: getToken(), ...payload }),
      });
    } catch {
      throw new ApiError('Ingen forbindelse');
    }
    const body = await res.json();
    if (!body.ok) throw new ApiError(body.error || 'Fejl', body.code);
    return body;
  }

  // ---- demo mode (no backend configured) ----
  let demoData = null;
  function demoCall(action, p) {
    if (action === 'login') return Promise.resolve({ ok: true, token: 'demo' });
    if (!demoData) {
      const ch = [];
      for (let m = 0; m < 6; m++) {
        const d = new Date(); d.setDate(10); d.setMonth(d.getMonth() - m);
        const iso = d.toISOString().slice(0, 10);
        ch.push({ id: 'e' + m, date: iso, car: 'elroq', kwh: 90 + m * 7, price: 190 + m * 20 });
        ch.push({ id: 'v' + m, date: iso, car: 'id3', kwh: 60 + m * 5, price: 130 + m * 11, nonHome: m % 2 === 1 });
      }
      demoData = {
        cars: [
          { id: 'elroq', name: 'Skoda Elroq', kmAtPurchase: 1200, image: 'assets/cars/elroq.png' },
          { id: 'id3', name: 'VW ID.3', kmAtPurchase: 15000, image: 'assets/cars/id3.png' },
        ],
        charges: ch,
        odometer: [
          { id: 'o1', date: ch[0].date, car: 'elroq', km: 5400 },
          { id: 'o2', date: ch[0].date, car: 'id3', km: 19800 },
        ],
      };
    }
    const uid = () => Math.random().toString(36).slice(2);
    const d = demoData;
    const del = (k) => { d[k] = d[k].filter((x) => x.id !== p.id); };
    const upd = (k) => { d[k] = d[k].map((x) => (x.id === p.id ? { ...x, ...p } : x)); };
    switch (action) {
      case 'addCharge': d.charges.push({ id: uid(), date: p.date, car: p.car, kwh: p.kwh, price: p.price, nonHome: p.nonHome === true }); break;
      case 'updateCharge': upd('charges'); break;
      case 'deleteCharge': del('charges'); break;
      case 'addOdometer': d.odometer.push({ id: uid(), date: p.date, car: p.car, km: p.km }); break;
      case 'updateOdometer': upd('odometer'); break;
      case 'deleteOdometer': del('odometer'); break;
      case 'updateCar': d.cars = d.cars.map((c) => (c.id === p.id ? { ...c, kmAtPurchase: p.kmAtPurchase } : c)); break;
    }
    return Promise.resolve({ ok: true, ...JSON.parse(JSON.stringify(d)) });
  }

  return { call, getToken, setToken, getCache, setCache, ApiError, demo };
})();
