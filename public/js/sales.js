let sites = [];
let recordTypes = [];
let activeStaff = [];
let staffDeparted = {};
let editingId = null;
let commissionDefaults = {
  rate: 0.0485,
  payableRatio: 0.97,
  retentionRatio: 0.03,
  scheme: 'simple',
  handoverRetention: 0.005,
  tiers: [{ paidPct: 6, claimPct: 2 }, { paidPct: 8, claimPct: 3 }],
  deductionLabels: [],
  labels: { claimable: '4.85%', retention: '3%保留', payable: '97%可請' },
  label: '預設：底價×4.85%，本期可請97%，保留款3%',
};
let salesAmountManual = false;

const DEDUCTION_FIELDS = [
  { key: 'surcharge', inputId: 'fSurcharge', settingId: 'ssLabelSurcharge', fallback: '附加費' },
  { key: 'applianceGift', inputId: 'fApplianceGift', settingId: 'ssLabelAppliance', fallback: '家電禮券' },
  { key: 'pickupVoucher', inputId: 'fPickupVoucher', settingId: 'ssLabelPickup', fallback: '提貨券' },
  { key: 'decoration', inputId: 'fDecoration', settingId: 'ssLabelDecoration', fallback: '裝潢' },
  { key: 'companyLoanInterest', inputId: 'fCompanyLoanInterest', settingId: 'ssLabelCompany', fallback: '公司貸利息' },
];

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
  return Number(document.getElementById(id)?.value) || 0;
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 10000) / 10000;
}

function pctFromRatio(ratio, fallback) {
  const v = Number(ratio);
  if (!Number.isFinite(v) || v < 0) return fallback;
  if (v === 0) return 0;
  return roundMoney(v > 1 ? v : v * 100);
}

function formatPctLabel(ratio, fallback) {
  const n = pctFromRatio(ratio, fallback);
  if (!Number.isFinite(n)) return String(fallback);
  return String(Math.round(n * 10000) / 10000);
}

function commissionCardLabels(defaults) {
  const d = defaults || commissionDefaults;
  if (d.labels && d.labels.claimable) return d.labels;
  if ((d.scheme || 'simple') === 'payment_tiers') {
    return {
      claimable: `${formatPctLabel(d.rate, 4.85)}%總佣`,
      retention: `交屋保留 ${formatPctLabel(d.handoverRetention, 0.5)}%`,
      payable: '已解鎖可請',
    };
  }
  return {
    claimable: `${formatPctLabel(d.rate, 4.85)}%`,
    retention: `${formatPctLabel(d.retentionRatio, 3)}%保留`,
    payable: `${formatPctLabel(d.payableRatio, 97)}%可請`,
  };
}

function syncCommissionSchemeUI(defaults) {
  const scheme = (defaults || commissionDefaults).scheme || 'simple';
  document.body.classList.toggle('commission-scheme-simple', scheme !== 'payment_tiers');
  document.body.classList.toggle('commission-scheme-tiers', scheme === 'payment_tiers');
}

function fillSiteSettingsForm(defaults) {
  const d = defaults || commissionDefaults;
  const schemeEl = document.getElementById('ssScheme');
  if (!schemeEl) return;
  schemeEl.value = d.scheme === 'payment_tiers' ? 'payment_tiers' : 'simple';
  document.getElementById('ssRatePct').value = pctFromRatio(d.rate, 4.85);
  document.getElementById('ssPayablePct').value = pctFromRatio(d.payableRatio, 97);
  document.getElementById('ssRetentionPct').value = pctFromRatio(d.retentionRatio, 3);
  document.getElementById('ssHandoverPct').value = pctFromRatio(d.handoverRetention, 0.5);
  const tiers = d.tiers || [];
  document.getElementById('ssTiersText').value = tiers
    .map((t) => `${t.paidPct},${t.claimPct}`)
    .join('\n');
  (d.deductionLabels || []).forEach((item) => {
    const field = DEDUCTION_FIELDS.find((f) => f.key === item.key);
    if (field) document.getElementById(field.settingId).value = item.label ?? '';
  });
  const hint = document.getElementById('ssSettingsHint');
  if (hint) hint.textContent = d.label || '';
}

function collectSiteSettings() {
  const labels = DEDUCTION_FIELDS.map((f) => ({
    key: f.key,
    label: (document.getElementById(f.settingId)?.value || '').trim(),
  }));
  return {
    scheme: document.getElementById('ssScheme').value || 'simple',
    ratePct: numberValue('ssRatePct'),
    payablePct: numberValue('ssPayablePct'),
    retentionPct: numberValue('ssRetentionPct'),
    handoverPct: numberValue('ssHandoverPct'),
    tiersText: document.getElementById('ssTiersText').value,
    deductionLabels: labels,
  };
}

