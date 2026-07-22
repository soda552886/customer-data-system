let sites = [];
let fieldConfig = { sections: [], salesStaff: {} };
let currentSiteId = '';
let currentVisitType = '新客';

const siteSelect = document.getElementById('siteSelect');
const customerForm = document.getElementById('customerForm');
const formSections = document.getElementById('formSections');
const emptyState = document.getElementById('emptyState');
const lookupPanel = document.getElementById('lookupPanel');

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Normalize various date strings to YYYY-MM-DD for <input type="date">. */
function toDateInputValue(raw) {
  if (!raw) return '';
  const s = String(raw).trim().split(/\s+/)[0];

  let m = s.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
  if (m) {
    let year = Number(m[1]);
    if (year < 1911) year += 1911;
    return `${year}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  }

  m = s.match(/^(\d{2,3})[./-](\d{1,2})[./-](\d{1,2})$/);
  if (m) {
    let year = Number(m[1]);
    if (year < 1911) year += 1911;
    return `${year}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  }

  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (m) {
    let year = Number(m[3]);
    if (year < 1911) year += 1911;
    return `${year}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }

  return s;
}

function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast ${type}`;
  setTimeout(() => toast.classList.add('hidden'), 3000);
}

function fieldVisible(field) {
  if (field.showFor && !field.showFor.includes(currentVisitType)) return false;
  if (field.sites && !field.sites.includes(currentSiteId)) return false;
  if (field.hideFor && field.hideFor.includes(currentVisitType)) return false;
  return true;
}

async function loadFieldsForSite(siteId) {
  if (!siteId) {
    fieldConfig = { sections: [], salesStaff: {} };
    return;
  }
  const res = await fetch(`/api/fields?siteId=${encodeURIComponent(siteId)}`);
  fieldConfig = await res.json();
}

function buildForm() {
  formSections.innerHTML = '';

  fieldConfig.sections.forEach((section) => {
    const visibleFields = section.fields.filter(fieldVisible);
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
      label.htmlFor = field.key;
      label.innerHTML = `${field.label}${field.required ? ' <span class="required">*</span>' : ''}`;
      group.appendChild(label);

      let input;
      if (field.type === 'select') {
        let options = field.options || [];
        if (field.dynamicStaff) {
          options = fieldConfig.salesStaff[currentSiteId] || [];
        }
        // 案場尚無下拉選項時改為文字輸入，避免必填下拉無法選擇而無法送出
        if (!options.length) {
          input = document.createElement('input');
          input.type = 'text';
          input.id = field.key;
          input.name = field.key;
          input.placeholder = field.dynamicStaff ? '請輸入銷售人員姓名' : `請輸入${field.label}`;
          if (field.required) input.required = true;
        } else {
          input = document.createElement('select');
          input.id = field.key;
          input.name = field.key;
          if (field.required) input.required = true;
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
        }
      } else if (field.type === 'multiselect') {
        const wrap = document.createElement('div');
        wrap.className = 'checkbox-grid';
        wrap.id = field.key;
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
        grid.appendChild(group);
        return;
      } else if (field.type === 'textarea') {
        input = document.createElement('textarea');
        input.id = field.key;
        input.name = field.key;
        if (field.placeholder) input.placeholder = field.placeholder;
        if (field.required) input.required = true;
        if (field.readOnly) {
          input.readOnly = true;
          input.classList.add('readonly-autofill');
        }
      } else {
        input = document.createElement('input');
        input.type = field.type;
        input.id = field.key;
        input.name = field.key;
        if (field.placeholder) input.placeholder = field.placeholder;
        if (field.required) input.required = true;
        if (field.type === 'date' && field.autoToday) {
          input.value = todayStr();
        }
      }

      group.appendChild(input);
      grid.appendChild(group);
    });

    sectionEl.appendChild(grid);
    formSections.appendChild(sectionEl);
  });

  // 新客：電話離開焦點時檢查是否曾建檔
  const phoneInput = document.getElementById('phone');
  if (phoneInput) {
    phoneInput.addEventListener('blur', () => {
      checkPhoneForNewCustomer(phoneInput.value.trim());
    });
  }

  bindProductFocusUnitSync();
}

function getCheckedValues(fieldKey) {
  return Array.from(document.querySelectorAll(`#${fieldKey} input:checked`)).map((cb) => cb.value);
}

