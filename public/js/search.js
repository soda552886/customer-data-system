let sites = [];
let currentPage = 1;
let lastResults = [];
let lastTotal = 0;
let fieldConfig = { sections: [], salesStaff: {} };
let editingRecordId = null;
let editingRecord = null;
let detailRecordId = null;
let siteExportColumnKeys = null;
let siteExportIsCustomized = false;

function userCan(perm) {
  return window.currentUser && (window.currentUser.permissions || []).includes(perm);
}

function applyPermissionUI() {
  const user = window.currentUser;
  const dangerZone = document.querySelector('.danger-zone');
  if (dangerZone) {
    const canBulkDelete = userCan('delete_all_customers');
    dangerZone.classList.toggle('hidden', !canBulkDelete);
    const deleteAllBtn = document.getElementById('deleteAllBtn');
    if (deleteAllBtn) {
      deleteAllBtn.classList.toggle('hidden', !(canBulkDelete && user && user.role === 'executive'));
    }
  }
  const exportBtn = document.getElementById('exportBtn');
  if (exportBtn) {
    // toggle 而非只 add，避免登入狀態尚未就緒時被永久隱藏
    exportBtn.classList.toggle('hidden', !userCan('export_customers'));
  }
  const detailEditBtn = document.getElementById('detailEditBtn');
  if (detailEditBtn) {
    detailEditBtn.classList.toggle('hidden', !userCan('edit_customers'));
  }
  const detailDeleteBtn = document.getElementById('detailDeleteBtn');
  if (detailDeleteBtn) {
    detailDeleteBtn.classList.toggle('hidden', !userCan('delete_customers'));
  }
}


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
  { group: '基本', key: 'return_visit_total', label: '回訪次數(累計)' },
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
  { group: '產品', key: 'focusUnit', label: '主攻戶別' },
  { group: '產品', key: 'introUnit', label: '介紹戶別樓層' },
  { group: '洽談', key: 'visitorCount', label: '當日來人' },
  { group: '洽談', key: 'visitorRelation', label: '來人關係' },
  { group: '洽談', key: 'notPurchasedReason', label: '未購因素' },
  { group: '洽談', key: 'purchasedReason', label: '成交因素' },
  { group: '洽談', key: 'discussion', label: '洽談內容' },
  { group: '洽談', key: 'customerSource', label: '客戶來源' },
  { group: '洽談', key: 'customerStatus', label: '客戶狀態' },
  { group: '洽談', key: 'cancelDate', label: '退戶日期' },
  { group: '洽談', key: 'cancelReason', label: '退戶原因' },
  { group: '洽談', key: 'remark', label: '備註' },
  { group: '洽談', key: 'sincerity', label: '客戶誠意度' },
  { group: '洽談', key: 'salesperson1', label: '銷售人員1' },
  { group: '洽談', key: 'salesperson2', label: '銷售人員2' },
  { group: '系統', key: 'created_at', label: '建檔時間' },
];

const DEFAULT_COLUMNS = [
  'visit_date', 'site_name', 'visit_type', 'is_deal',
  'customerName', 'phone', 'region', 'age', 'budget', 'visitCount',
  'media1', 'media2', 'sincerity', 'salesperson1', 'discussion',
];

const STORAGE_KEY = 'customer_report_columns';
const FIELD_LABELS = Object.fromEntries(REPORT_COLUMNS.map((c) => [c.key, c.label]));

function getSavedColumns() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const keys = JSON.parse(saved);
      if (Array.isArray(keys) && keys.length > 0) {
        const valid = keys.filter((k) => REPORT_COLUMNS.some((c) => c.key === k));
        if (valid.length > 0) return valid;
      }
    }
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

