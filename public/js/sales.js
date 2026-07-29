let sites = [];
let recordTypes = [];
let activeStaff = [];
let editingId = null;
let commissionDefaults = {
  rate: 0.0485,
  payableRatio: 0.97,
  retentionRatio: 0.03,
  label: '預設：底價×4.85%，本期可請97%，保留款3%',
};
let salesAmountManual = false;

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

function numberValue(id) {
  return Number(document.getElementById(id).value) || 0;
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 10000) / 10000;
}

function pctFromRatio(ratio, fallback) {
  const v = Number(ratio);
  if (!Number.isFinite(v) || v <= 0) return fallback;
  return roundMoney(v > 1 ? v : v * 100);
}

function applyCommissionDefaultsToForm(defaults) {
  if (!defaults) return;
  commissionDefaults = { ...commissionDefaults, ...defaults };
  document.getElementById('fCommRatePct').value = pctFromRatio(defaults.rate, 4.85);
  document.getElementById('fCommPayablePct').value = pctFromRatio(defaults.payableRatio, 97);
  document.getElementById('fCommRetentionPct').value = pctFromRatio(defaults.retentionRatio, 3);
  const hint = document.getElementById('commDefaultsHint');
  if (hint && defaults.label) hint.textContent = defaults.label;
}

function syncCommSalesAmountStyle() {
  const mode = document.getElementById('fCommBaseMode').value;
  const el = document.getElementById('fCommSalesAmount');
  el.classList.toggle('is-deal-mode', mode === 'deal');
}

function suggestedCommissionSalesAmount() {
  const mode = document.getElementById('fCommBaseMode').value;
  return mode === 'deal'
    ? numberValue('fActualTotalPrice')
    : numberValue('fBaseTotal');
}

function calculatePrices() {
  const houseSale = numberValue('fHouseSalePrice');
  const parkingSale = numberValue('fParkingSalePrice');
  const deductions = [
    'fSurcharge', 'fApplianceGift', 'fPickupVoucher',
    'fDecoration', 'fCompanyLoanInterest',
  ].reduce((sum, id) => sum + numberValue(id), 0);
  const houseBase = numberValue('fHouseBasePrice');
  const parkingBase = numberValue('fParkingBasePrice');
  const contractTotal = houseSale + parkingSale;
  const actualHouse = houseSale - deductions;
  const actualTotal = actualHouse + parkingSale;
  const baseTotal = houseBase + parkingBase;
  const excess = contractTotal - baseTotal - deductions;

  document.getElementById('fContractTotal').value = roundMoney(contractTotal);
  document.getElementById('fActualHousePrice').value = roundMoney(actualHouse);
  document.getElementById('fActualTotalPrice').value = roundMoney(actualTotal);
  document.getElementById('fBaseTotal').value = roundMoney(baseTotal);
  document.getElementById('fExcessPrice').value = roundMoney(excess);

  if (!salesAmountManual) {
    document.getElementById('fCommSalesAmount').value = roundMoney(suggestedCommissionSalesAmount());
  }
  calculateCommission();
}