function updateFocusUnitFromProducts() {
  const focusEl = document.getElementById('focusUnit');
  if (!focusEl) return;
  const residential = getCheckedValues('productResidential');
  const office = getCheckedValues('productOffice');
  const line1 = residential.length ? residential.join('、') : '';
  const line2 = office.length ? office.join('、') : '';
  focusEl.value = [line1, line2].join('\n');
}

function bindProductFocusUnitSync() {
  const residentialWrap = document.getElementById('productResidential');
  const officeWrap = document.getElementById('productOffice');
  if (!residentialWrap && !officeWrap) return;

  residentialWrap?.querySelectorAll('input').forEach((cb) => {
    cb.addEventListener('change', updateFocusUnitFromProducts);
  });
  officeWrap?.querySelectorAll('input').forEach((cb) => {
    cb.addEventListener('change', updateFocusUnitFromProducts);
  });
  updateFocusUnitFromProducts();
}

function updateUI() {
  const hasSite = !!currentSiteId;
  customerForm.classList.toggle('hidden', !hasSite);
  emptyState.classList.toggle('hidden', hasSite);
  lookupPanel.classList.toggle('hidden', !hasSite || currentVisitType !== '回訪');
  if (currentVisitType !== '新客') hidePhoneHistoryPanel();

  if (hasSite) {
    buildForm();
  }
}

async function onSiteChange() {
  currentSiteId = siteSelect.value;
  await loadFieldsForSite(currentSiteId);
  updateUI();
}

function getVisitType() {
  return document.querySelector('input[name="visitType"]:checked')?.value || '新客';
}

function getIsDeal() {
  return document.querySelector('input[name="isDeal"]:checked')?.value === '1';
}

function collectFormData() {
  updateFocusUnitFromProducts();
  const data = {};
  fieldConfig.sections.forEach((section) => {
    section.fields.filter(fieldVisible).forEach((field) => {
      if (field.type === 'multiselect') {
        const checked = document.querySelectorAll(`#${field.key} input:checked`);
        data[field.key] = Array.from(checked).map((cb) => cb.value);
      } else {
        const el = document.getElementById(field.key);
        if (el) data[field.key] = el.value;
      }
    });
  });
  return data;
}

function fillFormData(data) {
  fieldConfig.sections.forEach((section) => {
    section.fields.filter(fieldVisible).forEach((field) => {
      const val = data[field.key];
      if (val === undefined || val === null || val === '') return;

      if (field.type === 'multiselect') {
        let values = [];
        if (Array.isArray(val)) {
          values = val;
        } else if (typeof val === 'string') {
          // 舊資料若為文字，盡量拆成選項勾選
          values = val.split(/[\n、,，;；]+/).map((s) => s.trim()).filter(Boolean);
        }
        values.forEach((v) => {
          const cb = document.querySelector(`#${field.key} input[value="${CSS.escape(v)}"]`);
          if (cb) cb.checked = true;
        });
      } else {
        const el = document.getElementById(field.key);
        if (!el) return;
        ensureSelectHasOption(el, val, field.dynamicStaff ? '（原銷售／已離職）' : '');
        el.value = val;
      }
    });
  });
  updateFocusUnitFromProducts();
}

/** Ensure a <select> can display a value not in current options (e.g. former salesperson). */
function ensureSelectHasOption(el, value, suffix = '') {
  if (!el || el.tagName !== 'SELECT' || value === undefined || value === null || value === '') return;
  const exists = Array.from(el.options).some((o) => o.value === String(value));
  if (exists) return;
  const opt = document.createElement('option');
  opt.value = String(value);
  opt.textContent = suffix ? `${value}${suffix}` : String(value);
  el.appendChild(opt);
}

function summarizeRecord(rec) {
  const staff = [rec.salesperson1, rec.salesperson2].filter(Boolean).join('、') || '未填銷售';
  const date = toDateInputValue(rec.visitDate || rec.visit_date || '') || '日期未建檔';
  const name = rec.customerName || '（未填姓名）';
  return { date, staff, name, type: rec.visitType || '' };
}

