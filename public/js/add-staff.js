const ADD_STAFF_VALUE = '__add_staff__';

async function persistSalesStaffName(siteId, name) {
  const res = await fetch(`/api/sites/${encodeURIComponent(siteId)}/sales-staff`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  let json = {};
  try { json = await res.json(); } catch { /* ignore */ }
  return { ok: res.ok, status: res.status, json };
}

async function promptNewSalesStaff(siteId) {
  const raw = window.prompt('新增銷售人員姓名：');
  if (raw === null) return null;
  const name = String(raw).trim();
  if (!name || name === ADD_STAFF_VALUE) {
    if (typeof showToast === 'function') showToast('請輸入姓名', 'error');
    return null;
  }
  if (siteId) {
    try {
      const { ok, json } = await persistSalesStaffName(siteId, name);
      if (ok) {
        return { name, persisted: true, activeStaff: json.activeStaff || [name] };
      }
    } catch { /* use locally */ }
  }
  return { name, persisted: false };
}

function appendAddStaffOption(selectEl) {
  if (!selectEl || selectEl.tagName !== 'SELECT') return;
  if ([...selectEl.options].some((o) => o.value === ADD_STAFF_VALUE)) return;
  selectEl.appendChild(new Option('＋ 新增人員…', ADD_STAFF_VALUE));
}

function insertStaffOption(selectEl, name) {
  if (!selectEl || !name) return;
  if ([...selectEl.options].some((o) => o.value === name)) return;
  const addOpt = [...selectEl.options].find((o) => o.value === ADD_STAFF_VALUE);
  const opt = new Option(name, name);
  if (addOpt) selectEl.insertBefore(opt, addOpt);
  else selectEl.appendChild(opt);
}

function bindAddStaffSelect(selectEl, getSiteId, onAdded) {
  if (!selectEl || selectEl.dataset.addStaffBound === '1') return;
  selectEl.dataset.addStaffBound = '1';
  selectEl.addEventListener('change', async () => {
    if (selectEl.value !== ADD_STAFF_VALUE) return;
    selectEl.value = '';
    const result = await promptNewSalesStaff(getSiteId());
    if (!result) return;
    if (typeof onAdded === 'function') onAdded(result, selectEl);
    else {
      insertStaffOption(selectEl, result.name);
      selectEl.value = result.name;
    }
  });
}