function calculateCommission() {
  const salesAmount = numberValue('fCommSalesAmount');
  const ratePct = numberValue('fCommRatePct');
  const payablePct = numberValue('fCommPayablePct');
  const retentionPct = numberValue('fCommRetentionPct');
  const deduction = numberValue('fCommDeduction');
  const rate = ratePct > 1 ? ratePct / 100 : ratePct;
  const payableRatio = payablePct > 1 ? payablePct / 100 : payablePct;
  const retentionRatio = retentionPct > 1 ? retentionPct / 100 : retentionPct;

  const claimable = Math.max(salesAmount * rate - deduction, 0);
  const payable = claimable * payableRatio;
  const retention = claimable * retentionRatio;
  const period = document.getElementById('fCommPeriod').value.trim();
  const claimDate = document.getElementById('fCommClaimDate').value;
  const isClaimed = Boolean(period || claimDate);
  const claimed = isClaimed ? payable : 0;
  const unclaimed = Math.max(claimable - claimed, 0);
  const status = isClaimed ? '已請' : '未請';

  document.getElementById('fCommClaimable').value = roundMoney(claimable);
  document.getElementById('fCommPayable').value = roundMoney(payable);
  document.getElementById('fCommRetention').value = roundMoney(retention);
  document.getElementById('fCommClaimed').value = roundMoney(claimed);
  document.getElementById('fCommUnclaimed').value = roundMoney(unclaimed);
  const statusEl = document.getElementById('fCommStatus');
  statusEl.value = status;
  statusEl.classList.toggle('comm-status-claimed', isClaimed);
  statusEl.classList.toggle('comm-status-open', !isClaimed);
  syncCommSalesAmountStyle();
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

async function loadCommissionDefaults(siteId) {
  try {
    const params = siteId ? `?siteId=${encodeURIComponent(siteId)}` : '';
    const res = await fetch(`/api/sales/meta${params}`);
    if (!res.ok) return;
    const json = await res.json();
    if (json.commissionDefaults) applyCommissionDefaultsToForm(json.commissionDefaults);
    if (json.recordTypes?.length) {
      recordTypes = json.recordTypes;
      fillTypeSelects();
    }
  } catch { /* ignore */ }
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
    orderNo: document.getElementById('fOrderNo').value.trim(),
    unitNo: document.getElementById('fUnitNo').value.trim(),
    customerName: document.getElementById('fCustomerName').value.trim(),
    phone: document.getElementById('fPhone').value.trim(),
    productType: document.getElementById('fProductType').value,
    areaPing: Number(document.getElementById('fAreaPing').value) || 0,
    units: Number(document.getElementById('fUnits').value) || 1,
    parkingNo1: document.getElementById('fParkingNo1').value.trim(),
    parkingNo2: document.getElementById('fParkingNo2').value.trim(),
    houseSalePrice: numberValue('fHouseSalePrice'),
    parkingSalePrice: numberValue('fParkingSalePrice'),
    surcharge: numberValue('fSurcharge'),
    applianceGift: numberValue('fApplianceGift'),
    pickupVoucher: numberValue('fPickupVoucher'),
    decoration: numberValue('fDecoration'),
    companyLoanInterest: numberValue('fCompanyLoanInterest'),
    houseBasePrice: numberValue('fHouseBasePrice'),
    parkingBasePrice: numberValue('fParkingBasePrice'),
    depositDate: document.getElementById('fDepositDate').value || null,
    supplementDate: document.getElementById('fSupplementDate').value || null,
    signDate: document.getElementById('fSignDate').value || null,
    ownerSaleReportDate: document.getElementById('fOwnerSaleReportDate').value || null,
    ownerSignReportDate: document.getElementById('fOwnerSignReportDate').value || null,
    salesperson1: document.getElementById('fSales1').value,
    salesperson2: document.getElementById('fSales2').value,
    isCoManaged: document.getElementById('fCoManaged').value === '是',
    commissionBaseMode: document.getElementById('fCommBaseMode').value || 'base',
    commissionSalesAmount: numberValue('fCommSalesAmount'),
    commissionRate: numberValue('fCommRatePct') / 100,
    commissionPayableRatio: numberValue('fCommPayablePct') / 100,
    commissionRetentionRatio: numberValue('fCommRetentionPct') / 100,
    commissionDeduction: numberValue('fCommDeduction'),
    commissionPeriod: document.getElementById('fCommPeriod').value.trim(),
    commissionClaimDate: document.getElementById('fCommClaimDate').value || null,
    commissionBooked: numberValue('fCommBooked'),
    nextMonthClaimable: numberValue('fNextMonthAmt'),
    nextMonthUnits: numberValue('fNextMonthUnits'),
    nextMonthParking: numberValue('fNextMonthParking'),
    memo: document.getElementById('fMemo').value.trim(),
  };
}

