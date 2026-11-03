// Pure calculation helpers (no DOM) so they can be tested in Node.
const Calc = (() => {
  const monthOf = (date) => date.slice(0, 7);

  const forScope = (list, car) => (car ? list.filter((x) => x.car === car) : list);

  // kind: 'all' | 'home' | 'away' (away = charged away from home)
  function totals(charges, car, month, kind = 'all') {
    let kwh = 0;
    let price = 0;
    for (const c of forScope(charges, car)) {
      if (month && monthOf(c.date) !== month) continue;
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

  return { monthOf, totals, months, latestReading, carStats };
})();

if (typeof module !== 'undefined') module.exports = Calc;
