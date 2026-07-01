let sites = [];
let currentPage = 1;
let lastResults = [];
let lastTotal = 0;

const STORAGE_KEY = 'customer_report_columns';

const REPORT_COLUMNS = [
  { group: '基本', key: 'visit_date', label: '日期' },
  { group: '基本', key: 'site_name', label: '案場' },
  { group: '基本', key: 'visit_type', label: '客戶類型' },
  { group: '基本', key: 'is_deal', label: '是否成交' },
  { group: '基本', key: 'visitDate', label: '參觀日期' },
  { group: '基本', key: 'firstVisitDate', label: '首次參觀日期' },
  { group: '基本', key: 'returnVisitDate', label: '回訪日期' },
  { group: '基本', key: 'prevVisitDate', label: '前次來訪日期' },
  { group: '基本', key: 'visitCount', label: '回訪次數' },
  { group: '基本', key: 'returnCount', label: '回籠次數' },
  { group: '基本', key: 'customerName', label: '客戶姓名' },
  { group: '基本', key: 'phone', label: '主要電話' },
  { group: '基本', key: 'phoneSecondary', label: '次要電話' },
  { group: '基本', key: 'address', label: '居住地址' },
  { group: '基本', key: 'streetCommunity', label: '街道路名或社區' },
  { group: '基本', key: 'region', label: '區域' },
  { group: '背景', key: 'age', label: '年齡' },
  { group: '背景', key: 'occupation', label: '職業' },
  { group: '背景', key: 'purchasePurpose', label: '購屋用途' },
  { group: '背景', key: 'purchaseMotive', label: '購屋動機' },
  { group: '背景', key: 'purchaseNeed', label: '購屋需求' },
  { group: '背景', key: 'budget', label: '總價預算' },
  { group: '背景', key: 'downPayment', label: '自備款' },
  { group: '媒體', key: 'media1', label: '媒體1' },
  { group: '媒體', key: 'media2', label: '媒體2' },
  { group: '媒體', key: 'media3', label: '媒體3' },
  { group: '媒體', key: 'media', label: '媒體' },
  { group: '產品', key: 'commercialProject', label: '介紹建案' },
  { group: '產品', key: 'roomType', label: '需求房型' },
  { group: '產品', key: 'floorNeed', label: '需求樓層' },
  { group: '產品', key: 'areaNeed', label: '需求坪數' },
  { group: '產品', key: 'unitType', label: '需求戶型' },
  { group: '產品', key: 'unitNeed', label: '需求戶別' },
  { group: '產品', key: 'roomNeed', label: '房間需求' },
  { group: '產品', key: 'parkingNeed', label: '車位需求' },
  { group: '產品', key: 'productResidential', label: '產品需求-住宅' },
  { group: '產品', key: 'productOffice', label: '產品需求-事務所' },
  { group: '產品', key: 'introUnit', label: '介紹戶別樓層' },
  { group: '洽談', key: 'visitorCount', label: '當日來人' },
  { group: '洽談', key: 'visitorRelation', label: '來人關係' },
  { group: '洽談', key: 'notPurchasedReason', label: '未購因素' },
  { group: '洽談', key: 'purchasedReason', label: '成交因素' },
  { group: '洽談', key: 'discussion', label: '洽談內容' },
  { group: '洽談', key: 'customerSource', label: '客戶來源' },
  { group: '洽談', key: 'sincerity', label: '客戶誠意度' },
  { group: '洽談', key: 'salesperson1', label: '銷售人員1' },
  { group: '洽談', key: 'salesperson2', label: '銷售人員2' },
  { group: '系統', key: 'created_at', label: '建檔時間' },
];

const DEFAULT_COLUMNS = [
  'visit_date', 'site_name', 'visit_type', 'is_deal',
  'customerName', 'phone', 'region', 'age', 'budget',
  'media1', 'media2', 'sincerity', 'salesperson1', 'discussion',
];

const FIELD_LABELS = Object.fromEntries(REPORT_COLUMNS.map((c) => [c.key, c.label]));

