(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const state = {
    data: null,
    view: 'overview',
    returnView: 'overview',
    page: 0, // 0 = car 1, 1 = car 2, 2 = total
    month: [null, null, null], // selected month per page; null = current month
    detailCar: null,
    filter: 'all',
    editing: null, // charge id being edited
    includeAway: true, // Bildetaljer: include charges made away from home
  };
  try { state.includeAway = localStorage.getItem('evnrg.includeAway') !== '0'; } catch { /* storage unavailable */ }

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
    state.data = { cars: res.cars, charges: res.charges, odometer: res.odometer };
    Api.setCache(state.data);
    if (!state.detailCar) state.detailCar = state.data.cars[0].id;
    renderAll();
  }

  function openSheet(html) {
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
    for (const v of ['overview', 'detail', 'data', 'form']) $(`#view-${v}`).classList.toggle('hidden', v !== view);
    const navView = view === 'form' ? state.returnView : view;
    document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === navView));
    if (view === 'overview') {
      const pager = $('#pager');
      pager.scrollLeft = state.page * pager.clientWidth;
    }
  }
  $('#nav').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.view === 'detail' && state.page < 2) state.detailCar = state.data.cars[state.page].id;
    closeSheet();
    show(b.dataset.view);
    renderAll();
  });

  // ---------- overview ----------
  function renderOverview() {
    const { cars, charges } = state.data;
    const pager = $('#pager');
    pager.innerHTML = [0, 1, 2].map((i) => {
      const car = pageCar(i);
      const scope = car ? car.id : null;
      const month = state.month[i] || currentMonth();
      const m = Calc.totals(charges, scope, month);
      const all = Calc.totals(charges, scope, null);
      const hero = car
        ? `<div class="hero"><img src="${esc(car.image)}" alt="${esc(car.name)}"></div>`
        : `<div class="hero two">${cars.map((c) => `<img src="${esc(c.image)}" alt="${esc(c.name)}">`).join('')}</div>`;
      const label = month === currentMonth() ? 'Denne måned' : fmtMonth(month);
      return `<div class="page" data-i="${i}">
        <div class="head"><h1>${esc(car ? car.name : 'Total')}</h1><button class="plus" data-add="${i}" aria-label="Tilføj ladning">+</button></div>
        ${hero}
        <div class="grid">
          <button class="box" data-month="${i}"><div class="label"><span>${esc(label)}</span><span class="chev">▾</span></div><div class="value">${f1.format(m.kwh)} <span class="unit">kWh</span></div></button>
          <button class="box" data-month="${i}"><div class="label"><span>${esc(label)}</span><span class="chev">▾</span></div><div class="value">${f0.format(m.price)} <span class="unit">kr.</span></div></button>
          <div class="box"><div class="label"><span>I alt</span></div><div class="value">${f1.format(all.kwh)} <span class="unit">kWh</span></div></div>
          <div class="box"><div class="label"><span>I alt</span></div><div class="value">${f0.format(all.price)} <span class="unit">kr.</span></div></div>
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
    if (mb) openMonthPicker(+mb.dataset.month);
  });

  function openMonthPicker(i) {
    const car = pageCar(i);
    const list = Calc.months(state.data.charges, car ? car.id : null);
    const sel = state.month[i] || currentMonth();
    const sheet = openSheet(`<h2>Vælg måned</h2>${
      list.length
        ? list.map((m) => `<button class="month-opt ${m === sel ? 'on' : ''}" data-m="${m}"><span>${esc(fmtMonth(m))}</span>${m === sel ? '<span>✓</span>' : ''}</button>`).join('')
        : '<p class="empty">Ingen data endnu</p>'
    }`);
    sheet.onclick = (e) => {
      const b = e.target.closest('[data-m]');
      if (!b) return;
      state.month[i] = b.dataset.m;
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
  function renderDetail() {
    const { cars, charges, odometer } = state.data;
    const car = cars.find((c) => c.id === state.detailCar) || cars[0];
    const s = Calc.carStats(car, charges, odometer);
    const shown = Calc.totals(charges, car.id, null, state.includeAway ? 'all' : 'home');
    const home = Calc.totals(charges, car.id, null, 'home');
    const away = Calc.totals(charges, car.id, null, 'away');
    const readings = odometer.filter((o) => o.car === car.id).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.km - a.km));
    $('#detail').innerHTML = `
      <div class="head"><h1>${esc(car.name)}</h1></div>
      <div class="seg">${cars.map((c) => `<button data-car="${esc(c.id)}" class="${c.id === car.id ? 'on' : ''}">${esc(c.name)}</button>`).join('')}</div>
      <div class="hero"><img src="${esc(car.image)}" alt=""></div>
      <div class="big">
        <div class="value">${s.per100 == null ? '–' : f1.format(s.per100)} <span class="unit">kWh / 100 km</span></div>
        <div class="note">${s.latest
          ? (s.per100 == null ? 'Ikke nok data til beregning' : `Beregnet ud fra ${f1.format(s.kwhUsed)} kWh ladet til og med ${esc(fmtDate(s.latest.date))}`)
          : 'Tilføj en km-stand for at beregne forbrug'}</div>
      </div>
      <div class="card pad">
        <label class="switch-row"><span>Inkl. ladning væk hjemme<small>Slå fra for kun at se hjemmeladning</small></span><input type="checkbox" class="toggle" data-away ${state.includeAway ? 'checked' : ''}></label>
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
      <div class="sec-head"><h2>Km-stande</h2><button class="link" data-add-km>+ Tilføj km-stand</button></div>
      ${readings.length
        ? `<div class="card">${readings.map((o) => `<button class="row" data-km="${esc(o.id)}"><span class="k">${esc(fmtDate(o.date))}</span><span class="v">${f0.format(o.km)} km ›</span></button>`).join('')}</div>`
        : '<p class="empty">Ingen km-stande endnu</p>'}
    `;
  }

  $('#detail').addEventListener('change', (e) => {
    if (!e.target.matches('[data-away]')) return;
    state.includeAway = e.target.checked;
    try { localStorage.setItem('evnrg.includeAway', state.includeAway ? '1' : '0'); } catch { /* storage unavailable */ }
    renderDetail();
  });

  $('#detail').addEventListener('click', (e) => {
    const car = e.target.closest('[data-car]');
    if (car) { state.detailCar = car.dataset.car; return renderDetail(); }
    if (e.target.closest('[data-purchase]')) return openPurchaseSheet();
    if (e.target.closest('[data-add-km]')) return openOdometerSheet(null);
    const km = e.target.closest('[data-km]');
    if (km) openOdometerSheet(km.dataset.km);
  });

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
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    $('#data').innerHTML = `
      <div class="head"><h1>Data</h1></div>
      <div class="seg"><button data-f="all" class="${state.filter === 'all' ? 'on' : ''}">Alle</button>${cars.map((c) => `<button data-f="${esc(c.id)}" class="${state.filter === c.id ? 'on' : ''}">${esc(c.name)}</button>`).join('')}</div>
      ${list.length
        ? list.map((c) => `<button class="item" data-id="${esc(c.id)}"><div class="l"><b>${esc(fmtDate(c.date))}</b><span>${esc(carName(c.car))}${c.nonHome ? '<em class="tag">Ude</em>' : ''}</span></div><div class="r">${f2.format(c.kwh)} kWh<span>${f2.format(c.price)} kr.</span></div></button>`).join('')
        : '<p class="empty">Ingen data endnu</p>'}
    `;
  }
  $('#data').addEventListener('click', (e) => {
    const f = e.target.closest('[data-f]');
    if (f) { state.filter = f.dataset.f; return renderData(); }
    const it = e.target.closest('[data-id]');
    if (it) openForm(it.dataset.id, null, 'data');
  });

  function renderAll() {
    renderOverview();
    renderDetail();
    renderData();
  }

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
      setData(await Api.call('getAll'));
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