function applyDeductionLabels(labels) {
  const map = {};
  (labels || []).forEach((item) => {
    if (item && item.key) map[item.key] = item.label;
  });
  const visibleNames = [];
  DEDUCTION_FIELDS.forEach((f) => {
    const label = map[f.key];
    const shown = String(label ?? f.fallback).trim();
    const input = document.getElementById(f.inputId);
    const wrap = input?.closest('.form-group');
    if (wrap) wrap.classList.toggle('hidden', !shown);
    const el = document.querySelector(`label[for="${f.inputId}"]`);
    if (el && shown) el.textContent = shown;
    if (shown) visibleNames.push(shown);
  });
  const excess = document.querySelector('label[for="fExcessPrice"]');
  if (excess) excess.textContent = visibleNames.length
    ? `超價＝合約總價−底總−${visibleNames.join('−')}`
    : '超價＝合約總價−底總';
}

function applyCommissionResultLabels(defaults) {
  const labels = commissionCardLabels(defaults);
  const claimable = document.getElementById('lCommClaimable');
  const payable = document.getElementById('lCommPayable');
  const retention = document.getElementById('lCommRetention');
  if (claimable) claimable.textContent = `可請佣金額 ${labels.claimable}(萬)`;
  if (payable) payable.textContent = `${labels.payable}(萬)`;
  if (retention) retention.textContent = `${labels.retention}(萬)`;
}

function applyCommissionDefaultsToForm(defaults) {
  if (!defaults) return;
  commissionDefaults = { ...commissionDefaults, ...defaults };
  document.getElementById('fCommRatePct').value = pctFromRatio(defaults.rate, 4.85);
  document.getElementById('fCommPayablePct').value = pctFromRatio(defaults.payableRatio, 97);
  document.getElementById('fCommRetentionPct').value = pctFromRatio(defaults.retentionRatio, 3);
  const hint = document.getElementById('commDefaultsHint');
  if (hint) hint.textContent = defaults.label || '';
  syncCommissionSchemeUI(defaults);
  fillSiteSettingsForm(defaults);
  applyDeductionLabels(defaults.deductionLabels);
  applyCommissionResultLabels(defaults);
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
  const contractTotal = houseSale + parkingSale + deductions;
  const actualHouse = houseSale;
  const actualTotal = houseSale + parkingSale;
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
  const period = document.getElementById('fCommPeriod')?.value.trim() || '';
  const claimDate = document.getElementById('fCommClaimDate')?.value || '';
  const isClaimed = Boolean(period || claimDate);
  const scheme = commissionDefaults.scheme || 'simple';

  let claimable = Math.max(salesAmount * rate - deduction, 0);
  let payable = claimable * payableRatio;
  let retention = claimable * retentionRatio;
  if (scheme === 'payment_tiers') {
    const paidPct = numberValue('fCustomerPaidPct');
    const tiers = (commissionDefaults.tiers || []).slice()
      .sort((a, b) => Number(a.paidPct) - Number(b.paidPct));
    let unlockedPct = 0;
    tiers.forEach((t) => {
      if (paidPct + 1e-9 >= Number(t.paidPct)) unlockedPct = Number(t.claimPct) || 0;
    });
    const handoverRatio = Number(commissionDefaults.handoverRetention) || 0.005;
    payable = salesAmount * (unlockedPct / 100);
    retention = salesAmount * handoverRatio;
  }

  document.getElementById('fCommClaimable').value = roundMoney(claimable);
  document.getElementById('fCommPayable').value = roundMoney(payable);
  document.getElementById('fCommRetention').value = roundMoney(retention);
  const claimedEl = document.getElementById('fCommClaimed');
  const unclaimedEl = document.getElementById('fCommUnclaimed');
  const statusEl = document.getElementById('fCommStatus');
  if (claimedEl) claimedEl.value = roundMoney(isClaimed ? payable : 0);
  if (unclaimedEl) {
    unclaimedEl.value = roundMoney(scheme === 'payment_tiers'
      ? Math.max(claimable - (isClaimed ? payable : 0) - retention, 0)
      : Math.max(claimable - (isClaimed ? payable : 0), 0));
  }
  if (statusEl) {
    statusEl.value = isClaimed ? '已請' : '未請';
    statusEl.classList.toggle('comm-status-claimed', isClaimed);
    statusEl.classList.toggle('comm-status-open', !isClaimed);
  }
  syncCommSalesAmountStyle();
  syncBookedAmount();
  syncCurrentMonthClaimable();
}

