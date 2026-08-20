let sites = [];
let current = null;
let regionOptions = [];
let mediaOptions = [];
let draftSaveTimer = null;

const WEEKLY_CTX_KEY = 'weekly_report_ctx';
const WEEKLY_DRAFT_KEY = 'weekly_report_draft';

const DIM_HEADERS = `
  <tr>
    <th>項目</th><th>前期累計</th><th>本週來人</th><th>目前累計</th>
    <th>佔本週來人%</th><th>佔累計來人%</th>
    <th>本週來電</th><th>佔本週來電%</th>
    <th>本週成交</th><th>佔本週成交%</th>
  </tr>`;

const DIM_HEADERS_BASIC = `
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

function weekNumberFromOrigin(weekStart, origin) {
  if (!weekStart || !origin) return null;
  const start = mondayOf(parseYmd(weekStart));
  const first = mondayOf(parseYmd(origin));
  return Math.round((start - first) / (7 * 24 * 60 * 60 * 1000)) + 1;
}

function currentSite() {
  const id = document.getElementById('weekSite')?.value;
  return sites.find((s) => s.id === id) || null;
}

function syncWeek1StartField() {
  const el = document.getElementById('week1Start');
  if (!el) return;
  el.value = currentSite()?.week1Start || '';
}

function applySuggestedWeekNumber() {
  const origin = document.getElementById('week1Start')?.value || currentSite()?.week1Start;
  const n = weekNumberFromOrigin(
    document.getElementById('weekStart')?.value,
    origin,
  );
  if (n == null || !Number.isFinite(n)) return;
  document.getElementById('weekNumber').value = n;
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

function saveWeeklyContext() {
  try {
    sessionStorage.setItem(WEEKLY_CTX_KEY, JSON.stringify({
      siteId: document.getElementById('weekSite')?.value || '',
      weekStart: document.getElementById('weekStart')?.value || '',
      weekNumber: document.getElementById('weekNumber')?.value || '',
    }));
  } catch { /* ignore */ }
}

function restoreWeeklyContext() {
  try {
    const raw = sessionStorage.getItem(WEEKLY_CTX_KEY);
    if (!raw) return false;
    const ctx = JSON.parse(raw);
    if (ctx.siteId) document.getElementById('weekSite').value = ctx.siteId;
    if (ctx.weekStart) document.getElementById('weekStart').value = ctx.weekStart;
    if (ctx.weekNumber) document.getElementById('weekNumber').value = ctx.weekNumber;
    updateRangeLabel();
    return Boolean(ctx.siteId && ctx.weekStart);
  } catch {
    return false;
  }
}

function saveWeeklyDraft() {
  if (!current) return;
  const siteId = current.siteId || document.getElementById('weekSite')?.value;
  const weekStart = current.weekStart || document.getElementById('weekStart')?.value;
  if (!siteId || !weekStart) return;
  const manual = collectManualFromForm(current.manual);
  current.manual = manual;
  try {
    sessionStorage.setItem(WEEKLY_DRAFT_KEY, JSON.stringify({
      siteId,
      weekStart,
      serverUpdatedAt: current.updatedAt || null,
      savedAt: new Date().toISOString(),
      manual,
    }));
    saveWeeklyContext();
  } catch { /* ignore quota */ }
}

function scheduleWeeklyDraftSave() {
  if (draftSaveTimer) clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(saveWeeklyDraft, 300);
}

function loadWeeklyDraft(siteId, weekStart) {
  try {
    const raw = sessionStorage.getItem(WEEKLY_DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw);
    if (draft.siteId !== siteId || draft.weekStart !== weekStart) return null;
    return draft;
  } catch {
    return null;
  }
}

function clearWeeklyDraft() {
  try {
    sessionStorage.removeItem(WEEKLY_DRAFT_KEY);
  } catch { /* ignore */ }
}

function mergeWeeklyDraft(payload) {
  const draft = loadWeeklyDraft(payload.siteId, payload.weekStart);
  if (!draft?.manual) return { payload, restored: false };
  return {
    payload: {
      ...payload,
      manual: { ...(payload.manual || {}), ...draft.manual },
    },
    restored: true,
  };
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
  syncWeek1StartField();
}

async function loadMeta() {
  try {
    const siteId = document.getElementById('weekSite')?.value || '';
    const qs = siteId ? `?siteId=${encodeURIComponent(siteId)}` : '';
    const res = await fetch(`/api/weekly/meta${qs}`);
    if (!res.ok) return;
    const json = await res.json();
    const startEl = document.getElementById('weekStart');
    if (!startEl.value) startEl.value = json.defaultWeekStart;
    document.getElementById('weekNumber').value = json.defaultWeekNumber;
    if (json.week1Start) document.getElementById('week1Start').value = json.week1Start;
    updateRangeLabel();
    applySuggestedWeekNumber();
  } catch { /* ignore */ }
}

async function loadFieldOptions(siteId) {
  if (!siteId) return;
  try {
    const res = await fetch(`/api/fields?siteId=${encodeURIComponent(siteId)}`);
    if (!res.ok) return;
    const json = await res.json();
    const options = {};
    (json.sections || []).forEach((sec) => {
      (sec.fields || []).forEach((field) => {
        if (field.key && Array.isArray(field.options)) options[field.key] = field.options;
      });
    });
    regionOptions = options.region || regionOptions;
    mediaOptions = options.media1 || options.media || mediaOptions;
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

  const phoneRows = [];
  document.querySelectorAll('#phoneDetailTable tbody tr[data-phone-row]').forEach((tr) => {
    const date = tr.querySelector('[data-field="date"]')?.value || '';
    const region = tr.querySelector('[data-field="region"]')?.value || '';
    const media = tr.querySelector('[data-field="media"]')?.value || '';
    const countRaw = tr.querySelector('[data-field="count"]')?.value;
    const count = countRaw === '' || countRaw == null ? 0 : Number(countRaw) || 0;
    if (!date && !region && !media && !count) return;
    phoneRows.push({ date, region, media, count: count || 1 });
  });
  manual.phoneCallsDetail = phoneRows;
  if (phoneRows.length) {
    const byDay = {};
    phoneRows.forEach((item) => {
      byDay[item.date] = (byDay[item.date] || 0) + Number(item.count || 0);
    });
    (manual.days || []).forEach((day) => {
      day.phoneCalls = byDay[day.date] || 0;
    });
  }

  ['deals', 'dealsCum', 'signings', 'signingsCum', 'unsignedCum', 'purchases', 'purchasesCum', 'unreported'].forEach((key) => {
    manual[key] = manual[key] || { units: 0, parking: 0, amount: 0 };
    ['units', 'parking', 'amount'].forEach((f) => {
      const el = document.querySelector(`[data-block="${key}"][data-field="${f}"]`);
      if (el) manual[key][f] = Number(el.value) || 0;
    });
  });
  const dealsCum = manual.dealsCum || {};
  const signingsCum = manual.signingsCum || {};
  manual.unsignedCum = {
    units: Math.max((Number(dealsCum.units) || 0) - (Number(signingsCum.units) || 0), 0),
    parking: Math.max((Number(dealsCum.parking) || 0) - (Number(signingsCum.parking) || 0), 0),
    amount: Math.max((Number(dealsCum.amount) || 0) - (Number(signingsCum.amount) || 0), 0),
  };

  const conversionManual = {};
  document.querySelectorAll('[data-conv][data-cf]').forEach((el) => {
    const name = el.getAttribute('data-conv');
    const field = el.getAttribute('data-cf');
    if (!name || !field || name === '合計') return;
    conversionManual[name] = conversionManual[name] || {};
    conversionManual[name][field] = Number(el.value) || 0;
  });
  if (Object.keys(conversionManual).length) manual.conversionManual = conversionManual;

  manual.inventory = manual.inventory || {};
  [
    'totalUnits', 'soldUnits', 'totalParking', 'soldParking',
    'totalAmount', 'soldAmount', 'soldBasePrice',
    'residentialTotal', 'residentialSold', 'officeTotal', 'officeSold',
    'shopTotal', 'shopSold', 'storefrontTotal', 'storefrontSold',
  ].forEach((f) => {
    const el = document.querySelector(`[data-block="inventory"][data-field="${f}"]`);
    if (el) manual.inventory[f] = Number(el.value) || 0;
  });

  manual.commission = manual.commission || {};
  [
    'sellableUnits', 'sellableParking', 'sellableAmount',
    'claimableUnits', 'claimableParking', 'claimableSalesAmount',
    'claimableAmount', 'claimableRetentionAmount', 'claimablePayableAmount',
    'claimedUnits', 'claimedParking',
    'claimedAmount', 'claimedRetentionAmount', 'claimedPayableAmount',
    'nextMonthUnits', 'nextMonthParking', 'nextMonthAmount',
    'bookedAmount',
  ].forEach((f) => {
    const el = document.querySelector(`[data-block="commission"][data-field="${f}"]`);
    if (el) manual.commission[f] = Number(el.value) || 0;
  });

  manual.includedVisitorIds = null;

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
    shopRate: rate(n('shopSold'), n('shopTotal')),
    storefrontRate: rate(n('storefrontSold'), n('storefrontTotal')),
    remainUnits: Math.max(n('totalUnits') - n('soldUnits'), 0),
    remainParking: Math.max(n('totalParking') - n('soldParking'), 0),
    remainAmount: Math.max(n('totalAmount') - n('soldAmount'), 0),
    remainBasePrice: Math.max(n('totalAmount') - n('soldBasePrice'), 0),
  };
}

function roundCommission4(x) {
  return Math.round((Number(x) || 0) * 10000) / 10000;
}

function retentionRatioDefault() {
  const r = Number(current?.commissionDefaults?.retentionRatio);
  return Number.isFinite(r) ? r : 0.03;
}

/** 3% = 100%×比率（四捨五入至小數4位），97% = 100%−3% */
function splitFromTotal100(total100, retentionRatio) {
  const total = Number(total100) || 0;
  const ratio = Number.isFinite(Number(retentionRatio)) ? Number(retentionRatio) : retentionRatioDefault();
  const retention = roundCommission4(total * ratio);
  const payable = roundCommission4(total - retention);
  return { claimable: roundCommission4(total), retention, payable };
}

function hasOwnCommissionVal(c, key) {
  return c && Object.prototype.hasOwnProperty.call(c, key) && c[key] !== '' && c[key] != null;
}

/** 補齊／沿用 3%、97%；舊資料若只有 100% 則用公式帶入 */
function normalizeCommissionSplits(raw) {
  const c = { ...(raw || {}) };
  const ratio = retentionRatioDefault();
  const fillPair = (totalKey, retKey, payKey, legacyRetKey, legacyPayKey) => {
    const total = Number(c[totalKey]) || 0;
    const auto = splitFromTotal100(total, ratio);
    let ret = hasOwnCommissionVal(c, retKey) ? Number(c[retKey]) || 0
      : (legacyRetKey && hasOwnCommissionVal(c, legacyRetKey) ? Number(c[legacyRetKey]) || 0 : null);
    let pay = hasOwnCommissionVal(c, payKey) ? Number(c[payKey]) || 0
      : (legacyPayKey && hasOwnCommissionVal(c, legacyPayKey) ? Number(c[legacyPayKey]) || 0 : null);
    // 100% 有值但 3%/97% 皆為 0（空白預設）→ 用公式帶入
    if (total > 0 && (ret == null || pay == null || (ret === 0 && pay === 0))) {
      ret = auto.retention;
      pay = auto.payable;
    } else {
      if (ret == null) ret = auto.retention;
      if (pay == null) pay = auto.payable;
    }
    c[retKey] = roundCommission4(ret);
    c[payKey] = roundCommission4(pay);
  };
  fillPair(
    'claimableAmount', 'claimableRetentionAmount', 'claimablePayableAmount',
    'retentionAmount', 'payableAmount',
  );
  fillPair(
    'claimedAmount', 'claimedRetentionAmount', 'claimedPayableAmount',
    null, null,
  );
  return c;
}

function commissionSplitOk(total100, retention, payable) {
  const sum = roundCommission4((Number(retention) || 0) + (Number(payable) || 0));
  const total = roundCommission4(total100);
  return Math.abs(sum - total) <= 0.00015;
}

function calcCommissionDerived(c) {
  const n = (k) => Number(c[k]) || 0;
  const claimed = n('claimedAmount');
  const booked = n('bookedAmount');
  const claimablePay = n('claimablePayableAmount') || n('payableAmount');
  const claimableRet = n('claimableRetentionAmount') || n('retentionAmount');
  return {
    unclaimedAmount: roundCommission4(Math.max(n('claimableAmount') - claimed, 0)),
    unclaimedPayable: roundCommission4(Math.max(claimablePay - n('claimedPayableAmount'), 0)),
    unclaimedRetention: roundCommission4(Math.max(claimableRet - n('claimedRetentionAmount'), 0)),
    unclaimedUnits: Math.max(n('claimableUnits') - n('claimedUnits'), 0),
    unclaimedParking: Math.max(n('claimableParking') - n('claimedParking'), 0),
    payableAmount: roundCommission4(claimablePay),
    retentionAmount: roundCommission4(claimableRet),
    bookedAmount: roundCommission4(booked),
    unbookedAmount: roundCommission4(Math.max((n('claimedPayableAmount') || claimed) - booked, 0)),
    nextMonthUnits: n('nextMonthUnits'),
    nextMonthParking: n('nextMonthParking'),
    nextMonthAmount: roundCommission4(n('nextMonthAmount')),
    claimableSplitOk: commissionSplitOk(n('claimableAmount'), n('claimableRetentionAmount'), n('claimablePayableAmount')),
    claimedSplitOk: commissionSplitOk(n('claimedAmount'), n('claimedRetentionAmount'), n('claimedPayableAmount')),
  };
}

function matrixFromManualCommission(manual) {
  const c = normalizeCommissionSplits((manual || {}).commission || {});
  const n = (k) => Number(c[k]) || 0;
  const defaults = current?.commissionDefaults || {};
  const labels = defaults.labels || {
    claimable: '100%佣金', retention: '3%保留', payable: '97%可請',
  };
  const claimableAmt = {
    claimable: n('claimableAmount'),
    retention: n('claimableRetentionAmount'),
    payable: n('claimablePayableAmount'),
  };
  const claimedAmt = {
    claimable: n('claimedAmount'),
    retention: n('claimedRetentionAmount'),
    payable: n('claimedPayableAmount'),
  };
  const forecastAmt = splitFromTotal100(n('nextMonthAmount'), retentionRatioDefault());
  const unclaimedAmt = {
    claimable: roundCommission4(claimableAmt.claimable - claimedAmt.claimable),
    payable: roundCommission4(claimableAmt.payable - claimedAmt.payable),
    retention: roundCommission4(claimableAmt.retention - claimedAmt.retention),
  };
  return {
    labels,
    claimable: {
      units: n('claimableUnits'), parking: n('claimableParking'), ...claimableAmt,
    },
    claimed: {
      units: n('claimedUnits'), parking: n('claimedParking'), ...claimedAmt,
    },
    unclaimed: {
      units: Math.max(n('claimableUnits') - n('claimedUnits'), 0),
      parking: Math.max(n('claimableParking') - n('claimedParking'), 0),
      ...unclaimedAmt,
    },
    forecast: {
      units: n('nextMonthUnits'), parking: n('nextMonthParking'), ...forecastAmt,
    },
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
  const phoneDetailSum = (manual.phoneCallsDetail || []).reduce((s, d) => s + (Number(d.count) || 0), 0);
  const phoneDisplay = phoneDetailSum || phoneSum;
  const deals = manual.deals || {};
  const mw = p.month || {};
  const yw = p.year || {};
  const items = [
    { label: '實際來人', value: `${t.actualTotal ?? t.total ?? 0} 組` },
    { label: '納入週報', value: `${t.reportedTotal ?? t.total ?? 0} 組` },
    { label: '新客／回訪', value: `${t.new || 0} / ${t.return || 0}` },
    { label: '本週來電', value: `${phoneDisplay} 通` },
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

function phoneCountByDay(manual, fallback = {}) {
  const detail = manual?.phoneCallsDetail || [];
  if (!detail.length) return { ...fallback };
  const by = {};
  detail.forEach((item) => {
    if (!item.date) return;
    by[item.date] = (by[item.date] || 0) + (Number(item.count) || 0);
  });
  return by;
}

const WEATHER_OPTIONS = ['晴', '陰', '雨', '多雲', '雷雨'];

function renderDaily(auto, manual) {
  const byDay = auto.byDay || [];
  const days = manual.days || [];
  const phoneByDay = phoneCountByDay(manual, auto.phoneByDay || {});
  const tbody = document.querySelector('#dailyTable tbody');
  const totals = { new: 0, return: 0, total: 0, deal: 0, phones: 0 };
  tbody.innerHTML = byDay.map((d, i) => {
    const m = days[i] || {};
    const phones = phoneByDay[d.date] != null
      ? phoneByDay[d.date]
      : (Number(m.phoneCalls) || 0);
    totals.new += Number(d.new) || 0;
    totals.return += Number(d.return) || 0;
    totals.total += Number(d.total) || 0;
    totals.deal += Number(d.deal) || 0;
    totals.phones += Number(phones) || 0;
    return `<tr>
      <td class="cell-date">${escapeHtml(d.date)}</td>
      <td>${escapeHtml(d.weekday)}</td>
      <td>${d.new}</td>
      <td>${d.return}</td>
      <td><strong>${d.total}</strong></td>
      <td>${d.deal}</td>
      <td><strong>${phones}</strong></td>
      <td><select class="table-input" data-field="weather">${optionHtml(WEATHER_OPTIONS, m.weather || '')}</select></td>
    </tr>`;
  }).join('');
  const tfoot = document.querySelector('#dailyTable tfoot');
  if (tfoot) {
    tfoot.innerHTML = `<tr>
      <td colspan="2"><strong>本週合計（自動加總）</strong></td>
      <td><strong>${totals.new}</strong></td>
      <td><strong>${totals.return}</strong></td>
      <td><strong>${totals.total}</strong></td>
      <td><strong>${totals.deal}</strong></td>
      <td><strong>${totals.phones}</strong></td>
      <td></td>
    </tr>`;
  }
}

function optionHtml(options, selected) {
  const list = [...options];
  if (selected && !list.includes(selected)) list.unshift(selected);
  return ['<option value="">未填</option>']
    .concat(list.map((opt) => `<option value="${escapeHtml(opt)}"${opt === selected ? ' selected' : ''}>${escapeHtml(opt)}</option>`))
    .join('');
}

function renderPhoneDetail(manual) {
  const tbody = document.querySelector('#phoneDetailTable tbody');
  if (!tbody) return;
  const rows = manual.phoneCallsDetail || [];
  const weekDates = (manual.days || []).map((d) => d.date);
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-row">尚無來電明細，請按「新增來電」</td></tr>';
  } else {
    tbody.innerHTML = rows.map((item, idx) => `
      <tr data-phone-row="${idx}">
        <td>
          <select data-field="date">
            ${weekDates.map((d) => `<option value="${d}"${d === item.date ? ' selected' : ''}>${d}</option>`).join('')}
          </select>
        </td>
        <td><select data-field="region">${optionHtml(regionOptions, item.region)}</select></td>
        <td><select data-field="media">${optionHtml(mediaOptions, item.media)}</select></td>
        <td><input type="number" min="1" step="1" data-field="count" value="${Number(item.count) || 1}"></td>
        <td><button type="button" class="btn-xs link-btn" data-del-phone="${idx}">刪除</button></td>
      </tr>
    `).join('');
  }
  const total = rows.reduce((s, r) => s + (Number(r.count) || 0), 0);
  const summary = document.getElementById('phoneDetailSummary');
  if (summary) summary.textContent = total ? `本週來電明細合計 ${total} 通` : '';
  tbody.querySelectorAll('[data-del-phone]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!current) return;
      const manualData = collectManualFromForm(current.manual);
      manualData.phoneCallsDetail.splice(Number(btn.dataset.delPhone), 1);
      current.manual = manualData;
      renderPhoneDetail(manualData);
      renderDaily(current.auto || {}, manualData);
      renderKpi(current.auto || {}, manualData);
      scheduleWeeklyDraftSave();
    });
  });
  tbody.querySelectorAll('select, input').forEach((el) => {
    const sync = () => {
      if (!current) return;
      const manualData = collectManualFromForm(current.manual);
      current.manual = manualData;
      renderDaily(current.auto || {}, manualData);
      renderKpi(current.auto || {}, manualData);
      const total = (manualData.phoneCallsDetail || []).reduce((s, r) => s + (Number(r.count) || 0), 0);
      const summary = document.getElementById('phoneDetailSummary');
      if (summary) summary.textContent = total ? `本週來電明細合計 ${total} 通` : '';
      scheduleWeeklyDraftSave();
    };
    el.addEventListener('change', sync);
    el.addEventListener('input', sync);
  });
}

function addPhoneCallRow() {
  if (!current) {
    showToast('請先載入本週資料', 'error');
    return;
  }
  const manual = collectManualFromForm(current.manual);
  manual.phoneCallsDetail = manual.phoneCallsDetail || [];
  manual.phoneCallsDetail.push({
    date: (manual.days || [])[0]?.date || current.weekStart,
    region: '',
    media: '',
    count: 1,
  });
  current.manual = manual;
  renderPhoneDetail(manual);
  scheduleWeeklyDraftSave();
}

function renderDealInputs(manual) {
  const blocks = [
    { key: 'deals', title: '本週成交', amountHint: '實際房價＋車售' },
    { key: 'dealsCum', title: '累計成交', amountHint: '實際房價＋車售', cum: true },
    { key: 'signings', title: '本週簽約', amountHint: '實際房價＋車售' },
    { key: 'signingsCum', title: '累計簽約', amountHint: '實際房價＋車售', cum: true },
    { key: 'unsignedCum', title: '累計未簽約', amountHint: '累計成交 − 累計簽約', cum: true, computed: true },
    { key: 'purchases', title: '本週買進', amountHint: '實際房價＋車售' },
    { key: 'purchasesCum', title: '累計買進', amountHint: '實際房價＋車售', cum: true },
    { key: 'unreported', title: '未報', amountHint: '合約總價' },
  ];
  document.getElementById('dealInputs').innerHTML = blocks.map((b) => {
    const v = manual[b.key] || {};
    const ro = b.computed ? 'readonly' : '';
    return `
      <div class="deal-input-row${b.cum ? ' is-cum' : ''}">
        <div class="deal-input-label">${escapeHtml(b.title)}</div>
        <div class="form-group"><label>戶</label>
          <input type="number" min="0" ${ro} data-block="${b.key}" data-field="units" value="${Number(v.units) || 0}"></div>
        <div class="form-group"><label>車</label>
          <input type="number" min="0" ${ro} data-block="${b.key}" data-field="parking" value="${Number(v.parking) || 0}"></div>
        <div class="form-group"><label>金額(萬) <span class="field-hint-inline">${escapeHtml(b.amountHint)}</span></label>
          <input type="number" min="0" step="0.01" ${ro} data-block="${b.key}" data-field="amount" value="${Number(v.amount) || 0}"></div>
      </div>
    `;
  }).join('');
  document.querySelectorAll('#dealInputs input').forEach((el) => {
    el.addEventListener('input', syncUnsignedCum);
  });
  syncUnsignedCum();
}

function syncUnsignedCum() {
  const val = (block, field) => Number(document.querySelector(`[data-block="${block}"][data-field="${field}"]`)?.value) || 0;
  ['units', 'parking', 'amount'].forEach((field) => {
    const el = document.querySelector(`[data-block="unsignedCum"][data-field="${field}"]`);
    if (el) el.value = Math.max(val('dealsCum', field) - val('signingsCum', field), 0);
  });
}

function renderInventory(manual, derived) {
  const inv = manual.inventory || {};
  const fields = [
    { key: 'totalUnits', label: '總戶數' },
    { key: 'soldUnits', label: '已售戶數' },
    { key: 'totalParking', label: '總車位' },
    { key: 'soldParking', label: '已售車位' },
    { key: 'totalAmount', label: '總底價金額(萬)' },
        { key: 'soldAmount', label: '已售成交價(萬)（實際房價＋車售）' },
    { key: 'soldBasePrice', label: '已售底價(萬)' },
    { key: 'residentialTotal', label: '住宅總戶' },
    { key: 'residentialSold', label: '住宅已售' },
    { key: 'officeTotal', label: '事務所總戶' },
    { key: 'officeSold', label: '事務所已售' },
    { key: 'shopTotal', label: '店鋪總戶' },
    { key: 'shopSold', label: '店鋪已售' },
    { key: 'storefrontTotal', label: '店面總戶' },
    { key: 'storefrontSold', label: '店面已售' },
  ];
  document.getElementById('inventoryInputs').innerHTML = fields.map((f) => `
    <div class="form-group">
      <label>${f.label}</label>
      <input type="number" min="0" step="0.01" data-block="inventory" data-field="${f.key}" value="${Number(inv[f.key]) || 0}">
    </div>
  `).join('');
  const d = calcInventoryDerived(inv);
  renderDerivedCards('inventoryDerived', [
    { label: '戶數去化率', value: `${d.unitRate}%` },
    { label: '車位去化率', value: `${d.parkingRate}%` },
    { label: '成交價去化率', value: `${d.amountRate}%` },
    { label: '底價去化率', value: `${d.basePriceRate}%` },
    { label: '未售底價(萬)', value: `${d.remainBasePrice}` },
    { label: '剩餘戶／車', value: `${d.remainUnits} / ${d.remainParking}` },
    { label: '住宅去化率', value: `${d.residentialRate}%` },
    { label: '事務所去化率', value: `${d.officeRate}%` },
    { label: '店鋪去化率', value: `${d.shopRate}%` },
    { label: '店面去化率', value: `${d.storefrontRate}%` },
  ]);
  document.querySelectorAll('[data-block="inventory"]').forEach((el) => {
    el.addEventListener('input', refreshDerivedFromForm);
  });
}

function fmtWeekNum(val) {
  const n = Number(val || 0);
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 10000) / 10000);
}

function renderWeeklyCommissionMatrix(matrix) {
  const el = document.getElementById('weeklyCommissionMatrix');
  if (!el) return;
  const data = matrix || matrixFromManualCommission(current?.manual);
  const cards = [
    { key: 'claimable', title: '可請總金額' },
    { key: 'claimed', title: '已請款金額' },
    { key: 'unclaimed', title: '未請款總金額' },
    { key: 'forecast', title: '預計本月可請' },
  ];
  el.innerHTML = cards.map((c) => {
    const b = data[c.key] || {};
    const labels = data.labels || current?.commissionDefaults?.labels || {
      claimable: '100%佣金', retention: '3%保留', payable: '97%可請',
    };
    return `<div class="commission-matrix-card" data-tone="${c.key}">
      <h3>${escapeHtml(c.title)}</h3>
      <div class="upc">${fmtWeekNum(b.units)}戶／${fmtWeekNum(b.parking)}車</div>
      <dl>
        <dt>${escapeHtml(labels.claimable)}</dt><dd>${fmtWeekNum(b.claimable)} 萬</dd>
        <dt>${escapeHtml(labels.retention)}</dt><dd>${fmtWeekNum(b.retention)} 萬</dd>
        <dt>${escapeHtml(labels.payable)}</dt><dd>${fmtWeekNum(b.payable)} 萬</dd>
      </dl>
    </div>`;
  }).join('');
}

function commissionFieldHtml(f, c) {
  const step = f.step || '0.01';
  const val = Number(c[f.key]) || 0;
  const warn = f.warnAttr ? ` data-split-role="${f.warnAttr}"` : '';
  return `<div class="form-group">
      <label>${f.label}</label>
      <input type="number" min="0" step="${step}" data-block="commission" data-field="${f.key}"${warn} value="${val}">
    </div>`;
}

function renderCommissionSplitWarnings(c) {
  const host = document.getElementById('commissionSplitWarn');
  if (!host) return;
  const d = calcCommissionDerived(c);
  const msgs = [];
  if (!d.claimableSplitOk) {
    msgs.push('可請：3%保留款＋97%可請 必須等於 可請佣金額(100%)，請檢查手改數字。');
  }
  if (!d.claimedSplitOk) {
    msgs.push('已請：已請3%保留款＋已請97% 必須等於 已請佣金額(100%)，請檢查手改數字。');
  }
  if (!msgs.length) {
    host.className = 'commission-split-warn hidden';
    host.textContent = '';
    return;
  }
  host.className = 'commission-split-warn';
  host.innerHTML = msgs.map((m) => `<div>${escapeHtml(m)}</div>`).join('');
}

function renderCommission(manual, derived) {
  const c = normalizeCommissionSplits(manual.commission || {});
  const fields = [
    { key: 'sellableUnits', label: '累積銷售戶數' },
    { key: 'sellableParking', label: '累積銷售車位' },
    { key: 'sellableAmount', label: '累積銷售金額(萬)（實際房價＋車售）' },
    { key: 'claimableUnits', label: '可請佣戶數' },
    { key: 'claimableParking', label: '可請佣車位' },
    { key: 'claimableSalesAmount', label: '可請佣銷售金額(萬)', step: '0.0001' },
    { key: 'claimableAmount', label: '可請佣金額(萬)', step: '0.0001', warnAttr: 'claimable-total' },
    { key: 'claimableRetentionAmount', label: '3%保留款(萬)', step: '0.0001', warnAttr: 'claimable-ret' },
    { key: 'claimablePayableAmount', label: '97%可請(萬)', step: '0.0001', warnAttr: 'claimable-pay' },
    { key: 'claimedUnits', label: '已請佣戶數' },
    { key: 'claimedParking', label: '已請佣車位' },
    { key: 'claimedAmount', label: '已請佣金額(萬)', step: '0.0001', warnAttr: 'claimed-total' },
    { key: 'claimedRetentionAmount', label: '已請3%保留款(萬)', step: '0.0001', warnAttr: 'claimed-ret' },
    { key: 'claimedPayableAmount', label: '已請97%(萬)', step: '0.0001', warnAttr: 'claimed-pay' },
    { key: 'nextMonthUnits', label: '預計本月可請戶數' },
    { key: 'nextMonthParking', label: '預計本月可請車位' },
    { key: 'nextMonthAmount', label: '預計本月可請金額(萬)', step: '0.0001' },
    { key: 'bookedAmount', label: '已請佣已入帳金額(萬)', step: '0.0001' },
  ];
  // 已請戶數／車位列只佔兩格，金額移到下一排（用空白占位對齊）
  const htmlParts = [];
  fields.forEach((f) => {
    if (f.key === 'claimedAmount') {
      htmlParts.push('<div class="form-group commission-grid-spacer" aria-hidden="true"></div>');
    }
    htmlParts.push(commissionFieldHtml(f, c));
  });
  const d = calcCommissionDerived(c);
  htmlParts.push(`<div class="form-group">
      <label>已請佣未入帳金額(萬)</label>
      <input type="number" step="0.0001" id="commissionUnbooked" value="${d.unbookedAmount}" readonly>
    </div>`);
  htmlParts.push('<div class="form-group full-width commission-split-warn-wrap"><div id="commissionSplitWarn" class="commission-split-warn hidden"></div></div>');
  document.getElementById('commissionInputs').innerHTML = htmlParts.join('');
  const labels = current?.commissionDefaults?.labels
    || { payable: '97%可請', retention: '3%保留款' };
  renderDerivedCards('commissionDerived', [
    { label: `${labels.payable}(萬)`, value: `${d.payableAmount}` },
    { label: `${labels.retention}(萬)`, value: `${d.retentionAmount}` },
    { label: '未請佣金額100%(萬)', value: `${d.unclaimedAmount}` },
    { label: '未請佣戶數', value: `${d.unclaimedUnits}` },
    { label: '未請佣車位', value: `${d.unclaimedParking}` },
    { label: '已請佣已入帳(萬)', value: `${d.bookedAmount}` },
    { label: '已請佣未入帳(萬)', value: `${d.unbookedAmount}` },
    { label: '本月預計可請(戶/車/萬)', value: `${d.nextMonthUnits} / ${d.nextMonthParking} / ${d.nextMonthAmount}` },
  ]);
  renderCommissionSplitWarnings(c);
  renderWeeklyCommissionMatrix(matrixFromManualCommission({ commission: c }));
  document.querySelectorAll('[data-block="commission"]').forEach((el) => {
    el.addEventListener('input', onCommissionFieldInput);
  });
}

function onCommissionFieldInput(ev) {
  const el = ev.target;
  const field = el.getAttribute('data-field');
  if (!field) {
    refreshDerivedFromForm();
    return;
  }
  const ratio = retentionRatioDefault();
  const setVal = (key, val) => {
    const input = document.querySelector(`[data-block="commission"][data-field="${key}"]`);
    if (input) input.value = roundCommission4(val);
  };
  if (field === 'claimableAmount') {
    const auto = splitFromTotal100(el.value, ratio);
    setVal('claimableRetentionAmount', auto.retention);
    setVal('claimablePayableAmount', auto.payable);
  } else if (field === 'claimedAmount') {
    const auto = splitFromTotal100(el.value, ratio);
    setVal('claimedRetentionAmount', auto.retention);
    setVal('claimedPayableAmount', auto.payable);
  }
  refreshDerivedFromForm();
}

function refreshDerivedFromForm() {
  if (!current) return;
  const manual = collectManualFromForm(current.manual);
  manual.commission = normalizeCommissionSplits(manual.commission || {});
  const inv = calcInventoryDerived(manual.inventory || {});
  renderDerivedCards('inventoryDerived', [
    { label: '戶數去化率', value: `${inv.unitRate}%` },
    { label: '車位去化率', value: `${inv.parkingRate}%` },
    { label: '成交價去化率', value: `${inv.amountRate}%` },
    { label: '底價去化率', value: `${inv.basePriceRate}%` },
    { label: '未售底價(萬)', value: `${inv.remainBasePrice}` },
    { label: '剩餘戶／車', value: `${inv.remainUnits} / ${inv.remainParking}` },
    { label: '住宅去化率', value: `${inv.residentialRate}%` },
    { label: '事務所去化率', value: `${inv.officeRate}%` },
    { label: '店鋪去化率', value: `${inv.shopRate}%` },
    { label: '店面去化率', value: `${inv.storefrontRate}%` },
  ]);
  const com = calcCommissionDerived(manual.commission || {});
  const labels = current?.commissionDefaults?.labels
    || { payable: '97%可請', retention: '3%保留款' };
  renderDerivedCards('commissionDerived', [
    { label: `${labels.payable}(萬)`, value: `${com.payableAmount}` },
    { label: `${labels.retention}(萬)`, value: `${com.retentionAmount}` },
    { label: '未請佣金額100%(萬)', value: `${com.unclaimedAmount}` },
    { label: '未請佣戶數', value: `${com.unclaimedUnits}` },
    { label: '未請佣車位', value: `${com.unclaimedParking}` },
    { label: '已請佣已入帳(萬)', value: `${com.bookedAmount}` },
    { label: '已請佣未入帳(萬)', value: `${com.unbookedAmount}` },
    { label: '本月預計可請(戶/車/萬)', value: `${com.nextMonthUnits} / ${com.nextMonthParking} / ${com.nextMonthAmount}` },
  ]);
  const unbookedEl = document.getElementById('commissionUnbooked');
  if (unbookedEl) unbookedEl.value = com.unbookedAmount;
  renderCommissionSplitWarnings(manual.commission || {});
  renderWeeklyCommissionMatrix(matrixFromManualCommission(manual));
}

function renderConversion(auto, manual) {
  const tbody = document.querySelector('#conversionTable tbody');
  const rows = auto.conversion || [];
  const overrides = (manual || current?.manual || {}).conversionManual || {};
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty-row">尚無銷售資料</td></tr>';
    return;
  }
  const convVal = (r, field) => {
    const ov = overrides[r.name] || {};
    if (ov[field] != null && ov[field] !== '') return Number(ov[field]) || 0;
    return Number(r[field] ?? 0) || 0;
  };
  const dataRows = rows.filter((r) => r.name !== '合計');
  const sums = { visits: 0, deals: 0, amount: 0, refunds: 0, refundAmount: 0 };
  dataRows.forEach((r) => {
    sums.visits += convVal(r, 'visits');
    sums.deals += convVal(r, 'deals');
    sums.amount += convVal(r, 'amount');
    sums.refunds += convVal(r, 'refunds');
    sums.refundAmount += convVal(r, 'refundAmount');
  });
  const convInput = (name, field, value) =>
    `<input type="number" step="0.01" class="table-input" data-conv="${escapeHtml(name)}" data-cf="${field}" value="${Number(value) || 0}">`;
  const rateText = (visits, deals) => Number(deals) ? `${Math.round((Number(visits) / Number(deals)) * 10) / 10}:1` : '—';
  const htmlRows = dataRows.map((r) => {
    const visits = convVal(r, 'visits');
    const deals = convVal(r, 'deals');
    const amount = convVal(r, 'amount');
    const refunds = convVal(r, 'refunds');
    const refundAmount = convVal(r, 'refundAmount');
    const bold = r.name === '前期銷售';
    const name = bold ? `<strong>${escapeHtml(r.name)}</strong>` : escapeHtml(r.name);
    return `<tr>
      <td>${name}</td>
      <td>${convInput(r.name, 'visits', visits)}</td>
      <td>${convInput(r.name, 'deals', deals)}</td>
      <td><strong>${escapeHtml(rateText(visits, deals))}</strong></td>
      <td>${convInput(r.name, 'amount', amount)}</td>
      <td>${convInput(r.name, 'refunds', refunds)}</td>
      <td>${convInput(r.name, 'refundAmount', refundAmount)}</td>
      <td>${r.weekVisits}</td>
      <td>${r.weekDeals}</td>
      <td>${r.weekAmount ?? 0}</td>
    </tr>`;
  });
  const totalAuto = rows.find((r) => r.name === '合計') || {};
  htmlRows.push(`<tr data-total="1">
      <td><strong>合計</strong></td>
      <td><strong>${sums.visits}</strong></td>
      <td><strong>${sums.deals}</strong></td>
      <td><strong>${escapeHtml(rateText(sums.visits, sums.deals))}</strong></td>
      <td><strong>${sums.amount}</strong></td>
      <td><strong>${sums.refunds}</strong></td>
      <td><strong>${sums.refundAmount}</strong></td>
      <td>${totalAuto.weekVisits ?? 0}</td>
      <td>${totalAuto.weekDeals ?? 0}</td>
      <td>${totalAuto.weekAmount ?? 0}</td>
    </tr>`);
  tbody.innerHTML = htmlRows.join('');
  tbody.querySelectorAll('[data-conv][data-cf]').forEach((el) => {
    el.addEventListener('change', () => {
      if (!current) return;
      const manualData = collectManualFromForm(current.manual);
      current.manual = manualData;
      renderConversion(current.auto, manualData);
    });
  });
}

function filterDimRows(rows, mode) {
  if (!rows || !rows.length) return [];
  const dataRows = rows.filter((r) => r.name !== '合計');
  let shown = dataRows;
  if (mode === 'week') {
    shown = dataRows.filter((r) =>
      Number(r.weekVisits || r.count || 0) > 0 || Number(r.weekPhones || 0) > 0);
  } else if (mode === 'cum') {
    shown = dataRows.filter((r) =>
      Number(r.cumVisits || 0) > 0
      || Number(r.weekVisits || 0) > 0
      || Number(r.weekPhones || 0) > 0);
  }
  const totalRow = rows.find((r) => r.name === '合計');
  return totalRow ? [...shown, totalRow] : shown;
}

function renderDimTable(tableId, rows, withPhones = false) {
  const table = document.getElementById(tableId);
  if (!table) return;
  const thead = table.querySelector('thead');
  if (thead) thead.innerHTML = withPhones ? DIM_HEADERS : DIM_HEADERS_BASIC;
  const tbody = table.querySelector('tbody');
  const mode = document.getElementById('dimFilterMode')?.value || 'week';
  const filtered = filterDimRows(rows, mode);
  const colSpan = withPhones ? 10 : 8;
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="${colSpan}" class="empty-row">尚無資料</td></tr>`;
    return;
  }
  tbody.innerHTML = filtered.map((r) => {
    const name = r.name === '合計' ? `<strong>${escapeHtml(r.name)}</strong>` : escapeHtml(r.name);
    if (withPhones) {
      return `<tr>
        <td>${name}</td>
        <td>${r.priorVisits ?? 0}</td>
        <td>${r.weekVisits ?? r.count ?? 0}</td>
        <td><strong>${r.cumVisits ?? 0}</strong></td>
        <td>${r.weekVisitPct ?? 0}%</td>
        <td>${r.cumVisitPct ?? 0}%</td>
        <td><strong>${r.weekPhones ?? 0}</strong></td>
        <td>${r.weekPhonePct ?? 0}%</td>
        <td>${r.weekDeals ?? 0}</td>
        <td>${r.weekDealPct ?? 0}%</td>
      </tr>`;
    }
    return `<tr>
    <td>${name}</td>
    <td>${r.priorVisits ?? 0}</td>
    <td>${r.weekVisits ?? r.count ?? 0}</td>
    <td><strong>${r.cumVisits ?? 0}</strong></td>
    <td>${r.weekVisitPct ?? 0}%</td>
    <td>${r.cumVisitPct ?? 0}%</td>
    <td>${r.weekDeals ?? 0}</td>
    <td>${r.weekDealPct ?? 0}%</td>
  </tr>`;
  }).join('');
}

