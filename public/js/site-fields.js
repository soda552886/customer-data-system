const params = new URLSearchParams(window.location.search);
const siteId = params.get('site') || '';

let fieldItems = [];
let exportColumns = [];
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
    container.innerHTML = '<p class="empty-row">此案場沒有可設定的下拉選項欄位</p>';
    return;
  }

  const grouped = groupBySection(fieldItems);
  container.innerHTML = Array.from(grouped.entries()).map(([sectionTitle, fields]) => `
    <section class="field-options-section">
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

function updateExportCount() {
  const label = document.getElementById('exportCountLabel');
  if (!label) return;
  const enabled = exportColumns.filter((c) => c.enabled).length;
  label.textContent = `已勾選 ${enabled} / ${exportColumns.length} 個欄位`;
}

function renderOrder() {
  const container = document.getElementById('orderContainer');
  if (!exportColumns.length) {
    container.innerHTML = '<p class="empty-row">沒有可設定的報表欄位</p>';
    return;
  }

  container.innerHTML = `
    <ul class="field-order-list">
      ${exportColumns.map((col, idx) => `
        <li class="field-order-item" data-col-key="${escapeHtml(col.key)}">
          <label class="checkbox-label field-order-check">
            <input type="checkbox" data-export-key="${escapeHtml(col.key)}" ${col.enabled ? 'checked' : ''}>
          </label>
          <span>
            ${escapeHtml(col.label)}
            <span class="hint">（${escapeHtml(col.group)}）</span>
          </span>
          <span class="field-order-actions">
            <button type="button" class="btn-sm" data-move="up" data-idx="${idx}" ${idx === 0 ? 'disabled' : ''}>上移</button>
            <button type="button" class="btn-sm" data-move="down" data-idx="${idx}" ${idx === exportColumns.length - 1 ? 'disabled' : ''}>下移</button>
          </span>
        </li>
      `).join('')}
    </ul>
  `;

  container.querySelectorAll('[data-move]').forEach((btn) => {
    btn.addEventListener('click', () => {
      moveColumn(Number(btn.dataset.idx), btn.dataset.move);
    });
  });
  container.querySelectorAll('[data-export-key]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const col = exportColumns.find((c) => c.key === cb.dataset.exportKey);
      if (col) col.enabled = cb.checked;
      updateExportCount();
    });
  });
  updateExportCount();
}

function moveColumn(idx, direction) {
  const target = direction === 'up' ? idx - 1 : idx + 1;
  if (target < 0 || target >= exportColumns.length) return;
  [exportColumns[idx], exportColumns[target]] = [exportColumns[target], exportColumns[idx]];
  renderOrder();
}

function toggleAllExportColumns(enabled) {
  exportColumns.forEach((col) => { col.enabled = enabled; });
  renderOrder();
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

function collectOptionsPayload() {
  const payload = {};
  fieldItems.forEach((field) => {
    const boxes = document.querySelectorAll(`#fieldsContainer input[data-field-key="${CSS.escape(field.key)}"]`);
    const selected = Array.from(boxes).filter((cb) => cb.checked).map((cb) => cb.value);
    if (selected.length && selected.length < field.allOptions.length) {
      payload[field.key] = selected;
    }
  });
  return payload;
}

function collectExportPayload() {
  return {
    items: exportColumns.map((col) => ({ key: col.key, enabled: !!col.enabled })),
  };
}

function applyExportConfig(config) {
  exportColumns = (config && config.columns) ? config.columns.map((col) => ({ ...col })) : [];
}

async function loadConfig() {
  if (!siteId) {
    document.getElementById('fieldsContainer').innerHTML =
      '<p class="empty-row">缺少案場參數，請從欄位選項頁進入</p>';
    return;
  }

  const res = await fetch(`/api/sites/${encodeURIComponent(siteId)}/field-options`);
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    const msg = escapeHtml(json.error || '載入失敗');
    document.getElementById('fieldsContainer').innerHTML = `<p class="empty-row">${msg}</p>`;
    return;
  }

  const json = await res.json();
  siteName = json.siteName || siteId;
  fieldItems = json.fields || [];
  applyExportConfig(json.reportExport);
  document.getElementById('pageTitle').textContent = `案場欄位設定：${siteName}`;
  renderFields();
  renderOrder();
}

async function saveOptions() {
  const btn = document.getElementById('saveOptionsBtn');
  btn.disabled = true;
  try {
    const res = await fetch(`/api/sites/${encodeURIComponent(siteId)}/field-options`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ options: collectOptionsPayload() }),
    });
    const json = await res.json();
    if (!res.ok) {
      showToast(json.error || '儲存失敗', 'error');
      return;
    }
    fieldItems = json.fields || fieldItems;
    if (json.reportExport) applyExportConfig(json.reportExport);
    renderFields();
    showToast('欄位選項已儲存');
  } catch {
    showToast('儲存失敗', 'error');
  } finally {
    btn.disabled = false;
  }
}

async function saveOrder() {
  const btn = document.getElementById('saveOrderBtn');
  const enabledCount = exportColumns.filter((c) => c.enabled).length;
  if (enabledCount === 0) {
    showToast('請至少勾選一個要匯出的欄位', 'error');
    return;
  }
  btn.disabled = true;
  try {
    const res = await fetch(`/api/sites/${encodeURIComponent(siteId)}/field-order`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(collectExportPayload()),
    });
    const json = await res.json();
    if (!res.ok) {
      showToast(json.error || '儲存失敗', 'error');
      return;
    }
    applyExportConfig(json);
    renderOrder();
    showToast('報表匯出設定已儲存');
  } catch {
    showToast('儲存失敗', 'error');
  } finally {
    btn.disabled = false;
  }
}

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.add('hidden'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab === 'options' ? 'panelOptions' : 'panelOrder').classList.remove('hidden');
  });
});

document.getElementById('saveOptionsBtn').addEventListener('click', saveOptions);
document.getElementById('saveOrderBtn').addEventListener('click', saveOrder);
document.getElementById('expandAllBtn').addEventListener('click', () => {
  document.querySelectorAll('#fieldsContainer .field-options-section details').forEach((el) => { el.open = true; });
});
document.getElementById('collapseAllBtn').addEventListener('click', () => {
  document.querySelectorAll('#fieldsContainer .field-options-section details').forEach((el) => { el.open = false; });
});
document.getElementById('resetAllBtn').addEventListener('click', async () => {
  if (!confirm('確定恢復全部欄位為系統預設選項？')) return;
  fieldItems.forEach((field) => {
    field.enabledOptions = [...field.allOptions];
  });
  renderFields();
  await saveOptions();
});
document.getElementById('selectAllExportBtn').addEventListener('click', () => toggleAllExportColumns(true));
document.getElementById('selectNoneExportBtn').addEventListener('click', () => toggleAllExportColumns(false));
document.getElementById('resetOrderBtn').addEventListener('click', async () => {
  if (!confirm('確定恢復為系統預設的匯出欄位與順序？')) return;
  const res = await fetch(`/api/sites/${encodeURIComponent(siteId)}/field-order`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: [] }),
  });
  const json = await res.json();
  if (res.ok) {
    applyExportConfig(json);
    renderOrder();
    showToast('已恢復預設匯出設定');
  } else {
    showToast(json.error || '恢復失敗', 'error');
  }
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
