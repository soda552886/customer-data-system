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
}

function updateUI() {
  const hasSite = !!currentSiteId;
  customerForm.classList.toggle('hidden', !hasSite);
  emptyState.classList.toggle('hidden', hasSite);
  lookupPanel.classList.toggle('hidden', !hasSite || currentVisitType !== '回訪');

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
      if (val === undefined || val === null) return;

      if (field.type === 'multiselect' && Array.isArray(val)) {
        val.forEach((v) => {
          const cb = document.querySelector(`#${field.key} input[value="${CSS.escape(v)}"]`);
          if (cb) cb.checked = true;
        });
      } else {
        const el = document.getElementById(field.key);
        if (el) el.value = val;
      }
    });
  });
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
    const res = await fetch(`/api/customers/lookup?phone=${encodeURIComponent(phone)}&siteId=${currentSiteId}`);
    const json = await res.json();
    resultEl.classList.remove('hidden');

    if (json.found) {
      const d = json.record.data;
      fillFormData(d);
      if (d.visitDate) {
        const firstEl = document.getElementById('firstVisitDate');
        if (firstEl) firstEl.value = d.visitDate;
      }
      if (d.customerName) {
        const nameEl = document.getElementById('customerName');
        if (nameEl) nameEl.value = d.customerName;
      }
      const phoneEl = document.getElementById('phone');
      if (phoneEl) phoneEl.value = d.phone || phone;

      const returnEl = document.getElementById('returnVisitDate');
      if (returnEl) returnEl.value = todayStr();

      resultEl.className = 'lookup-result success';
      resultEl.textContent = `已找到初訪資料：${d.customerName || ''}（${d.visitDate || ''}），已自動帶入客況`;
    } else {
      resultEl.className = 'lookup-result error';
      resultEl.textContent = '找不到此電話的初訪紀錄，請確認案場與電話是否正確';
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

  if (currentVisitType === '新客' && !data.visitDate) {
    data.visitDate = todayStr();
  }
  if (currentVisitType === '回訪' && !data.returnVisitDate) {
    data.returnVisitDate = todayStr();
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
  });
}

init();