function getExportColumns() {
  if (siteExportIsCustomized && siteExportColumnKeys && siteExportColumnKeys.length > 0) {
    const colMap = new Map(REPORT_COLUMNS.map((c) => [c.key, c]));
    return siteExportColumnKeys.map((k) => colMap.get(k)).filter(Boolean);
  }
  const cols = getSelectedColumns();
  if (!siteExportColumnKeys || siteExportColumnKeys.length === 0) {
    return cols;
  }
  const keyIndex = new Map(siteExportColumnKeys.map((k, i) => [k, i]));
  return [...cols].sort((a, b) => {
    const ai = keyIndex.has(a.key) ? keyIndex.get(a.key) : 9999;
    const bi = keyIndex.has(b.key) ? keyIndex.get(b.key) : 9999;
    return ai - bi;
  });
}

async function loadSiteExportColumnOrder(siteId) {
  siteExportColumnKeys = null;
  siteExportIsCustomized = false;
  if (!siteId) {
    updateColumnPickerHint();
    return;
  }
  try {
    const res = await fetch(`/api/sites/${encodeURIComponent(siteId)}/export-column-order`);
    if (res.ok) {
      const json = await res.json();
      siteExportIsCustomized = !!json.isCustomized;
      siteExportColumnKeys = json.columnKeys || null;
    }
  } catch { /* ignore */ }
  updateColumnPickerHint();
}

function updateColumnPickerHint() {
  const hint = document.getElementById('columnPickerHint');
  if (!hint) return;
  if (siteExportIsCustomized) {
    hint.textContent = '此案場已設定專屬匯出欄位與順序，匯出 CSV 會依案場設定；下方勾選只影響本頁列表顯示，不會被案場匯出設定蓋掉。';
  } else {
    hint.textContent = '勾選要顯示在列表中的欄位（選擇會記住在本機瀏覽器）';
  }
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
  updateColumnPickerHint();
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
    case 'return_visit_total':
      return record.return_visit_total || 0;
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
  const isFieldStaff = window.currentUser?.role === 'field_staff';
  if (!siteId) {
    label.textContent = isFieldStaff ? '目前顯示：全部負責案場' : '目前顯示：全部案場';
    return;
  }
  const site = sites.find((s) => s.id === siteId);
  label.textContent = `目前顯示：${site ? site.name : siteId}`;
}

function applyFieldStaffSiteRestrictions() {
  const user = window.currentUser;
  if (!user || user.role !== 'field_staff') return;

  const searchSel = document.getElementById('searchSite');
  const allOpt = searchSel.querySelector('option[value=""]');
  if (allOpt) allOpt.textContent = '全部負責案場';

  const editSite = document.getElementById('editSite');
  if (editSite) editSite.disabled = true;

  if (sites.length === 1) {
    searchSel.value = sites[0].id;
    searchSel.disabled = true;
    updateSiteLabel();
  } else if (sites.length === 0) {
    searchSel.disabled = true;
    document.getElementById('currentSiteLabel').textContent = '尚未指派案場，請聯絡管理員';
  }
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
  const deleteSel = document.getElementById('deleteSiteSelect');
  sites.forEach((s) => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.name;
    sel.appendChild(opt);

    const delOpt = opt.cloneNode(true);
    deleteSel.appendChild(delOpt);
  });
  sel.addEventListener('change', async () => {
    updateSiteLabel();
    await loadSiteExportColumnOrder(sel.value);
    currentPage = 1;
    doSearch();
  });
}