function syncBookedAmount() {
  const select = document.getElementById('fCommissionBookedStatus');
  if (!select || select.value !== '是') return;
  document.getElementById('fCommBooked').value = roundMoney(numberValue('fCommPayable'));
}

function syncCurrentMonthClaimable() {
  const select = document.getElementById('fCurrentMonthClaimable');
  if (!select || select.value !== '是') return;
  const unitsEl = document.getElementById('fNextMonthUnits');
  const parkingEl = document.getElementById('fNextMonthParking');
  const amtEl = document.getElementById('fNextMonthAmt');
  if (!unitsEl || !parkingEl || !amtEl) return;
  const parking = ['fParkingNo1', 'fParkingNo2', 'fParkingNo3']
    .filter((id) => document.getElementById(id).value.trim()).length;
  unitsEl.value = numberValue('fUnits') || 1;
  parkingEl.value = parking;
  amtEl.value = roundMoney(numberValue('fCommPayable'));
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

function staffOffSiteLabel(name) {
  if ((staffDeparted || {})[name] === 'transferred') return `${name}（已調離原工地）`;
  return `${name}（原銷售／已離職）`;
}

function fillStaffSelects() {
  ['fSales1', 'fSales2'].forEach((id) => {
    const sel = document.getElementById(id);
    const cur = sel.value;
    sel.innerHTML = '<option value="">未填</option>';
    activeStaff.forEach((name) => sel.appendChild(new Option(name, name)));
    if (cur && ![...sel.options].some((o) => o.value === cur)) {
      sel.appendChild(new Option(staffOffSiteLabel(cur), cur));
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
    phone: '',
    productType: document.getElementById('fProductType').value,
    areaPing: Number(document.getElementById('fAreaPing').value) || 0,
    units: Number(document.getElementById('fUnits').value) || 1,
    parkingNo1: document.getElementById('fParkingNo1').value.trim(),
    parkingNo2: document.getElementById('fParkingNo2').value.trim(),
    parkingNo3: document.getElementById('fParkingNo3').value.trim(),
    builderCompany: document.getElementById('fBuilderCompany').value.trim(),
    community: document.getElementById('fCommunity').value.trim(),
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
    commissionPeriod: document.getElementById('fCommPeriod')?.value.trim() || '',
    commissionClaimDate: document.getElementById('fCommClaimDate')?.value || null,
    commissionBooked: numberValue('fCommBooked'),
    nextMonthClaimable: 0,
    nextMonthUnits: 0,
    nextMonthParking: 0,
    customerPaidPct: numberValue('fCustomerPaidPct'),
    extra: {
      customerPaidPct: numberValue('fCustomerPaidPct'),
      parkingNo3: document.getElementById('fParkingNo3').value.trim(),
      builderCompany: document.getElementById('fBuilderCompany').value.trim(),
      community: document.getElementById('fCommunity').value.trim(),
    },
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
  document.getElementById('fBuilderCompany').value = rec?.builderCompany || rec?.extra?.builderCompany || '';
  document.getElementById('fCommunity').value = rec?.community || rec?.extra?.community || '';
  document.getElementById('fCustomerName').value = rec?.customerName || '';
  document.getElementById('fProductType').value = rec?.productType || '';
  if (rec?.productType) {
    const sel = document.getElementById('fProductType');
    if (![...sel.options].some((o) => o.value === rec.productType)) {
      sel.appendChild(new Option(rec.productType, rec.productType));
      sel.value = rec.productType;
    }
  }
  document.getElementById('fAreaPing').value = rec?.areaPing || 0;
  document.getElementById('fUnits').value = rec?.units ?? 1;
  document.getElementById('fParkingNo1').value = rec?.parkingNo1 || '';
  document.getElementById('fParkingNo2').value = rec?.parkingNo2 || '';
  document.getElementById('fParkingNo3').value = rec?.parkingNo3 || rec?.extra?.parkingNo3 || '';
  document.getElementById('fHouseSalePrice').value =
    rec?.houseSalePrice || rec?.contractTotal || rec?.totalPrice || 0;
  document.getElementById('fParkingSalePrice').value = rec?.parkingSalePrice || 0;
  document.getElementById('fSurcharge').value = rec?.surcharge ?? 0;
  document.getElementById('fApplianceGift').value = rec?.applianceGift ?? 0;
  document.getElementById('fPickupVoucher').value = rec?.pickupVoucher ?? 0;
  document.getElementById('fDecoration').value = rec?.decoration ?? 0;
  document.getElementById('fCompanyLoanInterest').value = rec?.companyLoanInterest ?? 0;
  document.getElementById('fHouseBasePrice').value = rec?.houseBasePrice ?? 0;
  document.getElementById('fParkingBasePrice').value = rec?.parkingBasePrice ?? 0;
  document.getElementById('fDepositDate').value = toDateInput(
    rec?.depositDate || rec?.ownerSaleReportDate || rec?.reportDate,
  );
  document.getElementById('fSupplementDate').value = toDateInput(rec?.supplementDate);
  document.getElementById('fSignDate').value = toDateInput(rec?.signDate || rec?.ownerSignReportDate);
  document.getElementById('fOwnerSaleReportDate').value = toDateInput(
    rec?.ownerSaleReportDate || rec?.reportDate,
  );
  document.getElementById('fOwnerSignReportDate').value = toDateInput(rec?.ownerSignReportDate);
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
  document.getElementById('fCustomerPaidPct').value = rec?.extra?.customerPaidPct ?? 0;
  const periodEl = document.getElementById('fCommPeriod');
  if (periodEl) periodEl.value = rec?.commissionPeriod || '';
  const claimDateEl = document.getElementById('fCommClaimDate');
  if (claimDateEl) claimDateEl.value = toDateInput(rec?.commissionClaimDate);
  const bookedEl = document.getElementById('fCommBooked');
  if (bookedEl) bookedEl.value = rec?.commissionBooked || 0;
  const bookedStatusEl = document.getElementById('fCommissionBookedStatus');
  if (bookedStatusEl) {
    bookedStatusEl.value = Number(rec?.commissionBooked || 0) > 0 ? '是' : '否';
  }
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
    sel.appendChild(new Option(staffOffSiteLabel(name), name));
  }
}

function clearForm() {
  editingId = null;
  salesAmountManual = false;
  fillForm({ recordType: 'deal', units: 1 });
  document.getElementById('salesFormCard').classList.add('hidden');
}

function toDateInput(value) {
  if (!value) return '';
  const s = String(value).trim().split(/[ T]/)[0].replace(/\./g, '-').replace(/\//g, '-');
  const m = s.match(/^(\d{2,4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return '';
  let y = Number(m[1]);
  if (y > 0 && y < 1911) y += 1911;
  return `${String(y).padStart(4, '0')}-${String(Number(m[2])).padStart(2, '0')}-${String(Number(m[3])).padStart(2, '0')}`;
}

function fmtNum(val) {
  const n = Number(val || 0);
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 10000) / 10000);
}

function renderCommissionMatrix(summary) {
  const el = document.getElementById('commissionMatrix');
  if (!el) return;
  const m = summary?.commissionMatrix;
  if (!m) {
    el.innerHTML = '<p class="hint">載入後顯示可請／已請／未請矩陣</p>';
    return;
  }
  const cards = [
    { key: 'claimable', title: '可請總金額' },
    { key: 'claimed', title: '已請款金額' },
    { key: 'unclaimed', title: '未請款總金額' },
    { key: 'forecast', title: '預計本月可請' },
  ];
  el.innerHTML = cards.map((c) => {
    const b = m[c.key] || {};
    const labels = m.labels || commissionCardLabels(commissionDefaults);
    return `<div class="commission-matrix-card" data-tone="${c.key}">
      <h3>${escapeHtml(c.title)}</h3>
      <div class="upc">${fmtNum(b.units)}戶／${fmtNum(b.parking)}車</div>
      <dl>
        <dt>${escapeHtml(labels.claimable)}</dt><dd>${fmtNum(b.claimable)} 萬</dd>
        <dt>${escapeHtml(labels.retention)}</dt><dd>${fmtNum(b.retention)} 萬</dd>
        <dt>${escapeHtml(labels.payable)}</dt><dd>${fmtNum(b.payable)} 萬</dd>
      </dl>
    </div>`;
  }).join('');
}

function renderSummary(summary) {
  renderCommissionMatrix(summary);
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
    { label: '已入帳(萬)', value: c.bookedAmount ?? 0 },
  ];
  document.getElementById('salesSummaryGrid').innerHTML = items.map((it) => `
    <div class="stat-card">
      <div class="stat-label">${escapeHtml(it.label)}</div>
      <div class="stat-value">${escapeHtml(String(it.value))}</div>
    </div>
  `).join('');
}

let commissionBatches = [];

function renderBatchDeals(batch) {
  const panel = document.getElementById('batchDealPanel');
  const title = document.getElementById('batchDealTitle');
  const tbody = document.querySelector('#batchDealTable tbody');
  if (!batch) {
    panel.classList.add('hidden');
    return;
  }
  panel.classList.remove('hidden');
  title.textContent = `該期戶別｜${batch.periodName}（${batch.dealCount || 0} 筆）`;
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  const deals = batch.deals || [];
  if (!deals.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-row">此期尚無對應銷售明細</td></tr>';
    return;
  }
  tbody.innerHTML = deals.map((d) => `
    <tr>
      <td>${escapeHtml(d.unitNo)}</td>
      <td>${escapeHtml(d.customerName)}</td>
      <td>${escapeHtml(d.orderNo)}</td>
      <td>${fmtNum(d.units)}／${fmtNum(d.parking)}</td>
      <td>${fmtNum(d.payable)}</td>
      <td>${escapeHtml(d.status)}</td>
    </tr>
  `).join('');
}

function renderCommissionBatches(batches) {
  commissionBatches = batches || [];
  const tbody = document.querySelector('#commissionBatchTable tbody');
  if (!tbody) return;
  if (!commissionBatches.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty-row">尚無期別。請在銷售明細填「請佣期別」後按重新同步，或按新增期別。</td></tr>';
    return;
  }
  tbody.innerHTML = commissionBatches.map((b) => {
    const rowClass = b.status === 'full' ? 'batch-row-full' : (b.status === 'partial' ? 'batch-row-partial' : '');
    return `<tr class="${rowClass}" data-batch-id="${b.id}">
      <td><input class="batch-inline-input" data-field="periodName" value="${escapeHtml(b.periodName || '')}"></td>
      <td><input class="batch-inline-input" data-field="claimMonth" value="${escapeHtml(b.claimMonth || '')}" placeholder="例：115/03"></td>
      <td><button type="button" class="btn-xs link-btn batch-deals-btn" data-show-deals="${b.id}" title="點擊查看該期戶別明細">${fmtNum(b.units)}／${fmtNum(b.parking)}</button></td>
      <td><input class="batch-inline-input" type="number" step="0.0001" data-field="amountPayable" value="${b.amountPayable ?? 0}" title="自動加總 ${b.autoPayable ?? 0}"></td>
      <td><input class="batch-inline-input" type="number" step="0.0001" data-field="half1Amount" value="${b.half1Amount ?? 0}"></td>
      <td><input class="batch-inline-input" type="date" data-field="depositDate1" value="${escapeHtml(toDateInput(b.depositDate1))}"></td>
      <td><input class="batch-inline-input" type="number" step="0.0001" data-field="half2Amount" value="${b.half2Amount ?? 0}"></td>
      <td><input class="batch-inline-input" type="date" data-field="depositDate2" value="${escapeHtml(toDateInput(b.depositDate2))}"></td>
      <td><input class="batch-inline-input" data-field="deductionMemo" value="${escapeHtml(b.deductionMemo || '')}" placeholder="墊水電／折讓…"></td>
      <td>
        <button type="button" class="btn-xs" data-save-batch="${b.id}">儲存</button>
        <button type="button" class="btn-xs link-btn" data-del-batch="${b.id}">刪</button>
      </td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('[data-show-deals]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const batch = commissionBatches.find((x) => String(x.id) === btn.dataset.showDeals);
      renderBatchDeals(batch);
    });
  });
  tbody.querySelectorAll('[data-save-batch]').forEach((btn) => {
    btn.addEventListener('click', () => saveBatchRow(Number(btn.dataset.saveBatch)));
  });
  tbody.querySelectorAll('[data-del-batch]').forEach((btn) => {
    btn.addEventListener('click', () => deleteBatch(Number(btn.dataset.delBatch)));
  });
}

function collectBatchRow(batchId) {
  const tr = document.querySelector(`#commissionBatchTable tr[data-batch-id="${batchId}"]`);
  if (!tr) return null;
  const get = (field) => tr.querySelector(`[data-field="${field}"]`)?.value;
  return {
    id: batchId,
    siteId: document.getElementById('salesSite').value,
    periodName: (get('periodName') || '').trim(),
    claimMonth: (get('claimMonth') || '').trim(),
    amountPayable: get('amountPayable'),
    half1Amount: get('half1Amount'),
    depositDate1: get('depositDate1') || null,
    half2Amount: get('half2Amount'),
    depositDate2: get('depositDate2') || null,
    deductionMemo: (get('deductionMemo') || '').trim(),
  };
}

async function loadCommissionBatches() {
  const siteId = document.getElementById('salesSite').value;
  if (!siteId) return;
  try {
    const res = await fetch(`/api/sales/commission/batches?siteId=${encodeURIComponent(siteId)}`);
    const json = await res.json();
    if (!res.ok) {
      showToast(json.error || '載入期別失敗', 'error');
      return;
    }
    renderCommissionBatches(json.batches || []);
  } catch {
    showToast('載入期別失敗', 'error');
  }
}

async function saveBatchRow(batchId) {
  const body = collectBatchRow(batchId);
  if (!body?.periodName) {
    showToast('請填期別名稱', 'error');
    return;
  }
  try {
    const res = await fetch('/api/sales/commission/batches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) {
      showToast(json.error || '儲存失敗', 'error');
      return;
    }
    showToast('期別已儲存');
    renderCommissionBatches(json.batches || []);
  } catch {
    showToast('儲存失敗', 'error');
  }
}

async function deleteBatch(batchId) {
  const siteId = document.getElementById('salesSite').value;
  if (!siteId || !confirm('確定刪除此期別列？（不影響銷售明細）')) return;
  try {
    const res = await fetch(
      `/api/sales/commission/batches/${batchId}?siteId=${encodeURIComponent(siteId)}`,
      { method: 'DELETE' },
    );
    const json = await res.json();
    if (!res.ok) {
      showToast(json.error || '刪除失敗', 'error');
      return;
    }
    showToast('已刪除期別');
    renderCommissionBatches(json.batches || []);
    document.getElementById('batchDealPanel').classList.add('hidden');
  } catch {
    showToast('刪除失敗', 'error');
  }
}

async function addCommissionBatch() {
  const siteId = document.getElementById('salesSite').value;
  if (!siteId) {
    showToast('請先選擇案場', 'error');
    return;
  }
  const name = prompt('期別名稱（例：第17次服務費）');
  if (!name || !name.trim()) return;
  try {
    const res = await fetch('/api/sales/commission/batches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId, periodName: name.trim() }),
    });
    const json = await res.json();
    if (!res.ok) {
      showToast(json.error || '新增失敗', 'error');
      return;
    }
    showToast('已新增期別');
    renderCommissionBatches(json.batches || []);
  } catch {
    showToast('新增失敗', 'error');
  }
}

function exportCommissionOverview() {
  const siteId = document.getElementById('salesSite').value;
  if (!siteId) {
    showToast('請先選擇案場', 'error');
    return;
  }
  window.location.href = `/api/sales/commission/export.xlsx?siteId=${encodeURIComponent(siteId)}`;
}

function renderTable(rows) {
  const tbody = document.querySelector('#salesTable tbody');
  const tfoot = document.getElementById('salesTableTotal');
  document.getElementById('salesTotalBadge').textContent = String(rows.length);
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="19" class="empty-row">尚無銷售明細，請按「新增明細」</td></tr>';
    tfoot.innerHTML = '';
    return;
  }
  tbody.innerHTML = rows.map((r) => {
    const sales = [r.salesperson1, r.salesperson2].filter(Boolean).join('／');
    const salesAmtClass = r.commissionBaseMode === 'deal' ? ' class="is-deal-mode"' : '';
    return `<tr>
      <td>${escapeHtml(r.recordTypeLabel || r.recordType)}</td>
      <td>${escapeHtml(r.orderNo)}</td>
      <td>${escapeHtml(r.builderCompany || '')}</td>
      <td>${escapeHtml(r.community || '')}</td>
      <td>${escapeHtml(r.unitNo)}</td>
      <td>${escapeHtml(r.customerName)}</td>
      <td>${escapeHtml([r.parkingNo1, r.parkingNo2, r.parkingNo3].filter(Boolean).join('／'))}</td>
      <td>${r.contractTotal ?? r.totalPrice ?? 0}</td>
      <td>${r.actualTotalPrice ?? 0}</td>
      <td>${r.houseBasePrice ?? 0}</td>
      <td>${r.parkingBasePrice ?? 0}</td>
      <td>${r.baseTotal ?? r.basePrice ?? 0}</td>
      <td>${r.surcharge ?? 0}</td>
      <td${salesAmtClass}>${r.commissionSalesAmount ?? 0}</td>
      <td>${r.commissionClaimable ?? 0}</td>
      <td class="cell-date">${escapeHtml(r.ownerSaleReportDate || r.reportDate || '')}</td>
      <td class="cell-date">${escapeHtml(r.ownerSignReportDate || '')}</td>
      <td>${escapeHtml(sales)}</td>
      <td class="col-actions action-btns">
        <button type="button" class="btn-xs" data-edit="${r.id}">編輯</button>
        <button type="button" class="btn-xs link-btn" data-del="${r.id}">刪除</button>
      </td>
    </tr>`;
  }).join('');
  const sum = (key, fallbackKey) => roundMoney(rows.reduce(
    (total, row) => total + Number(row[key] ?? row[fallbackKey] ?? 0),
    0,
  ));
  tfoot.innerHTML = `<tr class="sales-total-row">
    <th colspan="7">合計（${rows.length} 筆）</th>
    <th>${sum('contractTotal', 'totalPrice')}</th>
    <th>${sum('actualTotalPrice')}</th>
    <th>${sum('houseBasePrice')}</th>
    <th>${sum('parkingBasePrice')}</th>
    <th>${sum('baseTotal', 'basePrice')}</th>
    <th>${sum('surcharge')}</th>
    <th>${sum('commissionSalesAmount')}</th>
    <th>${sum('commissionClaimable')}</th>
    <th colspan="4" class="col-actions"></th>
  </tr>`;
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

function exportSales(format) {
  const siteId = document.getElementById('salesSite').value;
  if (!siteId) {
    showToast('請先選擇案場', 'error');
    return;
  }
  const params = new URLSearchParams({
    siteId,
    recordType: document.getElementById('salesType').value,
    q: document.getElementById('salesQ').value.trim(),
  });
  window.location.href = `/api/sales/export.${format}?${params}`;
}

function formatSkippedImportRows(rows) {
  if (!rows?.length) return '';
  return rows.slice(0, 5).map((item) => {
    const who = [item.orderNo, item.unitNo, item.customerName].filter(Boolean).join('／');
    const extra = item.reason?.startsWith('檔案內')
      ? (item.matchRow ? `↔ ${item.matchRow}` : '')
      : (item.existingOrderNo || item.existingUnitNo
        ? `（系統已有：${[item.existingOrderNo, item.existingUnitNo, item.existingCustomerName].filter(Boolean).join('／')}）`
        : '');
    return `${item.row} ${who}：${item.reason}${extra}`;
  }).join('\n');
}

async function importSales(file) {
  const siteId = document.getElementById('salesSite').value;
  if (!siteId) {
    showToast('請先選擇案場', 'error');
    return;
  }
  if (!file) return;
  if (!confirm(`確定將「${file.name}」匯入目前案場？已存在的訂單會更新房底／車底／附加費等欄位。`)) return;

  const btn = document.getElementById('importSalesBtn');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '匯入中…';
  const body = new FormData();
  body.append('siteId', siteId);
  body.append('file', file);
  try {
    const res = await fetch('/api/sales/import', { method: 'POST', body });
    const json = await res.json();
    if (!res.ok) {
      showToast(json.error || '匯入失敗', 'error');
      return;
    }
    const sheetText = (json.sheets || []).length
      ? `（工作表：${json.sheets.join('、')}）`
      : '';
    const errorText = json.failed
      ? `；失敗 ${json.failed} 筆：${(json.errors || []).slice(0, 3).map((e) => `${e.row} ${e.message}`).join('、')}`
      : '';
    const skippedDetail = formatSkippedImportRows(json.skippedRows);
    showToast(
      `新增 ${json.imported || 0} 筆，更新 ${json.updated || 0} 筆，略過檔案內重複 ${json.skipped || 0} 筆${sheetText}${errorText}`,
      json.failed ? 'error' : 'success',
    );
    if (skippedDetail) {
      console.info('匯入略過明細：\n' + skippedDetail);
      alert(`以下 ${json.skipped} 筆因檔案內重複被略過：\n\n${skippedDetail}${json.skipped > 5 ? '\n…其餘請看瀏覽器主控台' : ''}`);
    }
    await loadSales();
  } catch {
    showToast('匯入失敗，請稍後再試', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
    document.getElementById('importSalesFile').value = '';
  }
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
    staffDeparted = listJson.staffDeparted || {};
    fillTypeSelects();
    fillStaffSelects();
    renderTable(listJson.records || []);
    if (sumRes.ok) renderSummary(sumJson.summary);
    await loadCommissionBatches();
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

function isExecutive() {
  return window.currentUser?.role === 'executive';
}

function syncDeleteAllSalesVisibility() {
  const canClear = isExecutive();
  document.getElementById('deleteAllSalesBtn')?.classList.toggle('hidden', !canClear);
  document.getElementById('deleteAllSalesHint')?.classList.toggle('hidden', !canClear);
}

async function deleteAllSales() {
  if (!isExecutive()) {
    showToast('僅最高主管可清空銷售總表', 'error');
    return;
  }
  const siteId = document.getElementById('salesSite').value;
  const siteName = document.getElementById('salesSite').selectedOptions?.[0]?.textContent || siteId;
  if (!siteId) {
    showToast('請先選擇案場', 'error');
    return;
  }
  const count = document.getElementById('salesTotalBadge')?.textContent || '0';
  if (!confirm(`確定清空「${siteName}」全部銷售明細（目前約 ${count} 筆）？\n此操作無法復原，請先匯出備份。`)) {
    return;
  }
  const confirmCode = prompt('請輸入 DELETE ALL 確認清空：');
  if (confirmCode !== 'DELETE ALL') {
    showToast('已取消（確認碼不符）', 'error');
    return;
  }
  try {
    const res = await fetch('/api/sales/deals/all', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId, confirm: 'DELETE ALL' }),
    });
    const json = await res.json();
    if (!res.ok) {
      showToast(json.error || '清空失敗', 'error');
      return;
    }
    showToast(`已清空：明細 ${json.deals || 0} 筆、期別 ${json.batches || 0} 筆`);
    await loadSales();
  } catch {
    showToast('清空失敗', 'error');
  }
}

async function saveSiteSalesSettings() {
  const siteId = document.getElementById('salesSite').value;
  if (!siteId) {
    showToast('請先選擇案場', 'error');
    return;
  }
  try {
    const res = await fetch(`/api/sites/${encodeURIComponent(siteId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ salesSettings: collectSiteSettings() }),
    });
    const json = await res.json();
    if (!res.ok) {
      showToast(json.error || '儲存失敗', 'error');
      return;
    }
    await loadCommissionDefaults(siteId);
    showToast('已儲存本案場請佣設定');
    loadSales();
  } catch {
    showToast('儲存失敗', 'error');
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

  syncDeleteAllSalesVisibility();
  await loadSites();
  await loadCommissionDefaults(document.getElementById('salesSite').value);

  document.getElementById('loadSalesBtn').addEventListener('click', loadSales);
  document.getElementById('deleteAllSalesBtn')?.addEventListener('click', deleteAllSales);
  document.getElementById('exportSalesExcelBtn').addEventListener('click', () => exportSales('xlsx'));
  document.getElementById('exportSalesCsvBtn').addEventListener('click', () => exportSales('csv'));
  document.getElementById('exportCommissionBtn')?.addEventListener('click', exportCommissionOverview);
  document.getElementById('addBatchBtn')?.addEventListener('click', addCommissionBatch);
  document.getElementById('reloadBatchesBtn')?.addEventListener('click', loadCommissionBatches);
  document.getElementById('importSalesBtn').addEventListener('click', () => {
    if (!document.getElementById('salesSite').value) {
      showToast('請先選擇案場', 'error');
      return;
    }
    document.getElementById('importSalesFile').click();
  });
  document.getElementById('importSalesFile').addEventListener('change', (event) => {
    importSales(event.target.files?.[0]);
  });
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
    'fCommPeriod', 'fCommClaimDate', 'fCustomerPaidPct',
  ].forEach((id) => document.getElementById(id)?.addEventListener('input', calculateCommission));
  document.getElementById('ssScheme')?.addEventListener('change', () => {
    document.body.classList.toggle('commission-scheme-simple', document.getElementById('ssScheme').value !== 'payment_tiers');
    document.body.classList.toggle('commission-scheme-tiers', document.getElementById('ssScheme').value === 'payment_tiers');
  });
  document.getElementById('saveSalesSettingsBtn')?.addEventListener('click', saveSiteSalesSettings);
  const currentMonthSel = document.getElementById('fCurrentMonthClaimable');
  if (currentMonthSel) {
    currentMonthSel.addEventListener('change', () => {
      if (currentMonthSel.value === '是') {
        syncCurrentMonthClaimable();
      } else {
        const unitsEl = document.getElementById('fNextMonthUnits');
        const parkingEl = document.getElementById('fNextMonthParking');
        const amtEl = document.getElementById('fNextMonthAmt');
        if (unitsEl) unitsEl.value = 0;
        if (parkingEl) parkingEl.value = 0;
        if (amtEl) amtEl.value = 0;
      }
    });
  }
  ['fUnits', 'fParkingNo1', 'fParkingNo2', 'fParkingNo3'].forEach((id) => {
    document.getElementById(id).addEventListener('input', syncCurrentMonthClaimable);
  });
  document.getElementById('fCommissionBookedStatus')?.addEventListener('change', () => {
    if (document.getElementById('fCommissionBookedStatus').value === '是') {
      syncBookedAmount();
    } else {
      const booked = document.getElementById('fCommBooked');
      if (booked) booked.value = 0;
    }
  });

  if (document.getElementById('salesSite').value) loadSales();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { init(); });
} else {
  init();
}
