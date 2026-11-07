// Pure calculation helpers (no DOM) so they can be tested in Node.
const Calc = (() => {
  const monthOf = (date) => date.slice(0, 7);

  const forScope = (list, car) => (car ? list.filter((x) => x.car === car) : list);

  // kind: 'all' | 'home' | 'away' (away = charged away from home)
  function totals(charges, car, month, kind = 'all') {
    let kwh = 0;
    let price = 0;
    for (const c of forScope(charges, car)) {
      if (month && !c.date.startsWith(month)) continue; // month 'YYYY-MM' or year 'YYYY'
      if (kind === 'home' && c.nonHome) continue;
      if (kind === 'away' && !c.nonHome) continue;
      kwh += c.kwh;
      price += c.price;
    }
    return { kwh, price };
  }

  function months(charges, car) {
    const set = new Set(forScope(charges, car).map((c) => monthOf(c.date)));
    return [...set].sort().reverse();
  }

  function years(charges, car) {
    const set = new Set(forScope(charges, car).map((c) => c.date.slice(0, 4)));
    return [...set].sort().reverse();
  }

  const TIRE_POS = ['FL', 'FR', 'RL', 'RR']; // front left/right, rear left/right

  // Everything about one tire: total km (km it already had + every fitting, an open fitting running
  // up to the car's latest odometer reading), the open fitting if it is mounted, and its history.
  function tireInfo(tire, fittings, latestKm) {
    const list = fittings
      .filter((f) => f.tire === tire.id)
      .sort((a, b) => (a.dateOn < b.dateOn ? 1 : a.dateOn > b.dateOn ? -1 : b.kmOn - a.kmOn));
    let kmTotal = tire.startKm;
    for (const f of list) {
      const end = f.kmOff != null ? f.kmOff : Math.max(f.kmOn, latestKm != null ? latestKm : f.kmOn);
      f.kmUsed = Math.max(0, end - f.kmOn);
      kmTotal += f.kmUsed;
    }
    return { tire, kmTotal, open: list.find((f) => f.kmOff == null) || null, list };
  }

  // Mounted tires by position plus the stock (not mounted), for one car.
  function carTires(carId, tires, fittings, latestKm) {
    const infos = tires.filter((t) => t.car === carId).map((t) => tireInfo(t, fittings, latestKm));
    const mounted = {};
    for (const i of infos) if (i.open) mounted[i.open.pos] = i;
    return { all: infos, mounted, stock: infos.filter((i) => !i.open).sort((a, b) => (a.tire.name < b.tire.name ? -1 : 1)) };
  }

  function latestReading(odometer, car) {
    const list = odometer.filter((o) => o.car === car);
    if (!list.length) return null;
    return list.reduce((a, b) => (b.date > a.date || (b.date === a.date && b.km > a.km) ? b : a));
  }

  // kWh per 100 km, counting only charges up to and including the latest odometer date.
  function carStats(car, charges, odometer) {
    const latest = latestReading(odometer, car.id);
    const stats = { latest, kmDriven: null, kwhUsed: null, per100: null };
    if (!latest) return stats;
    stats.kmDriven = latest.km - car.kmAtPurchase;
    stats.kwhUsed = charges
      .filter((c) => c.car === car.id && c.date <= latest.date)
      .reduce((s, c) => s + c.kwh, 0);
    if (stats.kmDriven > 0 && stats.kwhUsed > 0) stats.per100 = (stats.kwhUsed / stats.kmDriven) * 100;
    return stats;
  }

  return { monthOf, totals, months, years, TIRE_POS, tireInfo, carTires, latestReading, carStats };
})();

if (typeof module !== 'undefined') module.exports = Calc;