function renderAllDimTables() {
  if (!current?.auto) return;
  const auto = current.auto;
  renderDimTable('regionDimTable', auto.byRegion, true);
  renderDimTable('mediaDimTable', auto.byMedia, true);
  renderDimTable('sourceDimTable', auto.bySource, false);
  renderDimTable('purposeDimTable', auto.byPurpose, false);
  renderDimTable('occupationDimTable', auto.byOccupation, false);
  renderDimTable('ageDimTable', auto.byAge, false);
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

function visitorRowHtml(v) {
  return `<tr>
    <td class="cell-date">${escapeHtml(v.date)}</td>
    <td>${escapeHtml(v.visitType)}</td>
    <td>${escapeHtml(v.customerName)}</td>
    <td>${escapeHtml(v.region)}</td>
    <td>${escapeHtml(v.media)}</td>
    <td>${escapeHtml(v.occupation || '')}</td>
    <td>${escapeHtml(v.age || '')}</td>
    <td>${escapeHtml(v.introUnit || '')}</td>
    <td class="cell-wrap cell-discussion">${escapeHtml(v.discussion || '')}</td>
    <td class="cell-wrap">${escapeHtml(v.notPurchasedReason || '')}</td>
    <td>${escapeHtml(v.sincerity)}</td>
    <td>${escapeHtml(v.salesperson1)}${v.isCoManaged ? '＋' + escapeHtml(v.salesperson2 || '') : ''}</td>
  </tr>`;
}

function fillVisitorTable(tableId, rows, emptyText) {
  const tbody = document.querySelector(`#${tableId} tbody`);
  if (!tbody) return;
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="12" class="empty-row">${emptyText}</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(visitorRowHtml).join('');
}

function renderVisitors(auto) {
  const rows = auto.visitors || [];
  const isReturn = (v) => (v.visitType || '') === '回訪';
  fillVisitorTable('visitorTableNew', rows.filter((v) => !isReturn(v)), '本週尚無納入週報的新客');
  fillVisitorTable('visitorTableReturn', rows.filter(isReturn), '本週尚無納入週報的回訪');
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

function applySuggestedFromSales() {
  if (!current) {
    showToast('請先載入本週資料', 'error');
    return;
  }
  const s = current.suggested;
  if (!s || !(s.totalRecords > 0)) {
    showToast('銷售總表尚無資料，請先至銷售總表登錄', 'error');
    return;
  }
  const manual = collectManualFromForm(current.manual);
  ['deals', 'dealsCum', 'signings', 'signingsCum', 'unsignedCum', 'purchases', 'purchasesCum', 'unreported'].forEach((key) => {
    if (s[key]) manual[key] = { ...manual[key], ...s[key] };
  });
  if (s.dealsCum && s.signingsCum) {
    manual.unsignedCum = {
      units: Math.max((s.dealsCum.units || 0) - (s.signingsCum.units || 0), 0),
      parking: Math.max((s.dealsCum.parking || 0) - (s.signingsCum.parking || 0), 0),
      amount: Math.max((s.dealsCum.amount || 0) - (s.signingsCum.amount || 0), 0),
    };
  }
  current.manual = manual;
  renderDealInputs(manual);
  renderConversion(current.auto, manual);
  document.getElementById('salesSuggestHint').textContent =
    `已帶入（銷售總表 ${s.totalRecords} 筆；本週成交 ${s.weekDealCount || 0} 筆）`;
  showToast('已從銷售總表帶入成交／簽約數字');
}

function renderAll(payload) {
  current = payload;
  document.getElementById('weekEmpty').classList.add('hidden');
  document.getElementById('weekWorkspace').classList.remove('hidden');
  document.getElementById('weekNumber').value = payload.weekNumber || '';
  if (payload.week1Start != null && document.getElementById('week1Start')) {
    document.getElementById('week1Start').value = payload.week1Start || '';
  }
  applySuggestedWeekNumber();
  document.getElementById('weekSaveBadge').textContent = payload.saved
    ? `已儲存 ${payload.updatedAt || ''}`
    : '尚未儲存';
  document.getElementById('weekSaveBadge').className = payload.saved ? 'badge' : 'badge badge-muted';

  const manual = payload.manual || {};
  const auto = payload.auto || {};
  const derived = payload.derived || {};
  const suggested = payload.suggested || {};
  renderKpi(auto, manual);
  renderDaily(auto, manual);
  renderPhoneDetail(manual);
  renderAllDimTables();
  renderDealInputs(manual);
  renderInventory(manual, derived.inventory);
  renderCommission(manual, derived.commission);
  document.getElementById('reviewNotes').value = manual.reviewNotes || '';
  document.getElementById('competitorNotes').value = manual.competitorNotes || '';
  document.getElementById('weekMemo').value = manual.memo || '';
  renderConversion(auto, manual);
  renderVisitorMini('returnList', auto.returnVisits, '本週尚無回訪');
  renderVisitorMini('hopeList', auto.hopeCustomers, '本週尚無有望客');
  renderVisitors(auto);
  renderHistory(payload.history || []);
  const hint = document.getElementById('salesSuggestHint');
  if (hint) {
    hint.textContent = suggested.totalRecords
      ? `銷售總表 ${suggested.totalRecords} 筆可帶入成交／簽約`
      : '銷售總表尚無資料';
  }
}

async function loadWeek() {
  const siteId = document.getElementById('weekSite').value;
  const weekStart = document.getElementById('weekStart').value;
  if (!siteId || !weekStart) {
    showToast('請選擇案場與週起始日', 'error');
    return;
  }
  updateRangeLabel();
  await loadFieldOptions(siteId);
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
    saveWeeklyContext();
    const { payload, restored } = mergeWeeklyDraft(json);
    renderAll(payload);
    if (restored) {
      showToast('已還原離開頁面前未儲存的編輯');
    } else {
      showToast('已載入本週資料');
    }
  } catch {
    showToast('載入失敗', 'error');
  }
}

async function saveWeek1Start() {
  const siteId = document.getElementById('weekSite').value;
  if (!siteId) {
    showToast('請先選擇案場', 'error');
    return;
  }
  const el = document.getElementById('week1Start');
  let week1Start = el.value || '';
  if (week1Start) {
    week1Start = toYmd(mondayOf(parseYmd(week1Start)));
    el.value = week1Start;
  }
  try {
    const res = await fetch(`/api/sites/${encodeURIComponent(siteId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ week1Start }),
    });
    const json = await res.json();
    if (!res.ok) {
      showToast(json.error || '儲存失敗', 'error');
      return;
    }
    const site = currentSite();
    if (site) site.week1Start = json.site?.week1Start || '';
    applySuggestedWeekNumber();
    saveWeeklyContext();
    showToast(week1Start ? `已設第 1 週為 ${week1Start}（週一）` : '已清除第 1 週起始日');
  } catch {
    showToast('儲存失敗', 'error');
  }
}

async function saveWeek() {
  if (!current) {
    showToast('請先載入本週資料', 'error');
    return;
  }
  const manual = collectManualFromForm(current.manual);
  manual.commission = normalizeCommissionSplits(manual.commission || {});
  const d = calcCommissionDerived(manual.commission);
  if (!d.claimableSplitOk || !d.claimedSplitOk) {
    renderCommissionSplitWarnings(manual.commission);
    const ok = window.confirm(
      '請佣摘要：3%＋97% 與 100% 金額不一致。\n仍要儲存嗎？（建議先修正紅字警示的數字）',
    );
    if (!ok) return;
  }
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
    clearWeeklyDraft();
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
  fetch(`${path}?${params}`)
    .then(async (res) => {
      if (!res.ok) {
        let msg = '匯出失敗';
        try {
          const json = await res.json();
          msg = json.error || msg;
        } catch {
          msg = `匯出失敗（${res.status}）`;
        }
        showToast(msg, 'error');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const ext = format === 'csv' ? 'csv' : 'xlsx';
      a.download = `weekly_${current.weekStart}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
      showToast(format === 'csv' ? 'CSV 已下載' : 'Excel 已下載');
    })
    .catch(() => showToast('匯出失敗，請稍後再試', 'error'));
}

function shiftWeek(delta) {
  const el = document.getElementById('weekStart');
  if (!el.value) return;
  const start = mondayOf(parseYmd(el.value));
  el.value = toYmd(addDays(start, delta * 7));
  updateRangeLabel();
  applySuggestedWeekNumber();
  saveWeeklyContext();
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
  const shouldAutoLoad = restoreWeeklyContext();
  syncWeek1StartField();
  if (!document.getElementById('weekNumber').value) applySuggestedWeekNumber();
  await loadFieldOptions(document.getElementById('weekSite').value);

  document.getElementById('weekStart').addEventListener('change', () => {
    updateRangeLabel();
    applySuggestedWeekNumber();
    saveWeeklyContext();
  });
  document.getElementById('weekSite').addEventListener('change', () => {
    syncWeek1StartField();
    applySuggestedWeekNumber();
    saveWeeklyContext();
    loadFieldOptions(document.getElementById('weekSite').value);
  });
  document.getElementById('weekNumber').addEventListener('input', saveWeeklyContext);
  document.getElementById('loadWeekBtn').addEventListener('click', loadWeek);
  document.getElementById('prevWeekBtn').addEventListener('click', () => shiftWeek(-1));
  document.getElementById('nextWeekBtn').addEventListener('click', () => shiftWeek(1));
  document.getElementById('saveWeek1Btn')?.addEventListener('click', saveWeek1Start);
  document.getElementById('saveWeekBtn').addEventListener('click', saveWeek);
  document.getElementById('fillFromSalesBtn').addEventListener('click', applySuggestedFromSales);
  document.getElementById('openSalesFromWeekly')?.addEventListener('click', saveWeeklyDraft);
  document.getElementById('addPhoneCallBtn')?.addEventListener('click', addPhoneCallRow);
  document.getElementById('dimFilterMode')?.addEventListener('change', renderAllDimTables);
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

  document.getElementById('weekWorkspace')?.addEventListener('input', scheduleWeeklyDraftSave);
  document.getElementById('weekWorkspace')?.addEventListener('change', scheduleWeeklyDraftSave);
  window.addEventListener('pagehide', saveWeeklyDraft);

  if (shouldAutoLoad) {
    await loadWeek();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { init(); });
} else {
  init();
}
