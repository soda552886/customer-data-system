let sites = [];
let current = null;

const DIM_HEADERS = `
  <tr>
    <th>項目</th><th>前期累計</th><th>本週小計</th><th>目前累計</th>
    <th>佔本週來人%</th><th>佔累計來人%</th>
    <th>本週成交</th><th>佔本週成交%</th>
  </tr>`;

function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast ${type}`;
  setTimeout(() => toast.classList.add('hidden'), 3000);
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function toYmd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseYmd(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, m - 1, d);
}

function mondayOf(d) {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  return x;
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function updateRangeLabel() {
  const startEl = document.getElementById('weekStart');
  const label = document.getElementById('weekRangeLabel');
  if (!startEl.value) {
    label.textContent = '—';
    return;
  }
  const start = mondayOf(parseYmd(startEl.value));
  const end = addDays(start, 6);
  startEl.value = toYmd(start);
  label.textContent = `${toYmd(start)} ～ ${toYmd(end)}`;
}

async function loadSites() {
  const res = await fetch('/api/sites');
  sites = await res.json();
  const sel = document.getElementById('weekSite');
  sites.forEach((s) => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.name;
    sel.appendChild(opt);
  });
  const duoyi = sites.find((s) => s.id === 'libao_duoyi' || s.name.includes('鐸藝'));
  if (duoyi) sel.value = duoyi.id;
}

async function loadMeta() {
  try {
    const res = await fetch('/api/weekly/meta');
    if (!res.ok) return;
    const json = await res.json();
    document.getElementById('weekStart').value = json.defaultWeekStart;
    document.getElementById('weekNumber').value = json.defaultWeekNumber;
    updateRangeLabel();
  } catch { /* ignore */ }
}

function collectManualFromForm(baseManual) {
  const manual = JSON.parse(JSON.stringify(baseManual || {}));
  manual.weekNumber = Number(document.getElementById('weekNumber').value) || manual.weekNumber || null;

  const days = manual.days || [];
  document.querySelectorAll('#dailyTable tbody tr').forEach((tr, idx) => {
    if (!days[idx]) return;
    const phone = tr.querySelector('[data-field="phoneCalls"]');
    const weather = tr.querySelector('[data-field="weather"]');
    if (phone) days[idx].phoneCalls = Number(phone.value) || 0;
    if (weather) days[idx].weather = weather.value.trim();
  });
  manual.days = days;

  ['deals', 'signings', 'purchases', 'unreported'].forEach((key) => {
    manual[key] = manual[key] || { units: 0, parking: 0, amount: 0 };
    ['units', 'parking', 'amount'].forEach((f) => {
      const el = document.querySelector(`[data-block="${key}"][data-field="${f}"]`);
      if (el) manual[key][f] = Number(el.value) || 0;
    });
  });

  manual.inventory = manual.inventory || {};
  [
    'totalUnits', 'soldUnits', 'totalParking', 'soldParking',
    'totalAmount', 'soldAmount', 'soldBasePrice',
    'residentialTotal', 'residentialSold', 'officeTotal', 'officeSold',
  ].forEach((f) => {
    const el = document.querySelector(`[data-block="inventory"][data-field="${f}"]`);
    if (el) manual.inventory[f] = Number(el.value) || 0;
  });

  manual.commission = manual.commission || {};
  [
    'sellableAmount', 'claimableAmount', 'claimedAmount', 'bookedAmount',
    'claimableUnits', 'claimableParking', 'claimedUnits', 'claimedParking',
    'nextMonthUnits', 'nextMonthParking', 'nextMonthAmount',
  ].forEach((f) => {
    const el = document.querySelector(`[data-block="commission"][data-field="${f}"]`);
    if (el) manual.commission[f] = Number(el.value) || 0;
  });

  manual.includedVisitorIds = collectSelectedVisitorIds();

  manual.reviewNotes = document.getElementById('reviewNotes').value;
  manual.competitorNotes = document.getElementById('competitorNotes').value;
  manual.memo = document.getElementById('weekMemo').value;
  return manual;
}

function collectSelectedVisitorIds() {
  const boxes = document.querySelectorAll('#visitorSelectTable tbody input[type="checkbox"][data-id]');
  if (!boxes.length) {
    return current?.manual?.includedVisitorIds ?? null;
  }
  return Array.from(boxes)
    .filter((cb) => cb.checked)
    .map((cb) => Number(cb.dataset.id));
}

function calcInventoryDerived(inv) {
  const n = (k) => Number(inv[k]) || 0;
  const rate = (sold, total) => (total ? Math.round((sold / total) * 10000) / 100 : 0);
  return {
    unitRate: rate(n('soldUnits'), n('totalUnits')),
    parkingRate: rate(n('soldParking'), n('totalParking')),
    amountRate: rate(n('soldAmount'), n('totalAmount')),
    basePriceRate: rate(n('soldBasePrice'), n('totalAmount')),
    residentialRate: rate(n('residentialSold'), n('residentialTotal')),
    officeRate: rate(n('officeSold'), n('officeTotal')),
    remainUnits: Math.max(n('totalUnits') - n('soldUnits'), 0),
    remainParking: Math.max(n('totalParking') - n('soldParking'), 0),
    remainAmount: Math.max(n('totalAmount') - n('soldAmount'), 0),
    remainBasePrice: Math.max(n('totalAmount') - n('soldBasePrice'), 0),
  };
}

function calcCommissionDerived(c) {
  const n = (k) => Number(c[k]) || 0;
  const round4 = (x) => Math.round(x * 10000) / 10000;
  return {
    unclaimedAmount: round4(Math.max(n('claimableAmount') - n('claimedAmount'), 0)),
    unclaimedUnits: Math.max(n('claimableUnits') - n('claimedUnits'), 0),
    unclaimedParking: Math.max(n('claimableParking') - n('claimedParking'), 0),
    bookedAmount: round4(n('bookedAmount')),
    nextMonthUnits: n('nextMonthUnits'),
    nextMonthParking: n('nextMonthParking'),
    nextMonthAmount: round4(n('nextMonthAmount')),
  };
}

function renderDerivedCards(elId, items) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.innerHTML = items.map((it) => `
    <div class="stat-card">
      <div class="stat-label">${escapeHtml(it.label)}</div>
      <div class="stat-value">${escapeHtml(it.value)}</div>
    </div>
  `).join('');
}

function renderKpi(auto, manual) {
  const t = auto.totals || {};
  const p = auto.period || {};
  const phoneSum = (manual.days || []).reduce((s, d) => s + (Number(d.phoneCalls) || 0), 0);
  const deals = manual.deals || {};
  const mw = p.month || {};
  const yw = p.year || {};
  const items = [
    { label: '實際來人', value: `${t.actualTotal ?? t.total ?? 0} 組` },
    { label: '納入週報', value: `${t.reportedTotal ?? t.total ?? 0} 組` },
    { label: '新客／回訪', value: `${t.new || 0} / ${t.return || 0}` },
    { label: '本週來電', value: `${phoneSum} 通` },
    { label: '客資成交', value: `${t.deal || 0} 筆` },
    { label: '手填成交', value: `${deals.units || 0} 戶／${deals.parking || 0} 車` },
    { label: '成交金額', value: `${deals.amount || 0} 萬` },
    { label: '本月來人／成交', value: `${mw.visits || 0} / ${mw.deals || 0}` },
    { label: '本年來人／成交', value: `${yw.visits || 0} / ${yw.deals || 0}` },
  ];
  document.getElementById('kpiGrid').innerHTML = items.map((it) => `
    <div class="stat-card">
      <div class="stat-label">${escapeHtml(it.label)}</div>
      <div class="stat-value">${escapeHtml(it.value)}</div>
    </div>
  `).join('');
}

function renderDaily(auto, manual) {
  const byDay = auto.byDay || [];
  const days = manual.days || [];
  const tbody = document.querySelector('#dailyTable tbody');
  tbody.innerHTML = byDay.map((d, i) => {
    const m = days[i] || {};
    return `<tr>
      <td class="cell-date">${escapeHtml(d.date)}</td>
      <td>${escapeHtml(d.weekday)}</td>
      <td>${d.new}</td>
      <td>${d.return}</td>
      <td><strong>${d.total}</strong></td>
      <td>${d.deal}</td>
      <td><input type="number" min="0" class="table-input" data-field="phoneCalls" value="${Number(m.phoneCalls) || 0}"></td>
      <td><input type="text" class="table-input" data-field="weather" value="${escapeHtml(m.weather || '')}" placeholder="晴／陰／雨"></td>
    </tr>`;
  }).join('');
}

function renderDealInputs(manual) {
  const blocks = [
    { key: 'deals', title: '本週成交' },
    { key: 'signings', title: '本週簽約' },
    { key: 'purchases', title: '本週買進' },
    { key: 'unreported', title: '未報' },
  ];
  document.getElementById('dealInputs').innerHTML = blocks.map((b) => {
    const v = manual[b.key] || {};
    return `
      <div class="form-group"><label>${b.title} 戶</label>
        <input type="number" min="0" data-block="${b.key}" data-field="units" value="${Number(v.units) || 0}"></div>
      <div class="form-group"><label>${b.title} 車</label>
        <input type="number" min="0" data-block="${b.key}" data-field="parking" value="${Number(v.parking) || 0}"></div>
      <div class="form-group"><label>${b.title} 金額(萬)</label>
        <input type="number" min="0" step="0.01" data-block="${b.key}" data-field="amount" value="${Number(v.amount) || 0}"></div>
    `;
  }).join('');
}

function renderInventory(manual, derived) {
  const inv = manual.inventory || {};
  const fields = [
    { key: 'totalUnits', label: '總戶數' },
    { key: 'soldUnits', label: '已售戶數' },
    { key: 'totalParking', label: '總車位' },
    { key: 'soldParking', label: '已售車位' },
    { key: 'totalAmount', label: '總底價金額(萬)' },
    { key: 'soldAmount', label: '已售表價(萬)' },
    { key: 'soldBasePrice', label: '已售底價(萬)' },
    { key: 'residentialTotal', label: '住宅總戶' },
    { key: 'residentialSold', label: '住宅已售' },
    { key: 'officeTotal', label: '事務所總戶' },
    { key: 'officeSold', label: '事務所已售' },
  ];
  document.getElementById('inventoryInputs').innerHTML = fields.map((f) => `
    <div class="form-group">
      <label>${f.label}</label>
      <input type="number" min="0" step="0.01" data-block="inventory" data-field="${f.key}" value="${Number(inv[f.key]) || 0}">
    </div>
  `).join('');
  const d = derived || calcInventoryDerived(inv);
  renderDerivedCards('inventoryDerived', [
    { label: '戶數去化率', value: `${d.unitRate}%` },
    { label: '車位去化率', value: `${d.parkingRate}%` },
    { label: '表價去化率', value: `${d.amountRate}%` },
    { label: '底價去化率', value: `${d.basePriceRate}%` },
    { label: '未售底價(萬)', value: `${d.remainBasePrice}` },
    { label: '剩餘戶／車', value: `${d.remainUnits} / ${d.remainParking}` },
  ]);
  document.querySelectorAll('[data-block="inventory"]').forEach((el) => {
    el.addEventListener('input', refreshDerivedFromForm);
  });
}

function renderCommission(manual, derived) {
  const c = manual.commission || {};
  const fields = [
    { key: 'sellableAmount', label: '累積銷售金額(萬)' },
    { key: 'claimableAmount', label: '可請佣金額(萬)', step: '0.0001' },
    { key: 'claimedAmount', label: '已請佣金額(萬)', step: '0.0001' },
    { key: 'bookedAmount', label: '已入帳金額(萬)', step: '0.0001' },
    { key: 'claimableUnits', label: '可請佣戶數' },
    { key: 'claimedUnits', label: '已請佣戶數' },
    { key: 'claimableParking', label: '可請佣車位' },
    { key: 'claimedParking', label: '已請佣車位' },
    { key: 'nextMonthUnits', label: '預計下月可請戶數' },
    { key: 'nextMonthParking', label: '預計下月可請車位' },
    { key: 'nextMonthAmount', label: '預計下月可請金額(萬)', step: '0.0001' },
  ];
  document.getElementById('commissionInputs').innerHTML = fields.map((f) => `
    <div class="form-group">
      <label>${f.label}</label>
      <input type="number" min="0" step="${f.step || '0.01'}" data-block="commission" data-field="${f.key}" value="${Number(c[f.key]) || 0}">
    </div>
  `).join('');
  const d = derived || calcCommissionDerived(c);
  renderDerivedCards('commissionDerived', [
    { label: '未請佣金額(萬)', value: `${d.unclaimedAmount}` },
    { label: '未請佣戶數', value: `${d.unclaimedUnits}` },
    { label: '未請佣車位', value: `${d.unclaimedParking}` },
    { label: '已入帳(萬)', value: `${d.bookedAmount}` },
    { label: '下月可請(戶/車/萬)', value: `${d.nextMonthUnits} / ${d.nextMonthParking} / ${d.nextMonthAmount}` },
  ]);
  document.querySelectorAll('[data-block="commission"]').forEach((el) => {
    el.addEventListener('input', refreshDerivedFromForm);
  });
}

function refreshDerivedFromForm() {
  if (!current) return;
  const manual = collectManualFromForm(current.manual);
  const inv = calcInventoryDerived(manual.inventory || {});
  renderDerivedCards('inventoryDerived', [
    { label: '戶數去化率', value: `${inv.unitRate}%` },
    { label: '車位去化率', value: `${inv.parkingRate}%` },
    { label: '表價去化率', value: `${inv.amountRate}%` },
    { label: '底價去化率', value: `${inv.basePriceRate}%` },
    { label: '未售底價(萬)', value: `${inv.remainBasePrice}` },
    { label: '剩餘戶／車', value: `${inv.remainUnits} / ${inv.remainParking}` },
  ]);
  const com = calcCommissionDerived(manual.commission || {});
  renderDerivedCards('commissionDerived', [
    { label: '未請佣金額(萬)', value: `${com.unclaimedAmount}` },
    { label: '未請佣戶數', value: `${com.unclaimedUnits}` },
    { label: '未請佣車位', value: `${com.unclaimedParking}` },
    { label: '已入帳(萬)', value: `${com.bookedAmount}` },
    { label: '下月可請(戶/車/萬)', value: `${com.nextMonthUnits} / ${com.nextMonthParking} / ${com.nextMonthAmount}` },
  ]);
}

function renderConversion(auto) {
  const tbody = document.querySelector('#conversionTable tbody');
  const rows = auto.conversion || [];
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty-row">尚無銷售資料</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map((r) => {
    const bold = r.name === '合計' || r.name === '前期銷售';
    const name = bold ? `<strong>${escapeHtml(r.name)}</strong>` : escapeHtml(r.name);
    return `<tr>
      <td>${name}</td>
      <td>${r.visits}</td>
      <td>${r.deals}</td>
      <td><strong>${r.rate}%</strong></td>
      <td>${r.amount ?? 0}</td>
      <td>${r.refunds ?? 0}</td>
      <td>${r.refundAmount ?? 0}</td>
      <td>${r.weekVisits}</td>
      <td>${r.weekDeals}</td>
      <td>${r.weekAmount ?? 0}</td>
    </tr>`;
  }).join('');
}

function renderDimTable(tableId, rows) {
  const table = document.getElementById(tableId);
  if (!table) return;
  const thead = table.querySelector('thead');
  if (thead && !thead.innerHTML.trim()) thead.innerHTML = DIM_HEADERS;
  if (tableId === 'regionDimTable' && thead) thead.innerHTML = DIM_HEADERS;
  const tbody = table.querySelector('tbody');
  if (!rows || !rows.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-row">尚無資料</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map((r) => `<tr>
    <td>${escapeHtml(r.name)}</td>
    <td>${r.priorVisits ?? 0}</td>
    <td>${r.weekVisits ?? r.count ?? 0}</td>
    <td><strong>${r.cumVisits ?? 0}</strong></td>
    <td>${r.weekVisitPct ?? 0}%</td>
    <td>${r.cumVisitPct ?? 0}%</td>
    <td>${r.weekDeals ?? 0}</td>
    <td>${r.weekDealPct ?? 0}%</td>
  </tr>`).join('');
}

function renderVisitorMini(elId, rows, emptyText) {
  const el = document.getElementById(elId);
  if (!rows || !rows.length) {
    el.innerHTML = `<p class="hint">${escapeHtml(emptyText)}</p>`;
    return;
  }
  el.innerHTML = rows.slice(0, 40).map((v) => `
    <div class="mini-stat-item">
      <span>${escapeHtml(v.date)}　${escapeHtml(v.customerName || '未填')}　${escapeHtml(v.salesperson1 || '')}${v.sincerity ? `　${escapeHtml(v.sincerity)}` : ''}</span>
      <strong>${escapeHtml(v.visitType || '')}</strong>
    </div>
  `).join('');
}

function renderVisitorSelect(auto, manual) {
  const tbody = document.querySelector('#visitorSelectTable tbody');
  const all = auto.visitorsAllWeek || auto.visitors || [];
  const saved = manual.includedVisitorIds;
  const selected = saved == null
    ? new Set(all.map((v) => v.id))
    : new Set(saved.map(Number));

  if (!all.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty-row">本週尚無客資紀錄</td></tr>';
    document.getElementById('visitorSelectSummary').textContent = '';
    return;
  }
  tbody.innerHTML = all.map((v) => {
    const checked = selected.has(v.id) ? 'checked' : '';
    return `<tr>
      <td><input type="checkbox" data-id="${v.id}" ${checked}></td>
      <td class="cell-date">${escapeHtml(v.date)}</td>
      <td>${escapeHtml(v.visitType)}</td>
      <td>${escapeHtml(v.customerName)}</td>
      <td>${escapeHtml(v.phone)}</td>
      <td>${escapeHtml(v.region)}</td>
      <td>${escapeHtml(v.media)}</td>
      <td>${escapeHtml(v.occupation || '')}</td>
      <td>${escapeHtml(v.age || '')}</td>
      <td>${escapeHtml(v.salesperson1)}${v.isCoManaged ? '＋' + escapeHtml(v.salesperson2 || '') : ''}</td>
    </tr>`;
  }).join('');
  updateVisitorSelectSummary();
  tbody.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener('change', updateVisitorSelectSummary);
  });
}

function updateVisitorSelectSummary() {
  const boxes = document.querySelectorAll('#visitorSelectTable tbody input[type="checkbox"][data-id]');
  const total = boxes.length;
  const selected = Array.from(boxes).filter((cb) => cb.checked).length;
  document.getElementById('visitorSelectSummary').textContent =
    total ? `已選 ${selected} / 實際 ${total} 組` : '';
}

function renderVisitors(auto) {
  const tbody = document.querySelector('#visitorTable tbody');
  const rows = auto.visitors || [];
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="11" class="empty-row">本週尚無納入週報的客資</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map((v) => `<tr>
    <td class="cell-date">${escapeHtml(v.date)}</td>
    <td>${escapeHtml(v.visitType)}</td>
    <td>${escapeHtml(v.customerName)}</td>
    <td>${escapeHtml(v.phone)}</td>
    <td>${escapeHtml(v.region)}</td>
    <td>${escapeHtml(v.media)}</td>
    <td>${escapeHtml(v.occupation || '')}</td>
    <td>${escapeHtml(v.age || '')}</td>
    <td>${escapeHtml(v.sincerity)}</td>
    <td>${escapeHtml(v.salesperson1)}</td>
    <td class="cell-wrap">${escapeHtml(v.discussion)}</td>
  </tr>`).join('');
}

function renderHistory(history) {
  const el = document.getElementById('weekHistory');
  if (!history || !history.length) {
    el.innerHTML = '<p class="hint">尚無已儲存週報</p>';
    return;
  }
  el.innerHTML = history.map((h) => `
    <button type="button" class="mini-stat-item history-btn" data-start="${escapeHtml(h.weekStart)}">
      <span>第 ${h.weekNumber || '?'} 週　${escapeHtml(h.weekStart)} ~ ${escapeHtml(h.weekEnd)}</span>
      <strong>${escapeHtml(h.updatedAt || '')}</strong>
    </button>
  `).join('');
  el.querySelectorAll('.history-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.getElementById('weekStart').value = btn.dataset.start;
      updateRangeLabel();
      loadWeek();
    });
  });
}

function renderAll(payload) {
  current = payload;
  document.getElementById('weekEmpty').classList.add('hidden');
  document.getElementById('weekWorkspace').classList.remove('hidden');
  document.getElementById('weekNumber').value = payload.weekNumber || '';
  document.getElementById('weekSaveBadge').textContent = payload.saved
    ? `已儲存 ${payload.updatedAt || ''}`
    : '尚未儲存';
  document.getElementById('weekSaveBadge').className = payload.saved ? 'badge' : 'badge badge-muted';

  const manual = payload.manual || {};
  const auto = payload.auto || {};
  const derived = payload.derived || {};
  renderKpi(auto, manual);
  renderVisitorSelect(auto, manual);
  renderDaily(auto, manual);
  renderDimTable('regionDimTable', auto.byRegion);
  renderDimTable('mediaDimTable', auto.byMedia);
  renderDimTable('sourceDimTable', auto.bySource);
  renderDimTable('occupationDimTable', auto.byOccupation);
  renderDimTable('ageDimTable', auto.byAge);
  renderDealInputs(manual);
  renderInventory(manual, derived.inventory);
  renderCommission(manual, derived.commission);
  document.getElementById('reviewNotes').value = manual.reviewNotes || '';
  document.getElementById('competitorNotes').value = manual.competitorNotes || '';
  document.getElementById('weekMemo').value = manual.memo || '';
  renderConversion(auto);
  renderVisitorMini('returnList', auto.returnVisits, '本週尚無回訪');
  renderVisitorMini('hopeList', auto.hopeCustomers, '本週尚無有望客');
  renderVisitors(auto);
  renderHistory(payload.history || []);
}

async function loadWeek() {
  const siteId = document.getElementById('weekSite').value;
  const weekStart = document.getElementById('weekStart').value;
  if (!siteId || !weekStart) {
    showToast('請選擇案場與週起始日', 'error');
    return;
  }
  updateRangeLabel();
  try {
    const params = new URLSearchParams({ siteId, weekStart: document.getElementById('weekStart').value });
    const res = await fetch(`/api/weekly/summary?${params}`);
    const json = await res.json();
    if (!res.ok) {
      showToast(json.error || '載入失敗', 'error');
      return;
    }
    if (!document.getElementById('weekNumber').value) {
      document.getElementById('weekNumber').value = json.weekNumber || '';
    }
    renderAll(json);
    showToast('已載入本週資料');
  } catch {
    showToast('載入失敗', 'error');
  }
}

async function saveWeek() {
  if (!current) {
    showToast('請先載入本週資料', 'error');
    return;
  }
  const manual = collectManualFromForm(current.manual);
  try {
    const res = await fetch('/api/weekly/reports', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        siteId: current.siteId,
        weekStart: current.weekStart,
        manual,
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      showToast(json.error || '儲存失敗', 'error');
      return;
    }
    showToast('週報已儲存');
    await loadWeek();
  } catch {
    showToast('儲存失敗', 'error');
  }
}

async function applyVisitorSelection() {
  if (!current) return;
  await saveWeek();
}

function exportWeek(format) {
  if (!current) {
    showToast('請先載入本週資料', 'error');
    return;
  }
  const params = new URLSearchParams({
    siteId: current.siteId,
    weekStart: current.weekStart,
  });
  const path = format === 'csv' ? '/api/weekly/export.csv' : '/api/weekly/export.xlsx';
  window.location.href = `${path}?${params}`;
}

function shiftWeek(delta) {
  const el = document.getElementById('weekStart');
  if (!el.value) return;
  const start = mondayOf(parseYmd(el.value));
  el.value = toYmd(addDays(start, delta * 7));
  updateRangeLabel();
  if (document.getElementById('weekSite').value) loadWeek();
}

async function init() {
  for (let i = 0; i < 50 && !window.navReady; i += 1) {
    await new Promise((r) => setTimeout(r, 20));
  }
  if (window.navReady) await window.navReady;

  if (!window.currentUser) {
    window.location.replace('/login.html?next=/weekly.html');
    return;
  }
  if (!(window.currentUser.permissions || []).includes('manage_weekly_reports')) {
    showToast('沒有週報權限', 'error');
    setTimeout(() => { window.location.replace('/'); }, 1200);
    return;
  }

  await loadSites();
  await loadMeta();

  document.getElementById('weekStart').addEventListener('change', updateRangeLabel);
  document.getElementById('loadWeekBtn').addEventListener('click', loadWeek);
  document.getElementById('prevWeekBtn').addEventListener('click', () => shiftWeek(-1));
  document.getElementById('nextWeekBtn').addEventListener('click', () => shiftWeek(1));
  document.getElementById('saveWeekBtn').addEventListener('click', saveWeek);
  document.getElementById('selectAllVisitorsBtn').addEventListener('click', () => {
    document.querySelectorAll('#visitorSelectTable tbody input[type="checkbox"]').forEach((cb) => { cb.checked = true; });
    updateVisitorSelectSummary();
  });
  document.getElementById('clearVisitorsBtn').addEventListener('click', () => {
    document.querySelectorAll('#visitorSelectTable tbody input[type="checkbox"]').forEach((cb) => { cb.checked = false; });
    updateVisitorSelectSummary();
  });
  document.getElementById('applyVisitorsBtn').addEventListener('click', applyVisitorSelection);
  document.getElementById('exportWeekBtn').addEventListener('click', async () => {
    if (!current) {
      showToast('請先載入本週資料', 'error');
      return;
    }
    await saveWeek();
    exportWeek('xlsx');
  });
  document.getElementById('exportCsvBtn').addEventListener('click', async () => {
    if (!current) {
      showToast('請先載入本週資料', 'error');
      return;
    }
    await saveWeek();
    exportWeek('csv');
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { init(); });
} else {
  init();
}