function getSearchParams(extraLimit) {
  const params = new URLSearchParams();
  const fields = ['searchYear', 'searchStartDate', 'searchEndDate', 'searchSite',
    'searchRegion', 'searchVisitType', 'searchDeal', 'searchPhone', 'searchName', 'searchStatus'];
  const keys = ['year', 'startDate', 'endDate', 'siteId', 'region', 'visitType', 'isDeal', 'phone', 'name', 'customerStatus'];
  fields.forEach((id, i) => {
    const val = document.getElementById(id).value.trim();
    if (val) params.set(keys[i], val);
  });
  const sortEl = document.getElementById('searchSortOrder');
  params.set('sortOrder', sortEl?.value === 'asc' ? 'asc' : 'desc');
  params.set('page', currentPage);
  params.set('limit', String(extraLimit || 50));
  if (document.getElementById('excludeNew').checked) params.set('excludeNew', '1');
  if (document.getElementById('excludeReturn').checked) params.set('excludeReturn', '1');
  if (document.getElementById('excludeDeal').checked) params.set('excludeDeal', '1');
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
    const editBtn = userCan('edit_customers')
      ? `<button class="btn-sm" onclick="openEdit(${r.id})">編輯</button>`
      : '';
    const deleteBtn = userCan('delete_customers')
      ? `<button class="btn-sm btn-danger-sm-solid" onclick="deleteRecord(${r.id})">刪除</button>`
      : '';
    return `<tr>${cells}<td class="action-btns">
      <button class="btn-sm" onclick="showDetail(${r.id})">詳情</button>
      ${editBtn}
      ${deleteBtn}
    </td></tr>`;
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
  if (record.error) {
    alert(record.error);
    return;
  }
  detailRecordId = id;
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

function getEditVisitType() {
  return document.querySelector('input[name="editVisitType"]:checked')?.value || '新客';
}

function getEditIsDeal() {
  return document.querySelector('input[name="editIsDeal"]:checked')?.value === '1';
}

function fieldVisibleForEdit(field, siteId, visitType) {
  if (field.showFor && !field.showFor.includes(visitType)) return false;
  if (field.sites && !field.sites.includes(siteId)) return false;
  if (field.hideFor && field.hideFor.includes(visitType)) return false;
  return true;
}

function buildEditForm() {
  const siteId = document.getElementById('editSite').value;
  const visitType = getEditVisitType();
  const container = document.getElementById('editFormSections');
  container.innerHTML = '';

  fieldConfig.sections.forEach((section) => {
    const visibleFields = section.fields.filter((f) => fieldVisibleForEdit(f, siteId, visitType));
    if (visibleFields.length === 0) return;

    const sectionEl = document.createElement('div');
    sectionEl.className = 'card';
    sectionEl.innerHTML = `<h2 class="section-title">${section.title}</h2>`;
    const grid = document.createElement('div');
    grid.className = 'form-grid';

    visibleFields.forEach((field) => {
      const group = document.createElement('div');
      group.className = `form-group${field.type === 'textarea' || field.type === 'multiselect' ? ' full-width' : ''}`;

      const label = document.createElement('label');
      label.htmlFor = `edit_${field.key}`;
      label.innerHTML = `${field.label}${field.required ? ' <span class="required">*</span>' : ''}`;
      group.appendChild(label);

      if (field.type === 'select') {
        let options = field.options || [];
        if (field.dynamicStaff) {
          options = fieldConfig.salesStaff[siteId] || [];
        }
        if (!options.length) {
          const input = document.createElement('input');
          input.type = 'text';
          input.id = `edit_${field.key}`;
          input.name = field.key;
          input.placeholder = field.dynamicStaff ? '請輸入銷售人員姓名' : `請輸入${field.label}`;
          group.appendChild(input);
        } else {
          const input = document.createElement('select');
          input.id = `edit_${field.key}`;
          input.name = field.key;
          const empty = document.createElement('option');
          empty.value = '';
          empty.textContent = '請選擇';
          input.appendChild(empty);
          options.forEach((opt) => {
            const o = document.createElement('option');
            o.value = opt;
            o.textContent = opt;
            input.appendChild(o);
          });
          group.appendChild(input);
        }
      } else if (field.type === 'multiselect') {
        const wrap = document.createElement('div');
        wrap.className = 'checkbox-grid';
        wrap.id = `edit_${field.key}`;
        (field.options || []).forEach((opt) => {
          const lbl = document.createElement('label');
          lbl.className = 'checkbox-label';
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.name = field.key;
          cb.value = opt;
          lbl.appendChild(cb);
          lbl.appendChild(document.createTextNode(opt));
          wrap.appendChild(lbl);
        });
        group.appendChild(wrap);
      } else if (field.type === 'textarea') {
        const input = document.createElement('textarea');
        input.id = `edit_${field.key}`;
        input.name = field.key;
        if (field.placeholder) input.placeholder = field.placeholder;
        if (field.readOnly) {
          input.readOnly = true;
          input.classList.add('readonly-autofill');
        }
        group.appendChild(input);
      } else {
        const input = document.createElement('input');
        input.type = field.type;
        input.id = `edit_${field.key}`;
        input.name = field.key;
        if (field.placeholder) input.placeholder = field.placeholder;
        group.appendChild(input);
      }

      grid.appendChild(group);
    });

    sectionEl.appendChild(grid);
    container.appendChild(sectionEl);
  });

  bindEditProductFocusUnitSync();
}

function getEditCheckedValues(fieldKey) {
  return Array.from(document.querySelectorAll(`#edit_${fieldKey} input:checked`)).map((cb) => cb.value);
}

function updateEditFocusUnitFromProducts() {
  const focusEl = document.getElementById('edit_focusUnit');
  if (!focusEl) return;
  const residential = getEditCheckedValues('productResidential');
  const office = getEditCheckedValues('productOffice');
  focusEl.value = [
    residential.length ? residential.join('、') : '',
    office.length ? office.join('、') : '',
  ].join('\n');
}

function bindEditProductFocusUnitSync() {
  const residentialWrap = document.getElementById('edit_productResidential');
  const officeWrap = document.getElementById('edit_productOffice');
  if (!residentialWrap && !officeWrap) return;

  residentialWrap?.querySelectorAll('input').forEach((cb) => {
    cb.addEventListener('change', updateEditFocusUnitFromProducts);
  });
  officeWrap?.querySelectorAll('input').forEach((cb) => {
    cb.addEventListener('change', updateEditFocusUnitFromProducts);
  });
  updateEditFocusUnitFromProducts();
}

function fillEditFormData(data) {
  const siteId = document.getElementById('editSite').value;
  const visitType = getEditVisitType();

  fieldConfig.sections.forEach((section) => {
    section.fields.filter((f) => fieldVisibleForEdit(f, siteId, visitType)).forEach((field) => {
      const val = data[field.key];
      if (val === undefined || val === null || val === '') return;

      if (field.type === 'multiselect') {
        let values = [];
        if (Array.isArray(val)) values = val;
        else if (typeof val === 'string') {
          values = val.split(/[\n、,，;；]+/).map((s) => s.trim()).filter(Boolean);
        }
        values.forEach((v) => {
          const cb = document.querySelector(`#edit_${field.key} input[value="${CSS.escape(v)}"]`);
          if (cb) cb.checked = true;
        });
      } else {
        const el = document.getElementById(`edit_${field.key}`);
        if (!el) return;
        if (el.tagName === 'SELECT') {
          const exists = Array.from(el.options).some((o) => o.value === String(val));
          if (!exists) {
            const opt = document.createElement('option');
            opt.value = String(val);
            opt.textContent = field.dynamicStaff ? `${val}（原銷售／已離職）` : String(val);
            el.appendChild(opt);
          }
        }
        el.value = val;
      }
    });
  });
  updateEditFocusUnitFromProducts();
}

function collectEditFormData() {
  updateEditFocusUnitFromProducts();
  const siteId = document.getElementById('editSite').value;
  const visitType = getEditVisitType();
  const data = {};

  fieldConfig.sections.forEach((section) => {
    section.fields.filter((f) => fieldVisibleForEdit(f, siteId, visitType)).forEach((field) => {
      if (field.type === 'multiselect') {
        const checked = document.querySelectorAll(`#edit_${field.key} input:checked`);
        data[field.key] = Array.from(checked).map((cb) => cb.value);
      } else {
        const el = document.getElementById(`edit_${field.key}`);
        if (el) data[field.key] = el.value;
      }
    });
  });
  return data;
}

function populateEditSiteSelect(selectedSiteId) {
  const sel = document.getElementById('editSite');
  sel.innerHTML = sites.map((s) =>
    `<option value="${s.id}" ${s.id === selectedSiteId ? 'selected' : ''}>${escapeHtml(s.name)}</option>`,
  ).join('');
  if (window.currentUser?.role === 'field_staff') {
    sel.disabled = true;
  }
}

window.openEdit = async function (id) {
  const res = await fetch(`/api/customers/${id}`);
  const record = await res.json();
  if (record.error) {
    alert(record.error);
    return;
  }

  editingRecordId = id;
  editingRecord = record;
  document.getElementById('detailModal').classList.add('hidden');

  await loadFieldConfigForSite(record.site_id);
  populateEditSiteSelect(record.site_id);
  document.querySelector(`input[name="editVisitType"][value="${record.visit_type}"]`)?.click();
  document.querySelector(`input[name="editIsDeal"][value="${record.is_deal ? '1' : '0'}"]`)?.click();

  buildEditForm();
  fillEditFormData(record.data);

  document.getElementById('editModal').classList.remove('hidden');
};

async function saveEdit() {
  if (!editingRecordId) return;
  const data = collectEditFormData();
  if (!data.customerName || !data.phone) {
    alert('請填寫客戶姓名與主要電話');
    return;
  }

  const siteId = document.getElementById('editSite').value;
  const visitType = getEditVisitType();

  try {
    const res = await fetch(`/api/customers/${editingRecordId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        siteId,
        visitType,
        isDeal: getEditIsDeal(),
        data,
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      alert(json.error || '儲存失敗');
      return;
    }
    document.getElementById('editModal').classList.add('hidden');
    editingRecordId = null;
    doSearch();
  } catch {
    alert('儲存失敗，請稍後再試');
  }
}

async function deleteRecord(id) {
  if (!confirm('確定要刪除此筆客戶資料？此操作無法復原。')) return;
  try {
    const res = await fetch(`/api/customers/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (!res.ok) {
      alert(json.error || '刪除失敗');
      return;
    }
    document.getElementById('detailModal').classList.add('hidden');
    document.getElementById('editModal').classList.add('hidden');
    detailRecordId = null;
    editingRecordId = null;
    doSearch();
  } catch {
    alert('刪除失敗，請稍後再試');
  }
}
window.deleteRecord = deleteRecord;

async function requestDeleteCustomers(siteId) {
  const typed = prompt(
    '此操作將刪除客戶資料且無法復原。\n請輸入 DELETE ALL 以確認：',
  );
  if (typed !== 'DELETE ALL') {
    if (typed !== null) alert('確認碼不正確，已取消');
    return;
  }

  const siteName = siteId
    ? (sites.find((s) => s.id === siteId)?.name || '選定案場')
    : '全部案場';
  if (!confirm(`最後確認：將清空「${siteName}」的所有客戶資料？`)) return;

  try {
    const res = await fetch('/api/customers/all', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: 'DELETE ALL', siteId: siteId || undefined }),
    });
    const json = await res.json();
    if (!res.ok) {
      alert(json.error || '清空失敗');
      return;
    }
    alert(`已刪除 ${json.deleted} 筆資料`);
    doSearch();
    return true;
  } catch {
    alert('清空失敗，請稍後再試');
    return false;
  }
}

