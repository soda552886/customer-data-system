let sites = [];
let recordTypes = [];
let activeStaff = [];
let editingId = null;

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

async function loadSites() {
  const res = await fetch('/api/sites');
  sites = await res.json();
  const sel = document.getElementById('salesSite');
  sites.forEach((s) => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.name;
    sel.appendChild(opt);
  });
  const duoyi = sites.find((s) => s.id === 'libao_duoyi' || s.name.includes('鐸藝'));
  if (duoyi) sel.value = duoyi.id;
}

function fillTypeSelects() {
  const filter = document.getElementById('salesType');
  const form = document.getElementById('fRecordType');
  filter.innerHTML = '<option value="">全部</option>';
  form.innerHTML = '';
  recordTypes.forEach((t) => {
    filter.appendChild(new Option(t.label, t.id));
    form.appendChild(new Option(t.label, t.id));
  });
}

function fillStaffSelects() {
  ['fSales1', 'fSales2'].forEach((id) => {
    const sel = document.getElementById(id);
    const cur = sel.value;
    sel.innerHTML = '<option value="">未填</option>';
    activeStaff.forEach((name) => sel.appendChild(new Option(name, name)));
    if (cur && ![...sel.options].some((o) => o.value === cur)) {
      sel.appendChild(new Option(`${cur}（原銷售／已離職）`, cur));
    }
    sel.value = cur;
  });
}

function collectForm() {
  return {
    siteId: document.getElementById('salesSite').value,
    recordType: document.getElementById('fRecordType').value,
    unitNo: document.getElementById('fUnitNo').value.trim(),
    customerName: document.getElementById('fCustomerName').value.trim(),
    phone: document.getElementById('fPhone').value.trim(),
    productType: document.getElementById('fProductType').value,
    areaPing: Number(document.getElementById('fAreaPing').value) || 0,
    units: Number(document.getElementById('fUnits').value) || 1,
    parkingCount: Number(document.getElementById('fParkingCount').value) || 0,
    parkingNos: document.getElementById('fParkingNos').value.trim(),
    listPrice: Number(document.getElementById('fListPrice').value) || 0,
    basePrice: Number(document.getElementById('fBasePrice').value) || 0,
    totalPrice: Number(document.getElementById('fTotalPrice').value) || 0,
    depositDate: document.getElementById('fDepositDate').value || null,
    signDate: document.getElementById('fSignDate').value || null,
    reportDate: document.getElementById('fReportDate').value || null,
    salesperson1: document.getElementById('fSales1').value,
    salesperson2: document.getElementById('fSales2').value,
    isCoManaged: document.getElementById('fCoManaged').value === '是',
    commissionClaimable: Number(document.getElementById('fCommClaimable').value) || 0,
    commissionClaimed: Number(document.getElementById('fCommClaimed').value) || 0,
    commissionBooked: Number(document.getElementById('fCommBooked').value) || 0,
    nextMonthClaimable: Number(document.getElementById('fNextMonthAmt').value) || 0,
    nextMonthUnits: Number(document.getElementById('fNextMonthUnits').value) || 0,
    nextMonthParking: Number(document.getElementById('fNextMonthParking').value) || 0,
    memo: document.getElementById('fMemo').value.trim(),
  };
}