function fillForm(rec) {
  editingId = rec?.id || null;
  document.getElementById('salesEditId').value = editingId || '';
  document.getElementById('salesFormTitle').textContent = editingId ? `編輯明細 #${editingId}` : '新增銷售明細';
  document.getElementById('fRecordType').value = rec?.recordType || 'deal';
  document.getElementById('fOrderNo').value = rec?.orderNo || '';
  document.getElementById('fUnitNo').value = rec?.unitNo || '';
  document.getElementById('fCustomerName').value = rec?.customerName || '';
  document.getElementById('fPhone').value = rec?.phone || '';
  document.getElementById('fProductType').value = rec?.productType || '';
  document.getElementById('fAreaPing').value = rec?.areaPing || 0;
  document.getElementById('fUnits').value = rec?.units ?? 1;
  document.getElementById('fParkingNo1').value = rec?.parkingNo1 || '';
  document.getElementById('fParkingNo2').value = rec?.parkingNo2 || '';
  document.getElementById('fHouseSalePrice').value =
    rec?.houseSalePrice || rec?.contractTotal || rec?.totalPrice || 0;
  document.getElementById('fParkingSalePrice').value = rec?.parkingSalePrice || 0;
  document.getElementById('fSurcharge').value = rec?.surcharge || 0;
  document.getElementById('fApplianceGift').value = rec?.applianceGift || 0;
  document.getElementById('fPickupVoucher').value = rec?.pickupVoucher || 0;
  document.getElementById('fDecoration').value = rec?.decoration || 0;
  document.getElementById('fCompanyLoanInterest').value = rec?.companyLoanInterest || 0;
  document.getElementById('fHouseBasePrice').value =
    rec?.houseBasePrice || rec?.baseTotal || rec?.basePrice || 0;
  document.getElementById('fParkingBasePrice').value = rec?.parkingBasePrice || 0;
  document.getElementById('fDepositDate').value = rec?.depositDate || '';
  document.getElementById('fSupplementDate').value = rec?.supplementDate || '';
  document.getElementById('fSignDate').value = rec?.signDate || '';
  document.getElementById('fOwnerSaleReportDate').value =
    rec?.ownerSaleReportDate || rec?.reportDate || '';
  document.getElementById('fOwnerSignReportDate').value = rec?.ownerSignReportDate || '';
  ensureStaffOption('fSales1', rec?.salesperson1);
  ensureStaffOption('fSales2', rec?.salesperson2);
  document.getElementById('fSales1').value = rec?.salesperson1 || '';
  document.getElementById('fSales2').value = rec?.salesperson2 || '';
  document.getElementById('fCoManaged').value = rec?.isCoManaged ? '是' : '否';

  document.getElementById('fCommBaseMode').value = rec?.commissionBaseMode || 'base';
  applyCommissionDefaultsToForm(commissionDefaults);
  if (rec?.commissionRate != null) {
    document.getElementById('fCommRatePct').value = pctFromRatio(rec.commissionRate, 4.85);
  }
  if (rec?.commissionPayableRatio != null) {
    document.getElementById('fCommPayablePct').value = pctFromRatio(rec.commissionPayableRatio, 97);
  }
  if (rec?.commissionRetentionRatio != null) {
    document.getElementById('fCommRetentionPct').value = pctFromRatio(rec.commissionRetentionRatio, 3);
  }
  document.getElementById('fCommDeduction').value = rec?.commissionDeduction || 0;
  document.getElementById('fCommPeriod').value = rec?.commissionPeriod || '';
  document.getElementById('fCommClaimDate').value = rec?.commissionClaimDate || '';
  document.getElementById('fCommBooked').value = rec?.commissionBooked || 0;
  document.getElementById('fNextMonthAmt').value = rec?.nextMonthClaimable || 0;
  document.getElementById('fNextMonthUnits').value = rec?.nextMonthUnits || 0;
  document.getElementById('fNextMonthParking').value = rec?.nextMonthParking || 0;
  document.getElementById('fMemo').value = rec?.memo || '';

  salesAmountManual = false;
  calculatePrices();
  if (rec?.commissionSalesAmount != null && Number(rec.commissionSalesAmount) > 0) {
    const suggested = suggestedCommissionSalesAmount();
    if (Math.abs(Number(rec.commissionSalesAmount) - suggested) > 0.0001) {
      salesAmountManual = true;
      document.getElementById('fCommSalesAmount').value = roundMoney(rec.commissionSalesAmount);
      calculateCommission();
    }
  }

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
  salesAmountManual = false;
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
    { label: '本期可請97%(萬)', value: c.payableAmount ?? 0 },
    { label: '保留款3%(萬)', value: c.retentionAmount ?? 0 },
    { label: '已請佣(萬)', value: c.claimedAmount ?? 0 },
    { label: '未請(萬)', value: c.unclaimedAmount ?? 0 },
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
    tbody.innerHTML = '<tr><td colspan="14" class="empty-row">尚無銷售明細，請按「新增明細」</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map((r) => {
    const sales = [r.salesperson1, r.salesperson2].filter(Boolean).join('／');
    const salesAmtClass = r.commissionBaseMode === 'deal' ? ' class="is-deal-mode"' : '';
    return `<tr>
      <td>${escapeHtml(r.recordTypeLabel || r.recordType)}</td>
      <td>${escapeHtml(r.orderNo)}</td>
      <td>${escapeHtml(r.unitNo)}</td>
      <td>${escapeHtml(r.customerName)}</td>
      <td>${escapeHtml([r.parkingNo1, r.parkingNo2].filter(Boolean).join('／'))}</td>
      <td>${r.contractTotal ?? r.totalPrice ?? 0}</td>
      <td>${r.actualTotalPrice ?? 0}</td>
      <td>${r.baseTotal ?? r.basePrice ?? 0}</td>
      <td${salesAmtClass}>${r.commissionSalesAmount ?? 0}</td>
      <td>${r.commissionClaimable ?? 0}／${r.commissionClaimed ?? 0}</td>
      <td>${escapeHtml(r.commissionStatus || '未請')}</td>
      <td class="cell-date">${escapeHtml(r.ownerSaleReportDate || r.reportDate || '')}</td>
      <td>${escapeHtml(sales)}</td>
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
  await loadCommissionDefaults(siteId);
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
  await loadCommissionDefaults(document.getElementById('salesSite').value);

  document.getElementById('loadSalesBtn').addEventListener('click', loadSales);
  document.getElementById('newSalesBtn').addEventListener('click', () => {
    if (!document.getElementById('salesSite').value) {
      showToast('請先選擇案場', 'error');
      return;
    }
    salesAmountManual = false;
    fillForm({ recordType: 'deal', units: 1 });
  });
  document.getElementById('saveSalesBtn').addEventListener('click', saveDeal);
  document.getElementById('cancelSalesBtn').addEventListener('click', clearForm);
  document.getElementById('salesSite').addEventListener('change', async () => {
    await loadCommissionDefaults(document.getElementById('salesSite').value);
    loadSales();
  });
  [
    'fHouseSalePrice', 'fParkingSalePrice', 'fSurcharge', 'fApplianceGift',
    'fPickupVoucher', 'fDecoration', 'fCompanyLoanInterest',
    'fHouseBasePrice', 'fParkingBasePrice',
  ].forEach((id) => document.getElementById(id).addEventListener('input', calculatePrices));

  document.getElementById('fCommBaseMode').addEventListener('change', () => {
    salesAmountManual = false;
    document.getElementById('fCommSalesAmount').value = roundMoney(suggestedCommissionSalesAmount());
    calculateCommission();
  });
  document.getElementById('fCommSalesAmount').addEventListener('input', () => {
    salesAmountManual = true;
    calculateCommission();
  });
  [
    'fCommRatePct', 'fCommPayablePct', 'fCommRetentionPct', 'fCommDeduction',
    'fCommPeriod', 'fCommClaimDate',
  ].forEach((id) => document.getElementById(id).addEventListener('input', calculateCommission));

  if (document.getElementById('salesSite').value) loadSales();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { init(); });
} else {
  init();
}
