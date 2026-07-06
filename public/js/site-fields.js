const params = new URLSearchParams(window.location.search);
const siteId = params.get('site') || '';

let fieldItems = [];
let siteName = '';

function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast ${type}`;
  setTimeout(() => toast.classList.add('hidden'), 3500);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function groupBySection(fields) {
  const map = new Map();
  fields.forEach((field) => {
    const title = field.sectionTitle || '其他';
    if (!map.has(title)) map.set(title, []);
    map.get(title).push(field);
  });
  return map;
}

function renderFields() {
  const container = document.getElementById('fieldsContainer');
  if (!fieldItems.length) {
    container.innerHTML = '<section class="card"><p class="empty-row">此案場沒有可設定的下拉選項欄位</p></section>';
    return;
  }

  const grouped = groupBySection(fieldItems);
  container.innerHTML = Array.from(grouped.entries()).map(([sectionTitle, fields]) => `
    <section class="card field-options-section">
      <details open>
        <summary class="field-options-summary">${escapeHtml(sectionTitle)}</summary>
        ${fields.map((field) => renderFieldCard(field)).join('')}
      </details>
    </section>
  `).join('');

  container.querySelectorAll('[data-select-all]').forEach((btn) => {
    btn.addEventListener('click', () => toggleFieldOptions(btn.dataset.selectAll, true));
  });
  container.querySelectorAll('[data-select-none]').forEach((btn) => {
    btn.addEventListener('click', () => toggleFieldOptions(btn.dataset.selectNone, false));
  });
}

function renderFieldCard(field) {
  const enabled = new Set(field.enabledOptions || []);
  const total = field.allOptions.length;
  const count = enabled.size;
  const checks = field.allOptions.map((opt) => `
    <label class="checkbox-label">
      <input type="checkbox" data-field-key="${escapeHtml(field.key)}" value="${escapeHtml(opt)}" ${enabled.has(opt) ? 'checked' : ''}>
      ${escapeHtml(opt)}
    </label>
  `).join('');

  return `
    <div class="field-options-card" data-field-key="${escapeHtml(field.key)}">
      <div class="field-options-card-head">
        <strong>${escapeHtml(field.label)}</strong>
        <span class="hint field-options-count" data-count-for="${escapeHtml(field.key)}">${count} / ${total} 項</span>
        <button type="button" class="btn-sm" data-select-all="${escapeHtml(field.key)}">全選</button>
        <button type="button" class="btn-sm" data-select-none="${escapeHtml(field.key)}">全不選</button>
      </div>
      <div class="checkbox-grid field-options-grid">${checks}</div>
    </div>
  `;
}

function updateFieldCount(fieldKey) {
  const boxes = document.querySelectorAll(`input[data-field-key="${CSS.escape(fieldKey)}"]`);
  const checked = Array.from(boxes).filter((cb) => cb.checked).length;
  const label = document.querySelector(`[data-count-for="${CSS.escape(fieldKey)}"]`);
  if (label) label.textContent = `${checked} / ${boxes.length} 項`;
}

function toggleFieldOptions(fieldKey, checked) {
  document.querySelectorAll(`input[data-field-key="${CSS.escape(fieldKey)}"]`).forEach((cb) => {
    cb.checked = checked;
  });
  updateFieldCount(fieldKey);
}

function collectPayload() {
  const payload = {};
  fieldItems.forEach((field) => {
    const boxes = document.querySelectorAll(`input[data-field-key="${CSS.escape(field.key)}"]`);
    const selected = Array.from(boxes).filter((cb) => cb.checked).map((cb) => cb.value);
    if (selected.length && selected.length < field.allOptions.length) {
      payload[field.key] = selected;
    }
  });
  return payload;
}

async function loadConfig() {
  if (!siteId) {
    document.getElementById('fieldsContainer').innerHTML =
      '<section class="card"><p class="empty-row">缺少案場參數，請從案場管理進入</p></section>';
    return;
  }

  const res = await fetch(`/api/sites/${encodeURIComponent(siteId)}/field-options`);
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    document.getElementById('fieldsContainer').innerHTML =
      `<section class="card"><p class="empty-row">${escapeHtml(json.error || '載入失敗')}</p></section>`;
    return;
  }

  const json = await res.json();
  siteName = json.siteName || siteId;
  fieldItems = json.fields || [];
  document.getElementById('pageTitle').textContent = `欄位選項設定：${siteName}`;
  renderFields();
}

async function saveConfig() {
  const payload = collectPayload();
  const btn = document.getElementById('saveBtn');
  btn.disabled = true;
  try {
    const res = await fetch(`/api/sites/${encodeURIComponent(siteId)}/field-options`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ options: payload }),
    });
    const json = await res.json();
    if (!res.ok) {
      showToast(json.error || '儲存失敗', 'error');
      return;
    }
    fieldItems = json.fields || fieldItems;
    renderFields();
    showToast('欄位選項已儲存');
  } catch {
    showToast('儲存失敗', 'error');
  } finally {
    btn.disabled = false;
  }
}

document.getElementById('saveBtn').addEventListener('click', saveConfig);
document.getElementById('expandAllBtn').addEventListener('click', () => {
  document.querySelectorAll('.field-options-section details').forEach((el) => { el.open = true; });
});
document.getElementById('collapseAllBtn').addEventListener('click', () => {
  document.querySelectorAll('.field-options-section details').forEach((el) => { el.open = false; });
});
document.getElementById('resetAllBtn').addEventListener('click', async () => {
  if (!confirm('確定恢復全部欄位為系統預設選項？')) return;
  fieldItems.forEach((field) => {
    field.enabledOptions = [...field.allOptions];
  });
  renderFields();
  await saveConfig();
});

document.getElementById('fieldsContainer').addEventListener('change', (e) => {
  if (e.target.matches('input[data-field-key]')) {
    updateFieldCount(e.target.dataset.fieldKey);
  }
});

async function boot() {
  if (window.navReady) await window.navReady;
  await loadConfig();
}
boot();
