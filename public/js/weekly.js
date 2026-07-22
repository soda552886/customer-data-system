let sites = [];
let current = null;

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
  const day = (x.getDay() + 6) % 7; // Mon=0
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

  ['deals', 'signings', 'purchases'].forEach((key) => {
    manual[key] = manual[key] || { units: 0, parking: 0, amount: 0 };
    ['units', 'parking', 'amount'].forEach((f) => {
      const el = document.querySelector(`[data-block="${key}"][data-field="${f}"]`);
      if (el) manual[key][f] = Number(el.value) || 0;
    });
  });

  manual.commission = manual.commission || {};
  ['sellableAmount', 'claimableAmount', 'claimedAmount', 'claimableUnits', 'claimedUnits'].forEach((f) => {
    const el = document.querySelector(`[data-block="commission"][data-field="${f}"]`);
    if (el) manual.commission[f] = Number(el.value) || 0;
  });

  manual.reviewNotes = document.getElementById('reviewNotes').value;
  manual.competitorNotes = document.getElementById('competitorNotes').value;
  manual.memo = document.getElementById('weekMemo').value;
  return manual;
}

function renderKpi(auto, manual) {
  const t = auto.totals || {};
  const phoneSum = (manual.days || []).reduce((s, d) => s + (Number(d.phoneCalls) || 0), 0);
  const deals = manual.deals || {};
  const items = [
    { label: '本週來人', value: `${t.total || 0} 組` },
    { label: '新客／回訪', value: `${t.new || 0} / ${t.return || 0}` },
    { label: '本週來電', value: `${phoneSum} 通` },
    { label: '客資成交筆數', value: `${t.deal || 0} 筆` },
    { label: '手填成交', value: `${deals.units || 0} 戶／${deals.parking || 0} 車` },
    { label: '成交金額', value: `${deals.amount || 0} 萬` },
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

function renderCommission(manual) {
  const c = manual.commission || {};
  const fields = [
    { key: 'sellableAmount', label: '累積銷售金額(萬)' },
    { key: 'claimableAmount', label: '可請佣金額(萬)' },
    { key: 'claimedAmount', label: '已請佣金額(萬)' },
    { key: 'claimableUnits', label: '可請佣戶數' },
    { key: 'claimedUnits', label: '已請佣戶數' },
  ];
  document.getElementById('commissionInputs').innerHTML = fields.map((f) => `
    <div class="form-group">
      <label>${f.label}</label>
      <input type="number" min="0" step="0.01" data-block="commission" data-field="${f.key}" value="${Number(c[f.key]) || 0}">
    </div>
  `).join('');
}

function renderStatList(elId, rows) {
  const el = document.getElementById(elId);
  if (!rows || !rows.length) {
    el.innerHTML = '<p class="hint">本週尚無資料</p>';
    return;
  }
  el.innerHTML = rows.map((r) => `
    <div class="mini-stat-item">
      <span>${escapeHtml(r.name)}</span>
      <strong>${r.count}</strong>
    </div>
  `).join('');
}

function renderVisitors(auto) {
  const tbody = document.querySelector('#visitorTable tbody');
  const rows = auto.visitors || [];
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty-row">本週尚無客資紀錄</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map((v) => `<tr>
    <td class="cell-date">${escapeHtml(v.date)}</td>
    <td>${escapeHtml(v.visitType)}</td>
    <td>${escapeHtml(v.customerName)}</td>
    <td>${escapeHtml(v.phone)}</td>
    <td>${escapeHtml(v.region)}</td>
    <td>${escapeHtml(v.media)}</td>
    <td>${escapeHtml(v.source)}</td>
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
  renderKpi(auto, manual);
  renderDaily(auto, manual);
  renderDealInputs(manual);
  renderCommission(manual);
  document.getElementById('reviewNotes').value = manual.reviewNotes || '';
  document.getElementById('competitorNotes').value = manual.competitorNotes || '';
  document.getElementById('weekMemo').value = manual.memo || '';
  renderStatList('regionStats', auto.byRegion);
  renderStatList('mediaStats', auto.byMedia);
  renderStatList('sourceStats', auto.bySource);
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

function exportWeek() {
  if (!current) {
    showToast('請先載入本週資料', 'error');
    return;
  }
  // save current form numbers into export by asking user to save first is nicer,
  // but export uses latest saved + live auto; nudge save
  const params = new URLSearchParams({
    siteId: current.siteId,
    weekStart: current.weekStart,
  });
  window.location.href = `/api/weekly/export.csv?${params}`;
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
  if (window.navReady) await window.navReady;
  if (!window.currentUser) {
    window.location.href = '/login.html?next=/weekly.html';
    return;
  }
  if (!(window.currentUser.permissions || []).includes('manage_weekly_reports')) {
    showToast('沒有週報權限', 'error');
    setTimeout(() => { window.location.href = '/'; }, 1200);
    return;
  }

  await loadSites();
  await loadMeta();

  document.getElementById('weekStart').addEventListener('change', updateRangeLabel);
  document.getElementById('loadWeekBtn').addEventListener('click', loadWeek);
  document.getElementById('prevWeekBtn').addEventListener('click', () => shiftWeek(-1));
  document.getElementById('nextWeekBtn').addEventListener('click', () => shiftWeek(1));
  document.getElementById('saveWeekBtn').addEventListener('click', saveWeek);
  document.getElementById('exportWeekBtn').addEventListener('click', async () => {
    if (!current) return;
    await saveWeek();
    exportWeek();
  });
}

init();