function fillForm(rec) {
  editingId = rec?.id || null;
  document.getElementById('salesEditId').value = editingId || '';
  document.getElementById('salesFormTitle').textContent = editingId ? `編輯明細 #${editingId}` : '新增銷售明細';
  document.getElementById('fRecordType').value = rec?.recordType || 'deal';
  document.getElementById('fUnitNo').value = rec?.unitNo || '';
  document.getElementById('fCustomerName').value = rec?.customerName || '';
  document.getElementById('fPhone').value = rec?.phone || '';
  document.getElementById('fProductType').value = rec?.productType || '';
  document.getElementById('fAreaPing').value = rec?.areaPing || 0;
  document.getElementById('fUnits').value = rec?.units ?? 1;
  document.getElementById('fParkingCount').value = rec?.parkingCount || 0;
  document.getElementById('fParkingNos').value = rec?.parkingNos || '';
  document.getElementById('fListPrice').value = rec?.listPrice || 0;
  document.getElementById('fBasePrice').value = rec?.basePrice || 0;
  document.getElementById('fTotalPrice').value = rec?.totalPrice || 0;
  document.getElementById('fDepositDate').value = rec?.depositDate || '';
  document.getElementById('fSignDate').value = rec?.signDate || '';
  document.getElementById('fReportDate').value = rec?.reportDate || '';
  ensureStaffOption('fSales1', rec?.salesperson1);
  ensureStaffOption('fSales2', rec?.salesperson2);
  document.getElementById('fSales1').value = rec?.salesperson1 || '';
  document.getElementById('fSales2').value = rec?.salesperson2 || '';
  document.getElementById('fCoManaged').value = rec?.isCoManaged ? '是' : '否';
  document.getElementById('fCommClaimable').value = rec?.commissionClaimable || 0;
  document.getElementById('fCommClaimed').value = rec?.commissionClaimed || 0;
  document.getElementById('fCommBooked').value = rec?.commissionBooked || 0;
  document.getElementById('fNextMonthAmt').value = rec?.nextMonthClaimable || 0;
  document.getElementById('fNextMonthUnits').value = rec?.nextMonthUnits || 0;
  document.getElementById('fNextMonthParking').value = rec?.nextMonthParking || 0;
  document.getElementById('fMemo').value = rec?.memo || '';
  document.getElementById('salesFormCard').classList.remove('hidden');
  document.getElementById('salesFormCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function ensureStaffOption(selId, name) {
  if (!name) return;
  const sel = document.getElementById(selId);
  if (![...sel.options].some((o) => o.value === name)) {
    sel.appendChild(new Option(`${name}（原銷售／已離職）`, name));
  }
}

function clearForm() {
  editingId = null;
  fillForm({ recordType: 'deal', units: 1 });
  document.getElementById('salesFormCard').classList.add('hidden');
}

function renderSummary(summary) {
  if (!summary) {
    document.getElementById('salesSummaryGrid').innerHTML = '<p class="hint">載入後顯示彙總</p>';
    return;
  }
  const c = summary.commission || {};
  const d = summary.deals || {};
  const items = [
    { label: '總筆數', value: summary.totalRecords || 0 },
    { label: '本週成交(戶/車/萬)', value: `${d.units}/${d.parking}/${d.amount}` },
    { label: '本週簽約', value: `${(summary.signings || {}).units}/${(summary.signings || {}).parking}/${(summary.signings || {}).amount}` },
    { label: '未報', value: `${(summary.unreported || {}).units}/${(summary.unreported || {}).parking}/${(summary.unreported || {}).amount}` },
    { label: '累積銷售(萬)', value: c.sellableAmount ?? 0 },
    { label: '可請佣(萬)', value: c.claimableAmount ?? 0 },
    { label: '已請佣(萬)', value: c.claimedAmount ?? 0 },
    { label: '已入帳(萬)', value: c.bookedAmount ?? 0 },
    { label: '下月可請(萬)', value: c.nextMonthAmount ?? 0 },
  ];
  document.getElementById('salesSummaryGrid').innerHTML = items.map((it) => `
    <div class="stat-card">
      <div class="stat-label">${escapeHtml(it.label)}</div>
      <div class="stat-value">${escapeHtml(String(it.value))}</div>
    </div>
  `).join('');
}

function renderTable(rows) {
  const tbody = document.querySelector('#salesTable tbody');
  document.getElementById('salesTotalBadge').textContent = String(rows.length);
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="12" class="empty-row">尚無銷售明細，請按「新增明細」</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map((r) => {
    const sales = [r.salesperson1, r.salesperson2].filter(Boolean).join('／');
    return `<tr>
      <td>${escapeHtml(r.recordTypeLabel || r.recordType)}</td>
      <td>${escapeHtml(r.unitNo)}</td>
      <td>${escapeHtml(r.customerName)}</td>
      <td>${r.units}／${r.parkingCount}</td>
      <td>${r.totalPrice}</td>
      <td>${r.basePrice}</td>
      <td class="cell-date">${escapeHtml(r.reportDate || '')}</td>
      <td class="cell-date">${escapeHtml(r.signDate || '')}</td>
      <td>${escapeHtml(sales)}</td>
      <td>${r.commissionClaimable}</td>
      <td>${r.commissionClaimed}</td>
      <td>
        <button type="button" class="btn-xs" data-edit="${r.id}">編輯</button>
        <button type="button" class="btn-xs link-btn" data-del="${r.id}">刪除</button>
      </td>
    </tr>`;
  }).join('');
  tbody.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const rec = rows.find((x) => String(x.id) === btn.dataset.edit);
      if (rec) fillForm(rec);
    });
  });
  tbody.querySelectorAll('[data-del]').forEach((btn) => {
    btn.addEventListener('click', () => deleteDeal(Number(btn.dataset.del)));
  });
}