function applyLookupRecord(record, phone) {
  const d = (record && record.data) || {};
  fillFormData(d);

  const firstVisitRaw = (
    d.firstVisitDate || d.visitDate || record.first_visit_date || record.visit_date || ''
  );
  const firstVisit = toDateInputValue(firstVisitRaw);
  const firstEl = document.getElementById('firstVisitDate');
  if (firstEl && firstVisit) firstEl.value = firstVisit;

  if (d.customerName) {
    const nameEl = document.getElementById('customerName');
    if (nameEl) nameEl.value = d.customerName;
  }
  const phoneEl = document.getElementById('phone');
  if (phoneEl) phoneEl.value = d.phone || phone;

  if (currentVisitType === '回訪') {
    const returnEl = document.getElementById('returnVisitDate');
    if (returnEl) returnEl.value = todayStr();
  }
}

function renderHistoryList(records, phone, { selectable = false } = {}) {
  return `<ul class="lookup-history-list">${records.map((rec, idx) => {
    const s = summarizeRecord(rec);
    const btn = selectable
      ? `<button type="button" class="btn-sm" data-apply-record="${idx}">帶入此筆</button>`
      : '';
    return `<li class="lookup-history-item">
      <strong>${escapeHtml(s.date)}</strong>
      <span>${escapeHtml(s.type)}</span>
      <span>${escapeHtml(s.name)}</span>
      <span>銷售：${escapeHtml(s.staff)}</span>
      ${btn}
    </li>`;
  }).join('')}</ul>`;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function fetchPhoneHistory(phone, siteId) {
  if (!phone || !siteId) return null;
  const res = await fetch(
    `/api/customers/lookup?phone=${encodeURIComponent(phone)}&siteId=${encodeURIComponent(siteId)}`,
  );
  if (!res.ok) return null;
  return res.json();
}

function hidePhoneHistoryPanel() {
  const panel = document.getElementById('phoneHistoryPanel');
  if (panel) panel.classList.add('hidden');
}

function showPhoneHistoryWarning(json) {
  const panel = document.getElementById('phoneHistoryPanel');
  const box = document.getElementById('phoneHistoryResult');
  if (!panel || !box) return;
  if (!json || !json.found || !json.records?.length) {
    panel.classList.add('hidden');
    return;
  }
  const records = json.records;
  box.className = 'lookup-result warning';
  box.innerHTML = `
    <strong>此電話在本案場已有 ${records.length} 筆客資</strong>
    <p class="hint" style="margin:0.35rem 0 0;">可能曾由其他銷售接待。若客戶未表示來過，仍建議先確認是否應改填「回訪」。</p>
    ${renderHistoryList(records)}
  `;
  panel.classList.remove('hidden');
}

async function checkPhoneForNewCustomer(phone) {
  if (currentVisitType !== '新客' || !currentSiteId || !phone) {
    hidePhoneHistoryPanel();
    return null;
  }
  try {
    const json = await fetchPhoneHistory(phone, currentSiteId);
    showPhoneHistoryWarning(json);
    return json;
  } catch {
    hidePhoneHistoryPanel();
    return null;
  }
}

async function lookupCustomer() {
  const phone = document.getElementById('lookupPhone').value.trim();
  const resultEl = document.getElementById('lookupResult');
  if (!phone) {
    resultEl.className = 'lookup-result error';
    resultEl.textContent = '請輸入電話號碼';
    resultEl.classList.remove('hidden');
    return;
  }

  try {
    const json = await fetchPhoneHistory(phone, currentSiteId);
    resultEl.classList.remove('hidden');

    if (json && json.found && json.records?.length) {
      const records = json.records;
      window._lookupRecords = records;
      applyLookupRecord(json.record || records[0], phone);

      const primary = summarizeRecord(json.record || records[0]);
      resultEl.className = 'lookup-result success';
      resultEl.innerHTML = `
        <strong>找到 ${records.length} 筆來訪紀錄</strong>
        <p style="margin:0.35rem 0 0;">已預設帶入最早${primary.type === '新客' ? '初訪' : ''}資料：${escapeHtml(primary.name)}（${escapeHtml(primary.date)}，銷售：${escapeHtml(primary.staff)}）</p>
        ${records.length > 1 ? `<p class="hint" style="margin:0.35rem 0 0;">以下列出全部紀錄（含不同銷售），可點「帶入此筆」切換：</p>${renderHistoryList(records, phone, { selectable: true })}` : ''}
      `;

      resultEl.querySelectorAll('[data-apply-record]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const rec = records[Number(btn.dataset.applyRecord)];
          if (!rec) return;
          applyLookupRecord(rec, phone);
          showToast(`已帶入：${summarizeRecord(rec).date}／${summarizeRecord(rec).staff}`);
        });
      });
    } else {
      window._lookupRecords = [];
      resultEl.className = 'lookup-result error';
      resultEl.textContent = '找不到此電話的來訪紀錄，請確認案場與電話是否正確';
    }
  } catch {
    resultEl.className = 'lookup-result error';
    resultEl.textContent = '檢索失敗，請稍後再試';
    resultEl.classList.remove('hidden');
  }
}