function getSavedColumns() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch { /* ignore */ }
  return [...DEFAULT_COLUMNS];
}

function saveColumns(keys) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
}

function getSelectedColumnKeys() {
  return Array.from(document.querySelectorAll('#columnPicker input:checked')).map((cb) => cb.value);
}

function getSelectedColumns() {
  const keys = getSelectedColumnKeys();
  return REPORT_COLUMNS.filter((c) => keys.includes(c.key));
}

function renderColumnPicker() {
  const picker = document.getElementById('columnPicker');
  const saved = getSavedColumns();
  let currentGroup = '';
  let html = '';

  REPORT_COLUMNS.forEach((col) => {
    if (col.group !== currentGroup) {
      currentGroup = col.group;
      html += `<div class="col-group-title">${col.group}欄位</div>`;
    }
    const checked = saved.includes(col.key) ? 'checked' : '';
    html += `<label class="col-check-label">
      <input type="checkbox" value="${col.key}" ${checked}>
      ${col.label}
    </label>`;
  });

  picker.innerHTML = html;
  picker.querySelectorAll('input').forEach((cb) => {
    cb.addEventListener('change', () => {
      saveColumns(getSelectedColumnKeys());
      if (lastResults.length > 0) renderResults({ records: lastResults, total: lastTotal, page: currentPage, limit: 50 });
    });
  });
}

function setAllColumns(checked) {
  document.querySelectorAll('#columnPicker input').forEach((cb) => { cb.checked = checked; });
  saveColumns(getSelectedColumnKeys());
  if (lastResults.length > 0) renderResults({ records: lastResults, total: lastTotal, page: currentPage, limit: 50 });
}

function resetColumns() {
  saveColumns([...DEFAULT_COLUMNS]);
  renderColumnPicker();
  if (lastResults.length > 0) renderResults({ records: lastResults, total: lastTotal, page: currentPage, limit: 50 });
}

function getCellValue(record, key) {
  const d = record.data || {};
  switch (key) {
    case 'visit_date':
      return record.visit_date || d.visitDate || d.returnVisitDate || '';
    case 'site_name':
      return record.site_name || '';
    case 'visit_type':
      return record.visit_type || '';
    case 'is_deal':
      return record.is_deal ? '是' : '否';
    case 'created_at':
      return record.created_at || '';
    default: {
      const val = d[key];
      if (Array.isArray(val)) return val.join('、');
      return val != null ? String(val) : '';
    }
  }
}

function formatCellHtml(key, value, record) {
  if (!value) return '-';
  if (key === 'visit_type') {
    const cls = value === '新客' ? 'tag-new' : 'tag-return';
    return `<span class="tag ${cls}">${value}</span>`;
  }
  if (key === 'is_deal') {
    const cls = value === '是' ? 'tag-deal' : 'tag-no-deal';
    return `<span class="tag ${cls}">${value}</span>`;
  }
  if (key === 'discussion' && value.length > 40) {
    return `${value.slice(0, 40)}…`;
  }
  return escapeHtml(value);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function updateSiteLabel() {
  const siteId = document.getElementById('searchSite').value;
  const label = document.getElementById('currentSiteLabel');
  if (!siteId) {
    label.textContent = '目前顯示：全部案場';
    return;
  }
  const site = sites.find((s) => s.id === siteId);
  label.textContent = `目前顯示：${site ? site.name : siteId}`;
}

function initYearSelect() {
  const sel = document.getElementById('searchYear');
  const currentYear = new Date().getFullYear();
  for (let y = currentYear; y >= currentYear - 10; y--) {
    const opt = document.createElement('option');
    opt.value = y;
    opt.textContent = `${y} 年`;
    sel.appendChild(opt);
  }
}

async function loadSites() {
  const res = await fetch('/api/sites');
  sites = await res.json();
  const sel = document.getElementById('searchSite');
  sites.forEach((s) => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.name;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', () => {
    updateSiteLabel();
    currentPage = 1;
    doSearch();
  });
}

