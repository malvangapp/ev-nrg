// Cheapest-charging planner (no DOM) so it can be tested in Node.
const Planner = (() => {
  // Net (usable) capacity: the car's charge % refers to this, not the gross figure (Elroq 84, ID.3 62).
  const BATTERY_KWH = { elroq: 77, id3: 58 };
  const HOUR = 3600000;
  const STEP = 15 * 60000;

  // All amounts in øre/kWh unless noted. Net tariff = grid company fee per season and time band.
  const DEFAULTS = {
    powerKw: 10.6,
    lossPct: 6,
    supplement: 0, // OK Højt Forbrug: no per-kWh supplement (49 kr./month is not time dependent)
    energinet: 11.5,
    elafgift: 0.8,
    vatPct: 25,
    // N1 nettarif C, valid from 1 Jan 2026. elselskaber.dk lists it incl. VAT (low 11, high 33/16,5, peak 98,8/42,8);
    // stored here excl. VAT (÷ 1,25) because VAT is added on top of everything.
    tariff: {
      winter: { low: 8.8, high: 26.4, peak: 79.04 }, // Oct-Mar
      summer: { low: 8.8, high: 13.2, peak: 34.24 }, // Apr-Sep
    },
    readyBy: '06:30',
    from: 20,
    to: 90,
    v: 3, // bump when defaults change so older saved settings on a phone are dropped
  };

  // Bands: low 00-06, high 06-17 and 21-24, peak 17-21.
  const band = (hour) => (hour < 6 ? 'low' : hour < 17 ? 'high' : hour < 21 ? 'peak' : 'high');
  const season = (month) => (month >= 10 || month <= 3 ? 'winter' : 'summer');

  // raw: array of {DKK_per_kWh (excl. VAT), time_start, time_end} from elprisenligenu.dk
  function buildPrices(raw, s) {
    return raw
      .map((p) => {
        const month = +p.time_start.slice(5, 7);
        const hour = +p.time_start.slice(11, 13);
        const tariff = s.tariff[season(month)][band(hour)];
        const fees = (s.supplement + s.energinet + s.elafgift + tariff) / 100;
        return {
          start: Date.parse(p.time_start),
          end: Date.parse(p.time_end),
          spot: p.DKK_per_kWh,
          total: (p.DKK_per_kWh + fees) * (1 + s.vatPct / 100),
        };
      })
      .sort((a, b) => a.start - b.start);
  }

  // Cost in kr. of drawing powerKw from `start` for `durationMs`; null if prices don't cover the whole span.
  function blockCost(prices, start, durationMs, powerKw) {
    const end = start + durationMs;
    let cost = 0;
    let covered = 0;
    for (const p of prices) {
      const a = Math.max(p.start, start);
      const b = Math.min(p.end, end);
      if (b <= a) continue;
      covered += b - a;
      cost += ((b - a) / HOUR) * powerKw * p.total;
    }
    return covered >= durationMs - 1 ? cost : null;
  }

  const ceilStep = (t) => Math.ceil(t / STEP) * STEP;

  // Next occurrence of "HH:MM" (device local time) after `now`.
  function deadlineAfter(now, hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    const d = new Date(now);
    d.setHours(h, m, 0, 0);
    if (d.getTime() <= now) d.setDate(d.getDate() + 1);
    return d.getTime();
  }

  // Cheapest unbroken block that delivers `gridKwh` and ends no later than `deadline`.
  function plan(prices, now, deadline, gridKwh, powerKw) {
    const durationMs = (gridKwh / powerKw) * HOUR;
    const dataEnd = prices.length ? prices[prices.length - 1].end : now;
    const until = Math.min(deadline, dataEnd);
    const result = { durationMs, gridKwh, until, partial: dataEnd < deadline, best: null, now: null, reason: null };
    const first = ceilStep(now);
    if (first + durationMs > deadline) {
      // Target can't be reached in time: charge from now until the deadline and report how far it gets.
      result.reason = 'too-short';
      const availMs = Math.max(0, deadline - now);
      result.limited = {
        start: now,
        end: now + availMs,
        kwh: (powerKw * availMs) / HOUR,
        cost: availMs ? blockCost(prices, now, availMs, powerKw) : null,
      };
      return result;
    }
    const nowCost = blockCost(prices, first, durationMs, powerKw);
    if (nowCost != null) result.now = { start: first, end: first + durationMs, cost: nowCost };
    for (let t = first; t + durationMs <= until; t += STEP) {
      const cost = blockCost(prices, t, durationMs, powerKw);
      if (cost != null && (!result.best || cost < result.best.cost - 1e-9)) {
        result.best = { start: t, end: t + durationMs, cost };
      }
    }
    if (!result.best) result.reason = 'no-prices';
    return result;
  }

  function energyNeeded(carId, fromPct, toPct, lossPct) {
    const battery = BATTERY_KWH[carId];
    if (!battery || !(toPct > fromPct)) return null;
    return battery * ((toPct - fromPct) / 100) * (1 + lossPct / 100);
  }

  // Charge % reached after drawing gridKwh from the wall (whole percent, rounded down).
  function reachedPct(carId, fromPct, gridKwh, lossPct) {
    const battery = BATTERY_KWH[carId];
    return Math.floor(fromPct + (gridKwh / (1 + lossPct / 100) / battery) * 100);
  }

  return { BATTERY_KWH, DEFAULTS, buildPrices, blockCost, deadlineAfter, plan, energyNeeded, reachedPct, band, season };
})();

if (typeof module !== 'undefined') module.exports = Planner;
