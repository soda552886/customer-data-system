const params = new URLSearchParams(window.location.search);
const siteId = params.get('site') || '';

let fieldItems = [];
let exportColumns = [];
let visibilityFields = [];
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
  container.querySelectorAll('[data-add-option]').forEach((btn) => {
    btn.addEventListener('click', () => addCustomOption(btn.dataset.addOption));
  });
  container.querySelectorAll('[data-remove-option]').forEach((btn) => {
    btn.addEventListener('click', () => {
      removeCustomOption(btn.dataset.fieldKey, btn.dataset.removeOption);
    });
  });
}

function isCustomOption(field, opt) {
  const defaults = field.defaultOptions || [];
  return !defaults.includes(opt);
}

function renderFieldCard(field) {
  if (!field.defaultOptions) field.defaultOptions = [...(field.allOptions || [])];
  const enabled = new Set(field.enabledOptions || []);
  const total = field.allOptions.length;
  const count = enabled.size;
  const checks = field.allOptions.map((opt) => {
    const custom = isCustomOption(field, opt);
    return `
    <label class="checkbox-label${custom ? ' option-custom' : ''}">
      <input type="checkbox" data-field-key="${escapeHtml(field.key)}" value="${escapeHtml(opt)}" ${enabled.has(opt) ? 'checked' : ''}>
      ${escapeHtml(opt)}${custom ? ' <span class="hint">自訂</span>' : ''}
      ${custom ? `<button type="button" class="btn-xs link-btn" data-field-key="${escapeHtml(field.key)}" data-remove-option="${escapeHtml(opt)}" title="移除自訂選項">✕</button>` : ''}
    </label>
  `;
  }).join('');

  return `
    <div class="field-options-card" data-field-key="${escapeHtml(field.key)}">
      <div class="field-options-card-head">
        <strong>${escapeHtml(field.label)}</strong>
        <span class="hint field-options-count" data-count-for="${escapeHtml(field.key)}">${count} / ${total} 項</span>
        <button type="button" class="btn-sm" data-add-option="${escapeHtml(field.key)}">新增選項</button>
        <button type="button" class="btn-sm" data-select-all="${escapeHtml(field.key)}">全選</button>
        <button type="button" class="btn-sm" data-select-none="${escapeHtml(field.key)}">全不選</button>
      </div>
      <div class="checkbox-grid field-options-grid">${checks || '<p class="hint">尚無選項，請按「新增選項」</p>'}</div>
    </div>
  `;
}

function addCustomOption(fieldKey) {
  const field = fieldItems.find((f) => f.key === fieldKey);
  if (!field) return;
  const raw = window.prompt(`為「${field.label}」新增選項：`);
  if (raw === null) return;
  const value = raw.trim();
  if (!value) {
    showToast('請輸入選項名稱', 'error');
    return;
  }
  if (!field.defaultOptions) field.defaultOptions = [];
  if (!field.allOptions) field.allOptions = [...field.defaultOptions];
  if (!field.enabledOptions) field.enabledOptions = [...field.allOptions];
  if (field.allOptions.includes(value)) {
    showToast('此選項已存在', 'error');
    return;
  }
  field.allOptions.push(value);
  field.enabledOptions.push(value);
  renderFields();
  showToast(`已新增「${value}」，請記得按「儲存選項」`);
}

function removeCustomOption(fieldKey, optionValue) {
  const field = fieldItems.find((f) => f.key === fieldKey);
  if (!field) return;
  if (!isCustomOption(field, optionValue)) return;
  field.allOptions = (field.allOptions || []).filter((o) => o !== optionValue);
  field.enabledOptions = (field.enabledOptions || []).filter((o) => o !== optionValue);
  renderFields();
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
        <li class="field-order-item" draggable="true" data-col-key="${escapeHtml(col.key)}" data-idx="${idx}">
          <span class="drag-handle" title="拖曳排序" aria-hidden="true">⋮⋮</span>
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
  bindExportDragDrop(container);
  updateExportCount();
}