async function submitForm(e) {
  e.preventDefault();
  const site = sites.find((s) => s.id === currentSiteId);
  const data = collectFormData();

  if (!data.customerName || !data.phone) {
    showToast('請填寫客戶姓名與電話', 'error');
    return;
  }

  // 世界都心：產品需求住宅／事務所至少各勾一項（可選「不考慮」）
  if (document.getElementById('productResidential') || document.getElementById('productOffice')) {
    const res = data.productResidential || [];
    const off = data.productOffice || [];
    if (!res.length || !off.length) {
      showToast('請勾選產品需求－住宅與事務所（不考慮也請勾選）', 'error');
      return;
    }
  }

  if (currentVisitType === '新客' && !data.visitDate) {
    data.visitDate = todayStr();
  }
  if (currentVisitType === '回訪' && !data.returnVisitDate) {
    data.returnVisitDate = todayStr();
  }

  // 新客儲存前檢查：同一案場是否已有此電話客資
  if (currentVisitType === '新客') {
    const history = await checkPhoneForNewCustomer(data.phone);
    if (history && history.found && history.records?.length) {
      const lines = history.records.map((rec) => {
        const s = summarizeRecord(rec);
        return `・${s.date} ${s.type} 銷售：${s.staff}（${s.name}）`;
      }).join('\n');
      const ok = confirm(
        `此電話在「${site?.name || '本案場'}」已有 ${history.records.length} 筆客資：\n\n${lines}\n\n`
        + '可能是其他銷售曾接待過。確定仍要以「新客」儲存？\n'
        + '（若客戶其實來過，建議改選「回訪」）',
      );
      if (!ok) {
        showToast('已取消儲存，請確認客戶類型', 'error');
        return;
      }
    }
  }

  try {
    const res = await fetch('/api/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        siteId: currentSiteId,
        siteName: site?.name,
        visitType: currentVisitType,
        isDeal: getIsDeal(),
        data,
      }),
    });
    const json = await res.json();
    if (json.success) {
      showToast('客戶資料已成功儲存！');
      customerForm.reset();
      buildForm();
      document.getElementById('lookupResult')?.classList.add('hidden');
      hidePhoneHistoryPanel();
    } else {
      showToast(json.error || '儲存失敗', 'error');
    }
  } catch {
    showToast('儲存失敗，請稍後再試', 'error');
  }
}

async function init() {
  if (window.navReady) await window.navReady;

  const [sitesRes] = await Promise.all([
    fetch('/api/sites'),
  ]);
  sites = await sitesRes.json();

  sites.forEach((s) => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.name;
    siteSelect.appendChild(opt);
  });

  if (window.currentUser?.role === 'field_staff') {
    if (sites.length === 1) {
      siteSelect.value = sites[0].id;
      siteSelect.disabled = true;
      currentSiteId = sites[0].id;
    } else if (sites.length === 0) {
      showToast('尚未指派案場，請聯絡管理員', 'error');
    }
  }

  if (currentSiteId) {
    await loadFieldsForSite(currentSiteId);
    updateUI();
  }

  siteSelect.addEventListener('change', onSiteChange);

  document.querySelectorAll('input[name="visitType"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      currentVisitType = getVisitType();
      updateUI();
    });
  });

  document.getElementById('lookupBtn').addEventListener('click', lookupCustomer);
  document.getElementById('lookupPhone').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); lookupCustomer(); }
  });

  customerForm.addEventListener('submit', submitForm);

  document.getElementById('resetBtn').addEventListener('click', () => {
    customerForm.reset();
    buildForm();
    document.getElementById('lookupResult')?.classList.add('hidden');
    hidePhoneHistoryPanel();
  });
}

init();