async function deleteSiteCustomers() {
  const siteId = document.getElementById('deleteSiteSelect').value;
  if (!siteId) {
    alert('請先選擇要清空的案場');
    return;
  }
  await requestDeleteCustomers(siteId);
}

async function deleteAllCustomers() {
  await requestDeleteCustomers('');
}

async function loadFieldConfigForSite(siteId) {
  const url = siteId
    ? `/api/fields?siteId=${encodeURIComponent(siteId)}`
    : '/api/fields';
  const res = await fetch(url);
  fieldConfig = await res.json();
}

async function loadFieldConfig() {
  await loadFieldConfigForSite('');
}

async function exportCSV() {
  const cols = getExportColumns();
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
    'searchRegion', 'searchVisitType', 'searchDeal', 'searchPhone', 'searchName', 'searchStatus'
  ].forEach((id) => { document.getElementById(id).value = ''; });
  ['excludeNew', 'excludeReturn', 'excludeDeal'].forEach((id) => { document.getElementById(id).checked = false; });
  if (!(window.currentUser?.role === 'field_staff' && sites.length === 1)) {
    document.getElementById('searchSite').value = '';
  }
  document.querySelectorAll('[data-date-preset]').forEach((btn) => btn.classList.remove('active'));
  updateSiteLabel();
  currentPage = 1;
  doSearch();
}

