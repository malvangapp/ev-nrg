(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const state = {
    data: null,
    view: 'overview',
    returnView: 'overview',
    page: 0, // 0 = car 1, 1 = car 2, 2 = total
    month: null, // selected month, shared by all overview pages; null = current month
    year: null, // selected year for the bottom boxes: null = current year, 'total' = everything
    detailCar: null,
    filter: 'all',
    place: 'all', // Data list: 'all' | 'home' | 'away'
    collapsed: new Set(), // Data list: months folded shut
    tiresOpen: false, // Bildetaljer: tire section expanded
    stockOpen: false, // Bildetaljer: tires in stock shown
    editing: null, // charge id being edited
    includeAway: true, // Bildetaljer: include charges made away from home
  };
  try { state.collapsed = new Set(JSON.parse(localStorage.getItem('evnrg.collapsed')) || []); } catch { /* storage unavailable */ }
  try { state.includeAway = localStorage.getItem('evnrg.includeAway') !== '0'; } catch { /* storage unavailable */ }

  // iOS ignores user-scalable=no, so block the pinch gesture explicitly.
  ['gesturestart', 'gesturechange', 'gestureend'].forEach((t) => document.addEventListener(t, (e) => e.preventDefault()));

  // ---------- formatting ----------
  const nf = (d) => new Intl.NumberFormat('da-DK', { minimumFractionDigits: d, maximumFractionDigits: d });
  const f0 = nf(0), f1 = nf(1), f2 = nf(2);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const parseDate = (iso) => new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  const fmtDate = (iso) => parseDate(iso).toLocaleDateString('da-DK', { day: 'numeric', month: 'short', year: 'numeric' });
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const fmtMonth = (key) => cap(new Date(+key.slice(0, 4), +key.slice(5, 7) - 1, 1).toLocaleDateString('da-DK', { month: 'long', year: 'numeric' }));
  const currentMonth = () => today().slice(0, 7);
  const TIRE_LABEL = { FL: 'Forrest venstre', FR: 'Forrest højre', RL: 'Bagerst venstre', RR: 'Bagerst højre' };
  const TYPE_LABEL = { summer: 'Sommer', winter: 'Vinter', all: 'Helår' };
  const typeOptions = (sel) => Object.entries(TYPE_LABEL).map(([k, l]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${l}</option>`).join('');
  // Plate shown as AB 12 345 (letters, two digits, three digits) when it has that shape, otherwise as typed.
  function plateButton(plate) {
    if (!plate) return '<button class="plate empty" data-plate>+ Nummerplade</button>';
    const m = plate.replace(/[^A-Za-z0-9]/g, '').toUpperCase().match(/^([A-Z]{2})(\d{2})(\d{3})$/);
    const chars = m ? `<span>${m[1]}</span><span>${m[2]}</span><span>${m[3]}</span>` : `<span>${esc(plate.toUpperCase())}</span>`;
    return `<button class="plate" data-plate aria-label="Nummerplade ${esc(plate)}">${chars}</button>`;
  }

  const carName = (id) => (state.data.cars.find((c) => c.id === id) || {}).name || id;
  const pageCar = (i) => (i < 2 ? state.data.cars[i] : null);

  // ---------- ui helpers ----------
  const busy = (on) => $('#busy').classList.toggle('hidden', !on);
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), 3500);
  }

  async function mutate(action, payload) {
    busy(true);
    try {
      const res = await Api.call(action, payload);
      setData(res);
      return true;
    } catch (e) {
      if (e.code === 'AUTH') { logout(); return false; }
      toast(e.message);
      return false;
    } finally {
      busy(false);
    }
  }

  function setData(res) {
    state.data = { cars: res.cars, charges: res.charges, odometer: res.odometer, tires: res.tires || [], fittings: res.fittings || [] };
    Api.setCache(state.data);
    if (!state.detailCar) state.detailCar = state.data.cars[0].id;
    renderAll();
  }

  function openSheet(html) {
    $('#sheet').onclick = null; // each sheet installs its own handlers
    $('#sheet').onchange = null;
    $('#sheet').innerHTML = html;
    $('#sheet').classList.remove('hidden');
    $('#sheet-backdrop').classList.remove('hidden');
    return $('#sheet');
  }
  function closeSheet() {
    $('#sheet').classList.add('hidden');
    $('#sheet-backdrop').classList.add('hidden');
  }
  $('#sheet-backdrop').addEventListener('click', closeSheet);

  // ---------- navigation ----------
  function show(view) {
    state.view = view;
    for (const v of ['overview', 'detail', 'data', 'plan', 'form']) $(`#view-${v}`).classList.toggle('hidden', v !== view);
    const navView = view === 'form' ? state.returnView : view;
    document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === navView));
    if (view === 'overview') {
      const pager = $('#pager');
      pager.scrollLeft = state.page * pager.clientWidth;
    }
    if (view === 'detail' && state.data) {
      const pager = $('#detail');
      pager.scrollLeft = detailIndex() * pager.clientWidth;
    }
  }
  $('#nav').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.view === 'detail' && state.page < 2) state.detailCar = state.data.cars[state.page].id;
    if (b.dataset.view === 'detail' && state.view !== 'detail') state.tiresOpen = state.stockOpen = false; // start folded each visit
    closeSheet();
    show(b.dataset.view);
    renderAll();
    if (b.dataset.view === 'plan') loadPrices(false);
  });

  // ---------- overview ----------
  function renderOverview() {
    const { cars, charges } = state.data;
    const pager = $('#pager');
    pager.innerHTML = [0, 1, 2].map((i) => {
      const car = pageCar(i);
      const scope = car ? car.id : null;
      const month = state.month || currentMonth();
      const m = Calc.totals(charges, scope, month);
      const year = state.year || currentMonth().slice(0, 4);
      const all = Calc.totals(charges, scope, year === 'total' ? null : year);
      const yearLabel = year === 'total' ? 'Total' : year === currentMonth().slice(0, 4) ? 'I år' : year;
      const hero = car
        ? `<div class="hero"><img src="${esc(car.image)}" alt="${esc(car.name)}"></div>`
        : `<div class="hero two">${cars.slice().reverse().map((c) => `<img src="${esc(c.image)}" alt="${esc(c.name)}">`).join('')}</div>`;
      const label = month === currentMonth() ? 'Denne måned' : fmtMonth(month);
      return `<div class="page" data-i="${i}">
        <div class="head"><h1>${esc(car ? car.name : 'Total')}</h1><button class="plus" data-add="${i}" aria-label="Tilføj ladning">+</button></div>
        ${hero}
        <div class="grid">
          <button class="box" data-month="${i}"><div class="label"><span>${esc(label)}</span><span class="chev">▾</span></div><div class="value">${f1.format(m.kwh)} <span class="unit">kWh</span></div></button>
          <button class="box" data-month="${i}"><div class="label"><span>${esc(label)}</span><span class="chev">▾</span></div><div class="value">${f0.format(m.price)} <span class="unit">kr.</span></div></button>
          <button class="box" data-year><div class="label"><span>${esc(yearLabel)}</span><span class="chev">▾</span></div><div class="value">${f1.format(all.kwh)} <span class="unit">kWh</span></div></button>
          <button class="box" data-year><div class="label"><span>${esc(yearLabel)}</span><span class="chev">▾</span></div><div class="value">${f0.format(all.price)} <span class="unit">kr.</span></div></button>
        </div>
      </div>`;
    }).join('');
    $('#dots').innerHTML = [0, 1, 2].map((i) => `<i class="${i === state.page ? 'on' : ''}"></i>`).join('');
    if (state.view === 'overview') pager.scrollLeft = state.page * pager.clientWidth;
  }

  $('#pager').addEventListener('scroll', () => {
    const p = $('#pager');
    const i = Math.round(p.scrollLeft / p.clientWidth);
    if (i !== state.page && i >= 0 && i <= 2) {
      state.page = i;
      document.querySelectorAll('#dots i').forEach((d, n) => d.classList.toggle('on', n === i));
    }
  }, { passive: true });

  $('#pager').addEventListener('click', (e) => {
    const add = e.target.closest('[data-add]');
    if (add) return openForm(null, +add.dataset.add < 2 ? state.data.cars[+add.dataset.add].id : null, 'overview');
    const mb = e.target.closest('[data-month]');
    if (mb) return openMonthPicker();
    if (e.target.closest('[data-year]')) openYearPicker();
  });

  function openYearPicker() {
    const thisYear = currentMonth().slice(0, 4);
    const sel = state.year || thisYear;
    const options = [['total', 'Total'], ...Calc.years(state.data.charges, null).map((y) => [y, y === thisYear ? `${y} (i år)` : y])];
    const sheet = openSheet(`<h2>Vælg år</h2>${options.map(([k, label]) => `<button class="month-opt ${k === sel ? 'on' : ''}" data-y="${k}"><span>${esc(label)}</span>${k === sel ? '<span>✓</span>' : ''}</button>`).join('')}`);
    sheet.onclick = (e) => {
      const b = e.target.closest('[data-y]');
      if (!b) return;
      state.year = b.dataset.y;
      closeSheet();
      renderOverview();
    };
  }

  function openMonthPicker() {
    const list = Calc.months(state.data.charges, null); // months with data for any car
    const sel = state.month || currentMonth();
    const sheet = openSheet(`<h2>Vælg måned</h2>${
      list.length
        ? list.map((m) => `<button class="month-opt ${m === sel ? 'on' : ''}" data-m="${m}"><span>${esc(fmtMonth(m))}</span>${m === sel ? '<span>✓</span>' : ''}</button>`).join('')
        : '<p class="empty">Ingen data endnu</p>'
    }`);
    sheet.onclick = (e) => {
      const b = e.target.closest('[data-m]');
      if (!b) return;
      state.month = b.dataset.m;
      closeSheet();
      renderOverview();
    };
  }

  // ---------- charge form ----------
  function openForm(id, carId, from) {
    state.editing = id;
    state.returnView = from || state.view;
    const c = id ? state.data.charges.find((x) => x.id === id) : null;
    $('#form-title').textContent = c ? 'Rediger ladning' : 'Ny ladning';
    $('#f-car').innerHTML = state.data.cars.map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('');
    $('#f-car').value = c ? c.car : carId || state.data.cars[0].id;
    $('#f-car').disabled = !c && !!carId; // pre-filled and locked when started from a car page
    $('#f-date').value = c ? c.date : today();
    $('#f-kwh').value = c ? c.kwh : '';
    $('#f-price').value = c ? c.price : '';
    $('#f-away').checked = !!(c && c.nonHome);
    $('#form-error').textContent = '';
    $('#f-delete').classList.toggle('hidden', !c);
    show('form');
  }
  $('#form-cancel').addEventListener('click', () => show(state.returnView));
  $('#charge-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      car: $('#f-car').value,
      date: $('#f-date').value,
      kwh: parseFloat($('#f-kwh').value.replace(',', '.')),
      price: parseFloat($('#f-price').value.replace(',', '.')),
      nonHome: $('#f-away').checked,
    };
    if (!(payload.kwh > 0) || !(payload.price >= 0)) { $('#form-error').textContent = 'Udfyld kWh og pris'; return; }
    const ok = state.editing
      ? await mutate('updateCharge', { ...payload, id: state.editing })
      : await mutate('addCharge', payload);
    if (ok) show(state.returnView);
  });
  $('#f-delete').addEventListener('click', async () => {
    if (!confirm('Slet denne ladning?')) return;
    if (await mutate('deleteCharge', { id: state.editing })) show(state.returnView);
  });

  // ---------- car detail ----------
  function detailPage(car) {
    const { charges, odometer } = state.data;
    const s = Calc.carStats(car, charges, odometer);
    const shown = Calc.totals(charges, car.id, null, state.includeAway ? 'all' : 'home');
    const home = Calc.totals(charges, car.id, null, 'home');
    const away = Calc.totals(charges, car.id, null, 'away');
    const tr = Calc.carTires(car.id, state.data.tires, state.data.fittings, s.latest ? s.latest.km : null);
    const mountedInfos = Calc.TIRE_POS.map((p) => tr.mounted[p]).filter(Boolean);
    const kms = mountedInfos.map((i) => i.kmTotal);
    const kmRange = Math.min(...kms) === Math.max(...kms) ? `${f0.format(kms[0])} km` : `${f0.format(Math.min(...kms))}–${f0.format(Math.max(...kms))} km`;
    const tireSummary = !tr.all.length ? 'Ikke registreret'
      : !mountedInfos.length ? 'Ingen monteret'
        : `${[...new Set(mountedInfos.map((i) => TYPE_LABEL[i.tire.type]))].join(' / ')} · ${kmRange}`;
    const tireBody = !tr.all.length
      ? `<div class="row"><span class="k">Registrér de dæk der sidder på bilen nu, så deres km følger bilens km fra købet.</span></div>
         <div class="row"><button class="link" data-tire-init>+ Registrér nuværende dæk</button></div>`
      : `<div class="sub">Monteret</div>
         ${Calc.TIRE_POS.map((p) => {
    const i = tr.mounted[p];
    if (!i) return `<button class="row" data-pos-empty="${p}"><span class="k">${TIRE_LABEL[p]}</span><span class="v">Intet dæk ›</span></button>`;
    return `<button class="row" data-tire="${esc(i.tire.id)}"><span class="k">${TIRE_LABEL[p]}<small>${esc(i.tire.name)} · ${TYPE_LABEL[i.tire.type]}</small></span><span class="v">${f0.format(i.kmTotal)} km ›<small>${i.open.dateOn ? `siden ${esc(fmtDate(i.open.dateOn))}` : 'siden køb'} · ${f0.format(i.open.kmUsed)} km</small></span></button>`;
  }).join('')}
         ${tr.stock.length ? `<button class="row" data-stock-toggle aria-expanded="${state.stockOpen}"><span class="k">På lager</span><span class="v">${tr.stock.length} dæk ${state.stockOpen ? '▾' : '▸'}</span></button>${state.stockOpen ? tr.stock.map((i) => `<button class="row" data-tire="${esc(i.tire.id)}"><span class="k">${esc(i.tire.name)}<small>${TYPE_LABEL[i.tire.type]}</small></span><span class="v">${f0.format(i.kmTotal)} km ›</span></button>`).join('') : ''}` : ''}
         <div class="row actions"><button class="link" data-tire-swap>+ Skift dæk</button><button class="link" data-tire-new>+ Nyt dæk</button></div>`;
    const readings = odometer.filter((o) => o.car === car.id).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.km - a.km));
    return `<div class="dpage" data-car="${esc(car.id)}">
      <div class="head"><h1>${esc(car.name)}</h1>${plateButton(car.licensePlate)}</div>
      <div class="hero"><img src="${esc(car.image)}" alt=""></div>
      <div class="big">
        <div class="value">${s.per100 == null ? '–' : f1.format(s.per100)} <span class="unit">kWh / 100 km</span></div>
        <div class="note">${s.latest
          ? (s.per100 == null ? 'Ikke nok data til beregning' : `Beregnet ud fra ${f1.format(s.kwhUsed)} kWh ladet til og med ${esc(fmtDate(s.latest.date))}`)
          : 'Tilføj en km-stand for at beregne forbrug'}</div>
      </div>
      <div class="card pad">
        <label class="switch-row"><span>Inkl. ladning ude<small>Slå fra for kun at se hjemmeladning</small></span><input type="checkbox" class="toggle" data-away ${state.includeAway ? 'checked' : ''}></label>
      </div>
      <div class="card">
        <div class="row"><span class="k">kWh i alt${state.includeAway ? '' : ' (hjemme)'}</span><span class="v">${f1.format(shown.kwh)} kWh</span></div>
        <div class="row"><span class="k">Pris i alt${state.includeAway ? '' : ' (hjemme)'}</span><span class="v">${f2.format(shown.price)} kr.</span></div>
        <div class="row"><span class="k">Hjemme</span><span class="v">${f1.format(home.kwh)} kWh<small>${f2.format(home.price)} kr.</small></span></div>
        <div class="row"><span class="k">Ude</span><span class="v">${f1.format(away.kwh)} kWh<small>${f2.format(away.price)} kr.</small></span></div>
      </div>
      <div class="card">
        <button class="row" data-purchase><span class="k">Km ved køb</span><span class="v">${f0.format(car.kmAtPurchase)} km ›</span></button>
        <div class="row"><span class="k">Seneste km-stand</span><span class="v">${s.latest ? `${f0.format(s.latest.km)} km<small>${esc(fmtDate(s.latest.date))}</small>` : '–'}</span></div>
        <div class="row"><span class="k">Kørt km</span><span class="v">${s.kmDriven == null ? '–' : `${f0.format(s.kmDriven)} km`}</span></div>
      </div>
      <div class="card">
        <button class="row" data-tires-toggle aria-expanded="${state.tiresOpen}"><span class="k">Dæk</span><span class="v">${esc(tireSummary)} ${state.tiresOpen ? '▾' : '▸'}${tr.all.length ? `<small>${tr.stock.length} på lager</small>` : ''}</span></button>
        ${state.tiresOpen ? tireBody : ''}
      </div>
      <div class="sec-head"><h2>Km-stande</h2><button class="link" data-add-km>+ Tilføj km-stand</button></div>
      ${readings.length
        ? `<div class="card">${readings.map((o) => `<button class="row" data-km="${esc(o.id)}"><span class="k">${esc(fmtDate(o.date))}</span><span class="v">${f0.format(o.km)} km ›</span></button>`).join('')}</div>`
        : '<p class="empty">Ingen km-stande endnu</p>'}
    </div>`;
  }

  const detailIndex = () => Math.max(0, state.data.cars.findIndex((c) => c.id === state.detailCar));

  function renderDetail() {
    const pager = $('#detail');
    const active = pager.querySelector(`.dpage[data-car="${state.detailCar}"]`);
    const top = active ? active.scrollTop : 0; // keep the vertical position across re-renders, shared by both cars
    pager.innerHTML = state.data.cars.map(detailPage).join('');
    pager.querySelectorAll('.dpage').forEach((p) => { p.scrollTop = top; });
    $('#detail-dots').innerHTML = state.data.cars.map((c) => `<i class="${c.id === state.detailCar ? 'on' : ''}"></i>`).join('');
    if (state.view === 'detail') pager.scrollLeft = detailIndex() * pager.clientWidth;
  }

  $('#detail').addEventListener('scroll', () => {
    const p = $('#detail');
    const i = Math.round(p.scrollLeft / p.clientWidth);
    const car = state.data && state.data.cars[i];
    if (car && car.id !== state.detailCar) {
      state.detailCar = car.id;
      document.querySelectorAll('#detail-dots i').forEach((d, n) => d.classList.toggle('on', n === i));
    }
  }, { passive: true });

  // Both car pages share one vertical scroll level; only the visible page drives it
  // (a shorter page would otherwise clamp the position back and forth).
  $('#detail').addEventListener('scroll', (e) => {
    const page = e.target;
    if (!page.classList || !page.classList.contains('dpage') || page.dataset.car !== state.detailCar) return;
    document.querySelectorAll('#detail .dpage').forEach((p) => { if (p !== page && p.scrollTop !== page.scrollTop) p.scrollTop = page.scrollTop; });
  }, { capture: true, passive: true });

  $('#detail').addEventListener('change', (e) => {
    if (!e.target.matches('[data-away]')) return;
    state.includeAway = e.target.checked;
    try { localStorage.setItem('evnrg.includeAway', state.includeAway ? '1' : '0'); } catch { /* storage unavailable */ }
    renderDetail();
  });

  $('#detail').addEventListener('click', (e) => {
    const page = e.target.closest('.dpage');
    if (page) state.detailCar = page.dataset.car;
    if (e.target.closest('[data-purchase]')) return openPurchaseSheet();
    if (e.target.closest('[data-plate]')) return openPlateSheet();
    if (e.target.closest('[data-tires-toggle]')) { state.tiresOpen = !state.tiresOpen; state.stockOpen = false; return renderDetail(); }
    if (e.target.closest('[data-stock-toggle]')) { state.stockOpen = !state.stockOpen; return renderDetail(); }
    if (e.target.closest('[data-tire-init]')) return openTireInit();
    if (e.target.closest('[data-tire-swap]')) return openTireChange(Calc.TIRE_POS);
    if (e.target.closest('[data-tire-new]')) return openTireNew();
    const empty = e.target.closest('[data-pos-empty]');
    if (empty) return openTireChange([empty.dataset.posEmpty]);
    const tire = e.target.closest('[data-tire]');
    if (tire) return openTireDetail(tire.dataset.tire);
    if (e.target.closest('[data-add-km]')) return openOdometerSheet(null);
    const km = e.target.closest('[data-km]');
    if (km) openOdometerSheet(km.dataset.km);
  });

  function openPlateSheet() {
    const car = state.data.cars.find((c) => c.id === state.detailCar);
    const sheet = openSheet(`<h2>Nummerplade</h2>
      <form class="form"><label>Nummerplade<input id="s-plate" type="text" maxlength="12" autocapitalize="characters" autocomplete="off" value="${esc(car.licensePlate || '')}" placeholder="AB 12 345"></label>
      <button class="btn primary" type="submit">Gem</button></form>`);
    $('form', sheet).onsubmit = async (e) => {
      e.preventDefault();
      if (await mutate('updateCar', { id: car.id, licensePlate: $('#s-plate', sheet).value })) closeSheet();
    };
  }

  // ---- tires ----
  const carTireData = () => {
    const latest = Calc.latestReading(state.data.odometer, state.detailCar);
    return { latest, ...Calc.carTires(state.detailCar, state.data.tires, state.data.fittings, latest ? latest.km : null) };
  };
  const afterTireChange = () => { state.tiresOpen = true; renderDetail(); closeSheet(); };

  // Put the four tires that are on the car today into the register.
  function openTireInit() {
    const car = state.data.cars.find((c) => c.id === state.detailCar);
    const sheet = openSheet(`<h2>Registrér nuværende dæk</h2>
      <p class="hint">De fire dæk på bilen registreres som monteret fra købet, så deres km følger bilens km.</p>
      <form class="form">
        <label>Type<select id="s-type">${typeOptions('summer')}</select></label>
        <label>Monteret fra km<input id="s-km" type="number" inputmode="numeric" min="0" step="1" value="${car.kmAtPurchase}" required></label>
        <button class="btn primary" type="submit">Gem</button>
      </form>`);
    $('form', sheet).onsubmit = async (e) => {
      e.preventDefault();
      const km = parseFloat($('#s-km', sheet).value);
      if (!(km >= 0)) return;
      if (await mutate('initTires', { car: car.id, type: $('#s-type', sheet).value, date: '', km })) afterTireChange();
    };
  }

  // Add new tires to the register (stock).
  function openTireNew() {
    const sheet = openSheet(`<h2>Nyt dæk</h2>
      <form class="form">
        <label>Navn<input id="s-name" type="text" maxlength="40" autocomplete="off" placeholder="fx Vinter" required></label>
        <label>Type<select id="s-type">${typeOptions('winter')}</select></label>
        <div class="pair">
          <label>Antal<input id="s-count" type="number" inputmode="numeric" min="1" max="8" step="1" value="4"></label>
          <label>Km allerede på dækket<input id="s-start" type="number" inputmode="numeric" min="0" step="1" value="0"></label>
        </div>
        <p class="hint">Ved flere dæk får de numre efter navnet, fx "Vinter 1" til "Vinter 4".</p>
        <button class="btn primary" type="submit">Gem</button>
      </form>`);
    $('form', sheet).onsubmit = async (e) => {
      e.preventDefault();
      const payload = {
        car: state.detailCar,
        name: $('#s-name', sheet).value,
        type: $('#s-type', sheet).value,
        count: parseInt($('#s-count', sheet).value, 10) || 1,
        startKm: parseFloat($('#s-start', sheet).value) || 0,
      };
      if (await mutate('addTire', payload)) afterTireChange();
    };
  }

  // Swap tires on chosen positions. Front and rear can be picked as pairs; each position gets its own tire from stock.
  function openTireChange(initial, removeOnly = false) {
    const carId = state.detailCar;
    const { latest, stock, mounted } = carTireData();
    const selected = new Set(initial);
    const picks = {}; // position -> tire id, '' = take off without a new tire
    const taken = () => new Set(Object.values(picks).filter(Boolean));
    const sheet = openSheet(`<h2>Skift dæk</h2>
      <form class="form">
        <div class="chips">
          <button type="button" class="chip" data-quick="FL,FR">Forrest</button>
          <button type="button" class="chip" data-quick="RL,RR">Bagerst</button>
          <button type="button" class="chip" data-quick="FL,FR,RL,RR">Alle fire</button>
        </div>
        <div class="chips" id="pos-chips">${Calc.TIRE_POS.map((p) => `<button type="button" class="chip" data-chip="${p}">${TIRE_LABEL[p]}</button>`).join('')}</div>
        <div class="form" id="pick-area"></div>
        <label>Dato<input id="s-date" type="date" value="${today()}" required></label>
        <label>Km-stand ved skift<input id="s-km" type="number" inputmode="numeric" min="0" step="1" value="${latest ? latest.km : ''}" placeholder="0" required></label>
        <p class="error" id="s-error"></p>
        <button class="btn primary" type="submit">Gem</button>
      </form>`);

    function draw() {
      for (const p of Calc.TIRE_POS) {
        if (!selected.has(p)) { delete picks[p]; continue; }
        if (picks[p] === undefined) {
          const free = removeOnly ? null : stock.find((i) => !taken().has(i.tire.id));
          picks[p] = free ? free.tire.id : '';
        }
      }
      sheet.querySelectorAll('[data-chip]').forEach((c) => c.classList.toggle('on', selected.has(c.dataset.chip)));
      $('#pick-area', sheet).innerHTML = Calc.TIRE_POS.filter((p) => selected.has(p)).map((p) => `
        <label>${TIRE_LABEL[p]}${mounted[p] ? ` <small>nu: ${esc(mounted[p].tire.name)}</small>` : ''}
          <select data-pick="${p}"><option value="">Intet nyt dæk (tag af)</option>${stock.map((i) => `<option value="${esc(i.tire.id)}" ${picks[p] === i.tire.id ? 'selected' : ''}>${esc(i.tire.name)} · ${TYPE_LABEL[i.tire.type]} · ${f0.format(i.kmTotal)} km</option>`).join('')}</select>
        </label>`).join('') + (stock.length ? '' : '<p class="hint">Ingen dæk på lager. Tilføj dem først med "+ Nyt dæk", eller lad stå for kun at tage dæk af.</p>');
    }
    draw();

    sheet.onclick = (e) => {
      const chip = e.target.closest('[data-chip]');
      const quick = e.target.closest('[data-quick]');
      if (chip) { selected.has(chip.dataset.chip) ? selected.delete(chip.dataset.chip) : selected.add(chip.dataset.chip); draw(); }
      if (quick) { selected.clear(); quick.dataset.quick.split(',').forEach((p) => selected.add(p)); draw(); }
    };
    sheet.onchange = (e) => { if (e.target.dataset.pick) picks[e.target.dataset.pick] = e.target.value; };

    $('form', sheet).onsubmit = async (e) => {
      e.preventDefault();
      const err = $('#s-error', sheet);
      const positions = Calc.TIRE_POS.filter((p) => selected.has(p));
      if (!positions.length) { err.textContent = 'Vælg mindst én plads'; return; }
      const assignments = positions.filter((p) => picks[p]).map((p) => ({ pos: p, tire: picks[p] }));
      if (new Set(assignments.map((a) => a.tire)).size < assignments.length) { err.textContent = 'Det samme dæk er valgt flere gange'; return; }
      const km = parseFloat($('#s-km', sheet).value);
      if (!(km >= 0)) return;
      const date = $('#s-date', sheet).value;
      const removals = positions.filter((p) => !picks[p]);
      let ok = true;
      if (removals.length) ok = await mutate('unmountTires', { car: carId, date, km, positions: removals });
      if (ok && assignments.length) ok = await mutate('mountTires', { car: carId, date, km, assignments });
      if (ok) afterTireChange();
    };
  }

  // One tire: facts, total km, history and actions.
  function openTireDetail(id) {
    const { stock, mounted, all } = carTireData();
    const info = all.find((i) => i.tire.id === id);
    if (!info) return;
    const t = info.tire;
    const pos = info.open ? info.open.pos : null;
    const sheet = openSheet(`<h2>${esc(t.name)}</h2>
      <div class="card">
        <div class="row"><span class="k">Type</span><span class="v">${TYPE_LABEL[t.type]}</span></div>
        <div class="row"><span class="k">Km i alt</span><span class="v">${f0.format(info.kmTotal)} km${t.startKm ? `<small>heraf ${f0.format(t.startKm)} km før registrering</small>` : ''}</span></div>
        <div class="row"><span class="k">Status</span><span class="v">${pos ? `Monteret: ${TIRE_LABEL[pos]}` : 'På lager'}</span></div>
      </div>
      ${info.list.length ? `<div class="sec-head"><h2>Historik</h2></div><div class="card">${info.list.map((f) => `<button class="row" data-fit="${esc(f.id)}"><span class="k">${TIRE_LABEL[f.pos]}<small>${f.dateOn ? esc(fmtDate(f.dateOn)) : 'siden køb'} → ${f.kmOff != null ? esc(fmtDate(f.dateOff)) : 'nu'}</small></span><span class="v">${f0.format(f.kmUsed)} km ›</span></button>`).join('')}</div>` : ''}
      <div class="form">
        ${pos ? '<button class="btn" id="t-off" type="button">Tag af (til lager)</button>' : stock.some((i) => i.tire.id === id) ? '<button class="btn" id="t-on" type="button">Monter dæk</button>' : ''}
        <button class="btn" id="t-edit" type="button">Rediger dæk</button>
        <button class="btn danger" id="t-del" type="button">Slet dæk</button>
      </div>`);
    sheet.onclick = (e) => {
      const fit = e.target.closest('[data-fit]');
      if (fit) openFittingEdit(fit.dataset.fit);
    };
    const off = $('#t-off', sheet);
    if (off) off.onclick = () => openTireChange([pos], true);
    const on = $('#t-on', sheet);
    if (on) on.onclick = () => openTireChange(Calc.TIRE_POS.filter((p) => !mounted[p]).slice(0, 1));
    $('#t-edit', sheet).onclick = () => openTireEdit(id);
    $('#t-del', sheet).onclick = async () => {
      const msg = pos ? `"${t.name}" sidder på bilen nu. Slet dækket og al dets historik?` : `Slet "${t.name}" og al dets historik?`;
      if (confirm(msg) && await mutate('deleteTire', { id })) afterTireChange();
    };
  }

  function openTireEdit(id) {
    const t = state.data.tires.find((x) => x.id === id);
    const sheet = openSheet(`<h2>Rediger dæk</h2>
      <form class="form">
        <label>Navn<input id="s-name" type="text" maxlength="40" value="${esc(t.name)}" required></label>
        <label>Type<select id="s-type">${typeOptions(t.type)}</select></label>
        <label>Km på dækket før registrering<input id="s-start" type="number" inputmode="numeric" min="0" step="1" value="${t.startKm}"></label>
        <button class="btn primary" type="submit">Gem</button>
      </form>`);
    $('form', sheet).onsubmit = async (e) => {
      e.preventDefault();
      const payload = { id, name: $('#s-name', sheet).value, type: $('#s-type', sheet).value, startKm: parseFloat($('#s-start', sheet).value) || 0 };
      if (await mutate('updateTire', payload)) afterTireChange();
    };
  }

  // Correct one fitting (dates and km when it went on and came off).
  function openFittingEdit(fid) {
    const f = state.data.fittings.find((x) => x.id === fid);
    const sheet = openSheet(`<h2>${TIRE_LABEL[f.pos]}</h2>
      <form class="form">
        <div class="pair">
          <label>Monteret den<input id="s-on" type="date" value="${esc(f.dateOn || today())}" required></label>
          <label>Km ved montering<input id="s-kmon" type="number" inputmode="numeric" min="0" step="1" value="${f.kmOn}" required></label>
        </div>
        <div class="pair">
          <label>Afmonteret den<input id="s-off" type="date" value="${esc(f.dateOff)}"></label>
          <label>Km ved afmontering<input id="s-kmoff" type="number" inputmode="numeric" min="0" step="1" value="${f.kmOff == null ? '' : f.kmOff}"></label>
        </div>
        <p class="hint">Lad afmontering stå tom hvis dækket stadig sidder på bilen.</p>
        <p class="error" id="s-error"></p>
        <button class="btn primary" type="submit">Gem</button>
        <button class="btn danger" type="button" id="s-del">Slet registrering</button>
      </form>`);
    $('form', sheet).onsubmit = async (e) => {
      e.preventDefault();
      const kmOn = parseFloat($('#s-kmon', sheet).value);
      const kmOffRaw = $('#s-kmoff', sheet).value;
      const dateOff = $('#s-off', sheet).value;
      if (!(kmOn >= 0)) return;
      if ((kmOffRaw === '') !== (dateOff === '')) { $('#s-error', sheet).textContent = 'Udfyld både dato og km for afmontering, eller ingen af dem'; return; }
      const payload = { id: fid, dateOn: $('#s-on', sheet).value, kmOn, dateOff, kmOff: kmOffRaw === '' ? null : parseFloat(kmOffRaw) };
      if (await mutate('updateFitting', payload)) afterTireChange();
    };
    $('#s-del', sheet).onclick = async () => {
      if (confirm('Slet denne montering?') && await mutate('deleteFitting', { id: fid })) afterTireChange();
    };
  }

  function openPurchaseSheet() {
    const car = state.data.cars.find((c) => c.id === state.detailCar);
    const sheet = openSheet(`<h2>Km ved køb</h2>
      <form class="form"><label>Km<input id="s-km" type="number" inputmode="numeric" min="0" step="1" value="${car.kmAtPurchase}" required></label>
      <button class="btn primary" type="submit">Gem</button></form>`);
    $('#s-km', sheet).focus();
    $('form', sheet).onsubmit = async (e) => {
      e.preventDefault();
      const km = parseFloat($('#s-km', sheet).value);
      if (!(km >= 0)) return;
      if (await mutate('updateCar', { id: car.id, kmAtPurchase: km })) closeSheet();
    };
  }

  function openOdometerSheet(id) {
    const car = state.detailCar;
    const o = id ? state.data.odometer.find((x) => x.id === id) : null;
    const sheet = openSheet(`<h2>${o ? 'Rediger km-stand' : 'Ny km-stand'}</h2>
      <form class="form">
        <label>Dato<input id="s-date" type="date" value="${o ? o.date : today()}" required></label>
        <label>Km-stand<input id="s-km" type="number" inputmode="numeric" min="0" step="1" value="${o ? o.km : ''}" placeholder="0" required></label>
        <p class="error" id="s-error"></p>
        <button class="btn primary" type="submit">Gem</button>
        ${o ? '<button class="btn danger" type="button" id="s-del">Slet</button>' : ''}
      </form>`);
    $('form', sheet).onsubmit = async (e) => {
      e.preventDefault();
      const payload = { car, date: $('#s-date', sheet).value, km: parseFloat($('#s-km', sheet).value) };
      if (!(payload.km >= 0)) return;
      const ok = o ? await mutate('updateOdometer', { ...payload, id: o.id }) : await mutate('addOdometer', payload);
      if (ok) closeSheet();
    };
    const del = $('#s-del', sheet);
    if (del) del.onclick = async () => {
      if (confirm('Slet denne km-stand?') && await mutate('deleteOdometer', { id: o.id })) closeSheet();
    };
  }

  // ---------- data list ----------
  function renderData() {
    const { cars, charges } = state.data;
    const list = charges
      .filter((c) => state.filter === 'all' || c.car === state.filter)
      .filter((c) => state.place === 'all' || (state.place === 'away') === !!c.nonHome)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    const sum = list.reduce((s, c) => ({ kwh: s.kwh + c.kwh, price: s.price + c.price }), { kwh: 0, price: 0 });
    const places = [['all', 'Alle ladninger'], ['home', 'Hjemme'], ['away', 'Ude']];
    const groups = []; // list is sorted newest first, so months come out newest first too
    for (const c of list) {
      const key = Calc.monthOf(c.date);
      let g = groups[groups.length - 1];
      if (!g || g.key !== key) { g = { key, items: [], kwh: 0, price: 0 }; groups.push(g); }
      g.items.push(c);
      g.kwh += c.kwh;
      g.price += c.price;
    }
    $('#data').innerHTML = `
      <div class="head"><h1>Data</h1></div>
      <div class="seg"><button data-f="all" class="${state.filter === 'all' ? 'on' : ''}">Alle</button>${cars.map((c) => `<button data-f="${esc(c.id)}" class="${state.filter === c.id ? 'on' : ''}">${esc(c.name)}</button>`).join('')}</div>
      <div class="seg">${places.map(([k, label]) => `<button data-place="${k}" class="${state.place === k ? 'on' : ''}">${label}</button>`).join('')}</div>
      ${list.length ? `<p class="summary">${list.length} ladninger · ${f1.format(sum.kwh)} kWh · ${f2.format(sum.price)} kr.${sum.kwh > 0 ? ` · ${f2.format(sum.price / sum.kwh)} kr./kWh` : ''}</p>` : ''}
      ${list.length
        ? groups.map((g) => `
          <button class="mhead" data-toggle="${g.key}" aria-expanded="${!state.collapsed.has(g.key)}"><b>${state.collapsed.has(g.key) ? '▸' : '▾'} ${esc(fmtMonth(g.key))}</b><span>${g.items.length} · ${f1.format(g.kwh)} kWh · ${f0.format(g.price)} kr.</span></button>
          ${state.collapsed.has(g.key) ? '' : g.items.map((c) => `<button class="item" data-id="${esc(c.id)}"><div class="l"><b>${esc(fmtDate(c.date))}</b><span>${esc(carName(c.car))}${c.nonHome ? '<em class="tag">Ude</em>' : ''}</span></div><div class="r">${f2.format(c.kwh)} kWh<span>${f2.format(c.price)} kr.</span><span>${f2.format(c.kwh > 0 ? c.price / c.kwh : 0)} kr./kWh</span></div></button>`).join('')}`).join('')
        : '<p class="empty">Ingen data endnu</p>'}
    `;
  }
  $('#data').addEventListener('click', (e) => {
    const f = e.target.closest('[data-f]');
    if (f) { state.filter = f.dataset.f; return renderData(); }
    const tg = e.target.closest('[data-toggle]');
    if (tg) {
      const k = tg.dataset.toggle;
      if (!state.collapsed.delete(k)) state.collapsed.add(k);
      try { localStorage.setItem('evnrg.collapsed', JSON.stringify([...state.collapsed])); } catch { /* storage unavailable */ }
      return renderData();
    }
    const pl = e.target.closest('[data-place]');
    if (pl) { state.place = pl.dataset.place; return renderData(); }
    const it = e.target.closest('[data-id]');
    if (it) openForm(it.dataset.id, null, 'data');
  });

  function renderAll() {
    renderOverview();
    renderDetail();
    renderData();
    renderPlan();
  }

  // ---------- cheapest charging ----------
  const SETTINGS_KEY = 'evnrg.plan';
  const CAR_COLORS = ['#0e7490', '#e67e22'];
  const plan = { s: JSON.parse(JSON.stringify(Planner.DEFAULTS)), raw: null, loadedAt: 0, loading: false, error: false };
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    if (saved && saved.v === Planner.DEFAULTS.v) {
      Object.assign(plan.s, saved, { tariff: { winter: { ...plan.s.tariff.winter, ...(saved.tariff || {}).winter }, summer: { ...plan.s.tariff.summer, ...(saved.tariff || {}).summer } } });
    }
  } catch { /* storage unavailable or corrupt */ }

  const TARIFF_IDS = [['winter', 'low'], ['winter', 'high'], ['winter', 'peak'], ['summer', 'low'], ['summer', 'high'], ['summer', 'peak']];
  const SIMPLE_IDS = { 's-power': 'powerKw', 's-loss': 'lossPct', 's-supplement': 'supplement', 's-energinet': 'energinet', 's-elafgift': 'elafgift', 's-vat': 'vatPct', 'p-from': 'from', 'p-to': 'to' };

  function fillPlanInputs() {
    for (const [id, key] of Object.entries(SIMPLE_IDS)) $('#' + id).value = plan.s[key];
    for (const [se, b] of TARIFF_IDS) $(`#t-${se}-${b}`).value = plan.s.tariff[se][b];
    $('#p-ready').value = plan.s.readyBy;
  }

  function readPlanInputs() {
    const num = (id, fallback) => {
      const v = parseFloat($('#' + id).value.replace(',', '.'));
      return Number.isFinite(v) ? v : fallback;
    };
    for (const [id, key] of Object.entries(SIMPLE_IDS)) plan.s[key] = num(id, Planner.DEFAULTS[key]);
    for (const [se, b] of TARIFF_IDS) plan.s.tariff[se][b] = num(`t-${se}-${b}`, 0);
    plan.s.readyBy = $('#p-ready').value || Planner.DEFAULTS.readyBy;
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(plan.s)); } catch { /* storage unavailable */ }
  }

  $('#view-plan').addEventListener('input', () => { readPlanInputs(); renderPlan(); });
  $('#s-reset').addEventListener('click', () => {
    plan.s = JSON.parse(JSON.stringify(Planner.DEFAULTS));
    try { localStorage.removeItem(SETTINGS_KEY); } catch { /* storage unavailable */ }
    fillPlanInputs();
    renderPlan();
  });
  $('#plan-results').addEventListener('click', (e) => {
    if (e.target.closest('[data-retry]')) loadPrices(true);
  });

  async function fetchDay(date) {
    const p = (n) => String(n).padStart(2, '0');
    const url = `https://www.elprisenligenu.dk/api/v1/prices/${date.getFullYear()}/${p(date.getMonth() + 1)}-${p(date.getDate())}_DK2.json`;
    const res = await fetch(url);
    return res.ok ? res.json() : null; // tomorrow is 404 until published (about 13:00)
  }

  async function loadPrices(force) {
    if (!force && plan.raw && Date.now() - plan.loadedAt < 30 * 60000) return renderPlan();
    plan.loading = true;
    plan.error = false;
    renderPlan();
    try {
      const now = new Date();
      const [today, tomorrow] = await Promise.all([fetchDay(now), fetchDay(new Date(now.getTime() + 86400000)).catch(() => null)]);
      if (!today) throw new Error('no prices');
      plan.raw = today.concat(tomorrow || []);
      plan.loadedAt = Date.now();
    } catch {
      plan.error = true;
    }
    plan.loading = false;
    renderPlan();
  }

  const pad2 = (n) => String(n).padStart(2, '0');
  const clock = (t) => `${pad2(new Date(t).getHours())}:${pad2(new Date(t).getMinutes())}`;
  const dayKey = (t) => { const d = new Date(t); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); };
  const dayLabel = (t, now) => (dayKey(t) === dayKey(now) ? 'i dag' : dayKey(t) === dayKey(now + 86400000) ? 'i morgen' : new Date(t).toLocaleDateString('da-DK', { weekday: 'long' }));
  const duration = (ms) => { const m = Math.round(ms / 60000); return `${Math.floor(m / 60)} t ${pad2(m % 60)} min`; };

  function renderPlan() {
    const box = $('#plan-results');
    const s = plan.s;
    const untaxed = TARIFF_IDS.every(([se, b]) => !s.tariff[se][b]);
    const note = $('#plan-note');
    note.classList.toggle('hidden', !untaxed);
    note.textContent = 'Nettarif er ikke indtastet under Indstillinger. Prisen er derfor kun spotpris + afgifter, og dyr spidstid (17–21) tæller ikke med.';

    if (plan.loading) { box.innerHTML = '<p class="empty">Henter elpriser…</p>'; return; }
    if (plan.error) { box.innerHTML = '<p class="empty">Kunne ikke hente elpriser.</p><button class="btn" data-retry>Prøv igen</button>'; return; }
    if (!plan.raw || !state.data) { box.innerHTML = ''; return; }
    if (!(s.to > s.from) || s.to > 100 || s.from < 0) { box.innerHTML = '<p class="empty">Mål % skal være højere end nuværende %.</p>'; return; }

    const now = Date.now();
    const prices = Planner.buildPrices(plan.raw, s);
    const deadline = Planner.deadlineAfter(now, s.readyBy);
    const cars = state.data.cars.filter((c) => Planner.BATTERY_KWH[c.id]);
    const results = cars.map((c, i) => {
      const kwh = Planner.energyNeeded(c.id, s.from, s.to, s.lossPct);
      return { car: c, color: CAR_COLORS[i % CAR_COLORS.length], kwh, r: Planner.plan(prices, now, deadline, kwh, s.powerKw) };
    });

    const cards = results.map(({ car, color, kwh, r }) => {
      const head = `<h2><span><i class="dot" style="background:${color}"></i>${esc(car.name)}</span><span>${f1.format(kwh)} kWh · ${duration(r.durationMs)}</span></h2>`;
      if (!r.best && r.limited) {
        const l = r.limited;
        const pct = Math.min(s.to, Planner.reachedPct(car.id, s.from, l.kwh, s.lossPct));
        return `<div class="plan-car">${head}
          <div class="when">Når op på ca. ${pct} %</div>
          <div class="until">Når ikke ${s.to} % inden kl. ${clock(deadline)} (kræver ${duration(r.durationMs)}). Start nu for at nå længst.</div>
          <div class="row"><span class="k">Lader</span><span class="v">kl. ${clock(l.start)} – ${clock(l.end)}</span></div>
          <div class="row"><span class="k">Energi</span><span class="v">${f1.format(l.kwh)} kWh</span></div>
          ${l.cost != null ? `<div class="row"><span class="k">Pris for ladningen</span><span class="v">${f2.format(l.cost)} kr.</span></div>` : ''}
        </div>`;
      }
      if (!r.best) {
        return `<div class="plan-car">${head}<p class="until">Der er endnu ikke priser nok frem til kl. ${clock(deadline)}. Morgendagens priser kommer ca. kl. 13.</p></div>`;
      }
      const b = r.best;
      const first = Math.ceil(now / 900000) * 900000;
      const start = b.start === first ? `Start nu (kl. ${clock(b.start)})` : `${dayLabel(b.start, now)} kl. ${clock(b.start)}`;
      const endDay = dayKey(b.end) === dayKey(b.start) ? '' : `${dayLabel(b.end, now)} `;
      const saving = r.now ? r.now.cost - b.cost : 0;
      return `<div class="plan-car">${head}
        <div class="when">${esc(start)}</div>
        <div class="until">til ${esc(endDay)}kl. ${clock(b.end)}${r.partial ? ' · foreløbigt' : ''}</div>
        <div class="row"><span class="k">Pris for ladningen</span><span class="v">${f2.format(b.cost)} kr.</span></div>
        <div class="row"><span class="k">Gns. pris</span><span class="v">${f2.format(b.cost / kwh)} kr./kWh</span></div>
        ${r.now ? `<div class="row"><span class="k">Hvis du starter nu</span><span class="v">${f2.format(r.now.cost)} kr.</span></div>` : ''}
        ${r.now && saving > 0.005 ? `<div class="row"><span class="k">Du sparer</span><span class="v save">${f2.format(saving)} kr.</span></div>` : ''}
      </div>`;
    }).join('');

    const partial = results.some(({ r }) => r.partial) ? '<p class="hint" style="margin:0 2px 14px">Morgendagens priser kommer ca. kl. 13. Resultatet kan ændre sig.</p>' : '';
    box.innerHTML = cards + partial + planChart(prices, results, now);
  }

  function planChart(prices, results, now) {
    const until = Math.max(...results.map(({ r }) => r.until));
    const bars = prices.filter((p) => p.end > now && p.start < until);
    if (bars.length < 2) return '';
    const W = 340, left = 34, right = 6, top = 8, plotH = 100;
    const t0 = bars[0].start, t1 = bars[bars.length - 1].end;
    const x = (t) => left + ((Math.min(Math.max(t, t0), t1) - t0) / (t1 - t0)) * (W - left - right);
    const max = Math.max(...bars.map((p) => p.total), 0.01);
    const rects = bars.map((p) => {
      const h = Math.max(0, p.total / max) * plotH;
      return `<rect x="${x(p.start).toFixed(1)}" y="${(top + plotH - h).toFixed(1)}" width="${Math.max(1, x(p.end) - x(p.start) - 1).toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" fill="#c6cbd1"/>`;
    }).join('');
    const labels = bars.filter((p) => new Date(p.start).getMinutes() === 0 && new Date(p.start).getHours() % 3 === 0)
      .map((p) => `<text x="${x(p.start).toFixed(1)}" y="${top + plotH + 14}" font-size="9" fill="#7a828c">${pad2(new Date(p.start).getHours())}</text>`).join('');
    const rows = results.map(({ color, r }, i) => {
      const blk = r.best || r.limited;
      return blk
        ? `<rect x="${x(blk.start).toFixed(1)}" y="${top + plotH + 22 + i * 11}" width="${Math.max(2, x(blk.end) - x(blk.start)).toFixed(1)}" height="7" rx="3" fill="${color}"/>`
        : '';
    }).join('');
    const H = top + plotH + 22 + results.length * 11 + 2;
    return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Elpris pr. time">
      <text x="${left - 4}" y="${top + 8}" font-size="9" text-anchor="end" fill="#7a828c">${f2.format(max)}</text>
      <text x="${left - 4}" y="${top + plotH}" font-size="9" text-anchor="end" fill="#7a828c">0</text>
      ${rects}${labels}${rows}</svg>
      <div class="legend"><span>kr./kWh inkl. afgifter og moms</span>${results.map(({ car, color }) => `<span><i class="dot" style="background:${color}"></i>${esc(car.name)}</span>`).join('')}</div></div>`;
  }

  fillPlanInputs();

  // ---------- auth ----------
  function logout() {
    Api.setToken(null);
    $('#app').classList.add('hidden');
    $('#login').classList.remove('hidden');
    $('#passphrase').value = '';
  }

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#login-error').textContent = '';
    busy(true);
    try {
      const res = await Api.call('login', { passphrase: $('#passphrase').value });
      Api.setToken(res.token);
      await start();
    } catch (err) {
      $('#login-error').textContent = err.message;
    } finally {
      busy(false);
    }
  });

  async function start() {
    $('#login').classList.add('hidden');
    $('#app').classList.remove('hidden');
    const cached = Api.getCache();
    if (cached) setData({ ok: true, ...cached });
    try {
      const fresh = await Api.call('getAll');
      setData(fresh);
      if (!Api.demo && (!('fittings' in fresh) || (fresh.charges.length && !('nonHome' in fresh.charges[0])))) {
        toast('Backend er ikke opdateret: udgiv en ny version i Apps Script');
      }
    } catch (e) {
      if (e.code === 'AUTH') return logout();
      if (!cached) toast(e.message);
    }
    show(state.view);
  }

  if (Api.getToken()) start();
  else $('#login').classList.remove('hidden');

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