function bindExportDragDrop(container) {
  let dragIdx = null;
  container.querySelectorAll('.field-order-item').forEach((item) => {
    item.addEventListener('dragstart', (e) => {
      dragIdx = Number(item.dataset.idx);
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(dragIdx));
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      container.querySelectorAll('.field-order-item').forEach((el) => el.classList.remove('drag-over'));
      dragIdx = null;
    });
    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      item.classList.add('drag-over');
    });
    item.addEventListener('dragleave', () => {
      item.classList.remove('drag-over');
    });
    item.addEventListener('drop', (e) => {
      e.preventDefault();
      item.classList.remove('drag-over');
      const from = dragIdx != null ? dragIdx : Number(e.dataTransfer.getData('text/plain'));
      const to = Number(item.dataset.idx);
      if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) return;
      const [moved] = exportColumns.splice(from, 1);
      exportColumns.splice(to, 0, moved);
      renderOrder();
    });
  });
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
    const defaults = field.defaultOptions || [];
    if (!selected.length) return;
    const sameAsDefaults = (
      selected.length === defaults.length
      && selected.every((s) => defaults.includes(s))
      && defaults.every((d) => selected.includes(d))
    );
    if (!sameAsDefaults) {
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

function applyVisibilityConfig(config) {
  visibilityFields = (config && config.fields)
    ? config.fields.map((f) => ({ ...f }))
    : [];
}

function updateVisibilityCount() {
  const label = document.getElementById('visibilityCountLabel');
  if (!label) return;
  const shown = visibilityFields.filter((f) => f.visible).length;
  label.textContent = `顯示 ${shown} / ${visibilityFields.length} 個欄位`;
}

function renderVisibility() {
  const container = document.getElementById('visibilityContainer');
  if (!visibilityFields.length) {
    container.innerHTML = '<p class="empty-row">沒有可設定的表單欄位</p>';
    return;
  }
  const grouped = groupBySection(visibilityFields);
  container.innerHTML = Array.from(grouped.entries()).map(([sectionTitle, fields]) => `
    <section class="field-options-section">
      <h3 class="field-options-summary">${escapeHtml(sectionTitle)}</h3>
      <ul class="field-visibility-list">
        ${fields.map((field) => `
          <li class="field-visibility-item">
            <label class="checkbox-label">
              <input type="checkbox"
                data-visibility-key="${escapeHtml(field.key)}"
                ${field.visible ? 'checked' : ''}
                ${field.locked ? 'disabled' : ''}>
              ${escapeHtml(field.label)}
              ${field.required ? '<span class="hint">必填</span>' : ''}
              ${field.locked ? '<span class="hint">（不可隱藏）</span>' : ''}
            </label>
          </li>
        `).join('')}
      </ul>
    </section>
  `).join('');

  container.querySelectorAll('[data-visibility-key]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const field = visibilityFields.find((f) => f.key === cb.dataset.visibilityKey);
      if (field && !field.locked) {
        field.visible = cb.checked;
        updateVisibilityCount();
      }
    });
  });
  updateVisibilityCount();
}

function collectHiddenFieldsPayload() {
  return visibilityFields.filter((f) => !f.visible && !f.locked).map((f) => f.key);
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
  applyVisibilityConfig(json.fieldVisibility);
  document.getElementById('pageTitle').textContent = `案場欄位設定：${siteName}`;
  renderFields();
  renderVisibility();
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
    if (json.fieldVisibility) applyVisibilityConfig(json.fieldVisibility);
    renderFields();
    renderVisibility();
    showToast('欄位選項已儲存');
  } catch {
    showToast('儲存失敗', 'error');
  } finally {
    btn.disabled = false;
  }
}

async function saveVisibility() {
  const btn = document.getElementById('saveVisibilityBtn');
  btn.disabled = true;
  try {
    const res = await fetch(`/api/sites/${encodeURIComponent(siteId)}/field-options`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hiddenFields: collectHiddenFieldsPayload() }),
    });
    const json = await res.json();
    if (!res.ok) {
      showToast(json.error || '儲存失敗', 'error');
      return;
    }
    if (json.fieldVisibility) applyVisibilityConfig(json.fieldVisibility);
    renderVisibility();
    showToast('欄位顯示設定已儲存');
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
    const map = {
      options: 'panelOptions',
      visibility: 'panelVisibility',
      order: 'panelOrder',
    };
    document.getElementById(map[btn.dataset.tab] || 'panelOptions').classList.remove('hidden');
  });
});

document.getElementById('saveOptionsBtn').addEventListener('click', saveOptions);
document.getElementById('saveVisibilityBtn').addEventListener('click', saveVisibility);
document.getElementById('saveOrderBtn').addEventListener('click', saveOrder);
document.getElementById('expandAllBtn').addEventListener('click', () => {
  document.querySelectorAll('#fieldsContainer .field-options-section details').forEach((el) => { el.open = true; });
});
document.getElementById('collapseAllBtn').addEventListener('click', () => {
  document.querySelectorAll('#fieldsContainer .field-options-section details').forEach((el) => { el.open = false; });
});
document.getElementById('resetAllBtn').addEventListener('click', async () => {
  if (!confirm('確定恢復全部欄位為系統預設選項？（自訂選項也會清除）')) return;
  fieldItems.forEach((field) => {
    const defaults = field.defaultOptions || field.allOptions || [];
    field.defaultOptions = [...defaults];
    field.allOptions = [...defaults];
    field.enabledOptions = [...defaults];
  });
  renderFields();
  await saveOptions();
});
document.getElementById('showAllFieldsBtn').addEventListener('click', () => {
  visibilityFields.forEach((f) => { f.visible = true; });
  renderVisibility();
});
document.getElementById('resetVisibilityBtn').addEventListener('click', async () => {
  if (!confirm('確定恢復為全部欄位都顯示？')) return;
  visibilityFields.forEach((f) => { f.visible = true; });
  renderVisibility();
  await saveVisibility();
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