function formatDateInput(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function applyDatePreset(preset) {
  const yearEl = document.getElementById('searchYear');
  const startEl = document.getElementById('searchStartDate');
  const endEl = document.getElementById('searchEndDate');
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  document.querySelectorAll('[data-date-preset]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.datePreset === preset);
  });

  if (preset === 'all') {
    yearEl.value = '';
    startEl.value = '';
    endEl.value = '';
    return;
  }

  yearEl.value = '';
  const end = formatDateInput(today);
  const start = new Date(today);
  if (preset === 'day') {
    // 日內：今天
  } else if (preset === 'week') {
    start.setDate(start.getDate() - 6);
  } else if (preset === 'month') {
    start.setDate(1);
  }
  startEl.value = formatDateInput(start);
  endEl.value = end;
}

document.getElementById('searchBtn').addEventListener('click', () => { currentPage = 1; doSearch(); });
document.getElementById('clearSearchBtn').addEventListener('click', clearSearch);
document.getElementById('searchSortOrder')?.addEventListener('change', () => {
  currentPage = 1;
  doSearch();
});
document.querySelectorAll('[data-date-preset]').forEach((btn) => {
  btn.addEventListener('click', () => {
    applyDatePreset(btn.dataset.datePreset);
    currentPage = 1;
    doSearch();
  });
});
document.getElementById('dealPresetBtn').addEventListener('click', () => {
  document.getElementById('searchDeal').value = '1';
  currentPage = 1;
  doSearch();
});
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
document.getElementById('detailEditBtn').addEventListener('click', () => {
  if (detailRecordId) openEdit(detailRecordId);
});
document.getElementById('detailDeleteBtn').addEventListener('click', () => {
  if (detailRecordId) deleteRecord(detailRecordId);
});
document.getElementById('closeEditModal').addEventListener('click', () => {
  document.getElementById('editModal').classList.add('hidden');
});
document.getElementById('cancelEditBtn').addEventListener('click', () => {
  document.getElementById('editModal').classList.add('hidden');
});
document.getElementById('editModal').addEventListener('click', (e) => {
  if (e.target.id === 'editModal') document.getElementById('editModal').classList.add('hidden');
});
document.getElementById('saveEditBtn').addEventListener('click', saveEdit);
document.getElementById('deleteSiteDataBtn').addEventListener('click', deleteSiteCustomers);
document.getElementById('deleteAllBtn').addEventListener('click', deleteAllCustomers);
document.getElementById('editSite').addEventListener('change', async () => {
  const siteId = document.getElementById('editSite').value;
  await loadFieldConfigForSite(siteId);
  const data = editingRecord ? { ...editingRecord.data, ...collectEditFormData() } : collectEditFormData();
  buildEditForm();
  fillEditFormData(data);
});
document.querySelectorAll('input[name="editVisitType"]').forEach((el) => {
  el.addEventListener('change', () => {
    const data = { ...collectEditFormData() };
    buildEditForm();
    fillEditFormData(data);
  });
});

initYearSelect();
renderColumnPicker();
loadFieldConfig();

async function bootSearch() {
  if (window.navReady) await window.navReady;
  await loadSites();
  applyFieldStaffSiteRestrictions();
  const siteId = document.getElementById('searchSite').value;
  await loadSiteExportColumnOrder(siteId);
  updateSiteLabel();
  applyPermissionUI();
  doSearch();
}
bootSearch();