async function loadSales() {
  const siteId = document.getElementById('salesSite').value;
  if (!siteId) {
    showToast('請選擇案場', 'error');
    return;
  }
  const params = new URLSearchParams({
    siteId,
    recordType: document.getElementById('salesType').value,
    q: document.getElementById('salesQ').value.trim(),
    limit: '500',
  });
  try {
    const [listRes, sumRes] = await Promise.all([
      fetch(`/api/sales/deals?${params}`),
      fetch(`/api/sales/summary?${new URLSearchParams({ siteId })}`),
    ]);
    const listJson = await listRes.json();
    const sumJson = await sumRes.json();
    if (!listRes.ok) {
      showToast(listJson.error || '載入失敗', 'error');
      return;
    }
    recordTypes = listJson.recordTypes || recordTypes;
    activeStaff = listJson.activeStaff || [];
    fillTypeSelects();
    fillStaffSelects();
    renderTable(listJson.records || []);
    if (sumRes.ok) renderSummary(sumJson.summary);
    showToast(`已載入 ${listJson.total || 0} 筆`);
  } catch {
    showToast('載入失敗', 'error');
  }
}

async function saveDeal() {
  const body = collectForm();
  if (!body.siteId) {
    showToast('請選擇案場', 'error');
    return;
  }
  if (!body.unitNo && !body.customerName) {
    showToast('請至少填寫戶號或客戶姓名', 'error');
    return;
  }
  const isEdit = Boolean(editingId);
  const url = isEdit ? `/api/sales/deals/${editingId}` : '/api/sales/deals';
  const method = isEdit ? 'PUT' : 'POST';
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) {
      showToast(json.error || '儲存失敗', 'error');
      return;
    }
    showToast(isEdit ? '已更新' : '已新增');
    clearForm();
    await loadSales();
  } catch {
    showToast('儲存失敗', 'error');
  }
}

async function deleteDeal(id) {
  const siteId = document.getElementById('salesSite').value;
  if (!siteId || !id) return;
  if (!confirm('確定刪除此筆銷售明細？')) return;
  try {
    const res = await fetch(`/api/sales/deals/${id}?siteId=${encodeURIComponent(siteId)}`, { method: 'DELETE' });
    const json = await res.json();
    if (!res.ok) {
      showToast(json.error || '刪除失敗', 'error');
      return;
    }
    showToast('已刪除');
    await loadSales();
  } catch {
    showToast('刪除失敗', 'error');
  }
}

async function init() {
  for (let i = 0; i < 50 && !window.navReady; i += 1) {
    await new Promise((r) => setTimeout(r, 20));
  }
  if (window.navReady) await window.navReady;
  if (!window.currentUser) {
    window.location.replace('/login.html?next=/sales.html');
    return;
  }
  if (!(window.currentUser.permissions || []).includes('manage_weekly_reports')) {
    showToast('沒有權限', 'error');
    setTimeout(() => { window.location.replace('/'); }, 1200);
    return;
  }

  await loadSites();
  try {
    const res = await fetch('/api/sales/meta');
    if (res.ok) {
      const json = await res.json();
      recordTypes = json.recordTypes || [];
      fillTypeSelects();
    }
  } catch { /* ignore */ }

  document.getElementById('loadSalesBtn').addEventListener('click', loadSales);
  document.getElementById('newSalesBtn').addEventListener('click', () => {
    if (!document.getElementById('salesSite').value) {
      showToast('請先選擇案場', 'error');
      return;
    }
    fillForm({ recordType: 'deal', units: 1 });
  });
  document.getElementById('saveSalesBtn').addEventListener('click', saveDeal);
  document.getElementById('cancelSalesBtn').addEventListener('click', clearForm);
  document.getElementById('salesSite').addEventListener('change', loadSales);

  if (document.getElementById('salesSite').value) loadSales();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { init(); });
} else {
  init();
}