function getSearchParams(extraLimit) {
  const params = new URLSearchParams();
  const fields = ['searchYear', 'searchStartDate', 'searchEndDate', 'searchSite',
    'searchRegion', 'searchVisitType', 'searchDeal', 'searchPhone', 'searchName'];
  const keys = ['year', 'startDate', 'endDate', 'siteId', 'region', 'visitType', 'isDeal', 'phone', 'name'];
  fields.forEach((id, i) => {
    const val = document.getElementById(id).value.trim();
    if (val) params.set(keys[i], val);
  });
  params.set('page', currentPage);
  params.set('limit', String(extraLimit || 50));
  return params;
}

function renderResults(data) {
  const cols = getSelectedColumns();
  const thead = document.getElementById('resultsHead');
  const tbody = document.getElementById('resultsBody');
  document.getElementById('resultCount').textContent = `${data.total} 筆`;
  lastResults = data.records;
  lastTotal = data.total;

  if (cols.length === 0) {
    thead.innerHTML = '<tr><th>請至少選擇一個報表欄位</th></tr>';
    tbody.innerHTML = '<tr><td class="empty-row">請在上方「報表欄位設定」勾選要顯示的欄位</td></tr>';
    document.getElementById('pagination').classList.add('hidden');
    return;
  }

  if (data.records.length === 0) {
    thead.innerHTML = `<tr>${cols.map((c) => `<th>${c.label}</th>`).join('')}<th>操作</th></tr>`;
    tbody.innerHTML = `<tr><td colspan="${cols.length + 1}" class="empty-row">查無符合條件的資料</td></tr>`;
    document.getElementById('pagination').classList.add('hidden');
    return;
  }

  thead.innerHTML = `<tr>${cols.map((c) => `<th>${c.label}</th>`).join('')}<th>操作</th></tr>`;

  tbody.innerHTML = data.records.map((r) => {
    const cells = cols.map((c) => {
      const val = getCellValue(r, c.key);
      return `<td>${formatCellHtml(c.key, val, r)}</td>`;
    }).join('');
    return `<tr>${cells}<td><button class="btn-sm" onclick="showDetail(${r.id})">詳情</button></td></tr>`;
  }).join('');

  renderPagination(data.total, data.page, data.limit);
}

function renderPagination(total, page, limit) {
  const totalPages = Math.ceil(total / limit);
  const pag = document.getElementById('pagination');
  if (totalPages <= 1) { pag.classList.add('hidden'); return; }
  pag.classList.remove('hidden');

  let html = '';
  if (page > 1) html += `<button onclick="goPage(${page - 1})">上一頁</button>`;
  const start = Math.max(1, page - 4);
  const end = Math.min(totalPages, start + 9);
  for (let i = start; i <= end; i++) {
    html += `<button class="${i === page ? 'active' : ''}" onclick="goPage(${i})">${i}</button>`;
  }
  if (page < totalPages) html += `<button onclick="goPage(${page + 1})">下一頁</button>`;
  pag.innerHTML = html;
}

window.goPage = function (page) {
  currentPage = page;
  doSearch();
};

async function doSearch() {
  const params = getSearchParams();
  const res = await fetch(`/api/customers?${params}`);
  const data = await res.json();
  renderResults(data);
  loadStats();
}

async function fetchAllResults() {
  const params = getSearchParams(10000);
  params.set('page', '1');
  const res = await fetch(`/api/customers?${params}`);
  const data = await res.json();
  return data.records;
}

async function loadStats() {
  const year = document.getElementById('searchYear').value;
  const siteId = document.getElementById('searchSite').value;
  const params = new URLSearchParams();
  if (year) params.set('year', year);
  if (siteId) params.set('siteId', siteId);

  const res = await fetch(`/api/stats?${params}`);
  const stats = await res.json();
  const panel = document.getElementById('statsPanel');

  if (stats.length === 0) {
    panel.innerHTML = '<p class="empty-row">尚無統計資料</p>';
    return;
  }

  const grouped = {};
  stats.forEach((s) => {
    if (!grouped[s.site_name]) grouped[s.site_name] = { 新客: 0, 回訪: 0, 成交: 0 };
    grouped[s.site_name][s.visit_type] = (grouped[s.site_name][s.visit_type] || 0) + s.count;
    if (s.is_deal) grouped[s.site_name].成交 += s.count;
  });

  panel.innerHTML = Object.entries(grouped).map(([name, g]) => `
    <div class="stat-card">
      <div class="stat-value">${g.新客 + g.回訪}</div>
      <div class="stat-label">${name}</div>
      <div class="stat-label">新客 ${g.新客} / 回訪 ${g.回訪} / 成交 ${g.成交}</div>
    </div>
  `).join('');
}

window.showDetail = async function (id) {
  const res = await fetch(`/api/customers/${id}`);
  const record = await res.json();
  const d = record.data;
  const modal = document.getElementById('detailModal');
  const content = document.getElementById('detailContent');

  let html = `<dl class="detail-grid">
    <dt>案場</dt><dd>${escapeHtml(record.site_name)}</dd>
    <dt>類型</dt><dd>${escapeHtml(record.visit_type)}</dd>
    <dt>成交</dt><dd>${record.is_deal ? '是' : '否'}</dd>
    <dt>日期</dt><dd>${escapeHtml(record.visit_date || '-')}</dd>
  `;

  Object.entries(d).forEach(([key, val]) => {
    if (!val || (Array.isArray(val) && val.length === 0)) return;
    const label = FIELD_LABELS[key] || key;
    const display = Array.isArray(val) ? val.join('、') : val;
    html += `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(display)}</dd>`;
  });

  html += '</dl>';
  content.innerHTML = html;
  modal.classList.remove('hidden');
};

async function exportCSV() {
  const cols = getSelectedColumns();
  if (cols.length === 0) {
    alert('請至少選擇一個報表欄位');
    return;
  }

  const records = lastTotal > lastResults.length ? await fetchAllResults() : lastResults;
  if (records.length === 0) {
    alert('沒有資料可匯出，請先查詢');
    return;
  }

  const siteId = document.getElementById('searchSite').value;
  const siteName = siteId ? (sites.find((s) => s.id === siteId)?.name || '指定案場') : '全部案場';

  const headers = cols.map((c) => c.label);
  const rows = records.map((r) =>
    cols.map((c) => {
      const val = getCellValue(r, c.key).replace(/"/g, '""');
      return `"${val}"`;
    }).join(','),
  );

  const bom = '\uFEFF';
  const csv = bom + [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const dateStr = new Date().toISOString().slice(0, 10);
  a.download = `客戶資料報表_${siteName}_${dateStr}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function clearSearch() {
  ['searchYear', 'searchStartDate', 'searchEndDate',
    'searchRegion', 'searchVisitType', 'searchDeal', 'searchPhone', 'searchName'
  ].forEach((id) => { document.getElementById(id).value = ''; });
  document.getElementById('searchSite').value = '';
  updateSiteLabel();
  currentPage = 1;
}

document.getElementById('searchBtn').addEventListener('click', () => { currentPage = 1; doSearch(); });
document.getElementById('clearSearchBtn').addEventListener('click', () => { clearSearch(); doSearch(); });
document.getElementById('exportBtn').addEventListener('click', exportCSV);
document.getElementById('selectAllCols').addEventListener('click', () => setAllColumns(true));
document.getElementById('deselectAllCols').addEventListener('click', () => setAllColumns(false));
document.getElementById('resetCols').addEventListener('click', resetColumns);
document.getElementById('closeModal').addEventListener('click', () => {
  document.getElementById('detailModal').classList.add('hidden');
});
document.getElementById('detailModal').addEventListener('click', (e) => {
  if (e.target.id === 'detailModal') document.getElementById('detailModal').classList.add('hidden');
});

initYearSelect();
renderColumnPicker();
loadSites().then(() => {
  updateSiteLabel();
  doSearch();
});
