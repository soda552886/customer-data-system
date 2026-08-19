let sites = [];
let current = null;
let mediaItems = [];
let extraItems = [];
let mediaPresets = [];
const WAN = 10000;
const PIE_COLORS = ['#4c6ef5', '#be4bdb', '#f08c00', '#12b886', '#7048e8', '#e64980', '#228be6', '#82c91e'];
const REFERRAL_CAT = { key: 'referral', label: '介紹費', kind: 'manual', inPie: false };

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

function toYmd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function mondayOf(dateValue) {
  const d = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateValue;
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return toYmd(d);
}

function shiftWeek(weekStart, days) {
  const d = new Date(`${weekStart}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toYmd(d);
}

function fmtYuan(val) {
  const n = Number(val || 0);
  return n.toLocaleString('zh-TW', { maximumFractionDigits: 2 });
}

function fmtWan(val) {
  const n = Number(val || 0);
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 10000) / 10000);
}

function moneyClass(val) {
  return Number(val) < 0 ? 'budget-neg' : (Number(val) !== 0 ? 'budget-hot' : '');
}

function wanToYuan(val) {
  return Math.round((Number(val) || 0) * WAN * 100) / 100;
}

function yuanToWan(val) {
  return (Number(val) || 0) / WAN;
}

function isSumCat(cat) {
  return cat?.key === 'salesFee' || cat?.key === 'total';
}

function execManualKeys() {
  return (current?.project?.execCategories || [])
    .filter((c) => ['onsite', 'tools', 'signboard', 'planning', 'other'].includes(c.key))
    .map((c) => c.key);
}

function execAmountWan(kind, key) {
  return Number(document.querySelector(`[data-exec-${kind}="${key}"]`)?.value) || 0;
}

function wanInput(prefix, kind, key, value, extraClass = '', readonly = false) {
  const ro = readonly ? 'readonly' : '';
  const cls = extraClass ? ` class="${extraClass}"` : '';
  return `<input type="number" step="0.01"${cls} ${ro} data-${prefix}-${kind}="${key}" value="${fmtWan(value)}">`;
}

async function loadSites() {
  const res = await fetch('/api/sites');
  sites = await res.json();
  const sel = document.getElementById('budgetSite');
  sites.forEach((s) => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.name;
    sel.appendChild(opt);
  });
  const preferred = sites.find((s) => s.name.includes('世界都心'))
    || sites.find((s) => s.id === 'libao_duoyi' || s.name.includes('鐸藝'));
  if (preferred) sel.value = preferred.id;
}

function updateWeekLabel(payload) {
  const el = document.getElementById('budgetWeekLabel');
  if (!payload) {
    el.textContent = '—';
    return;
  }
  el.textContent = `第${payload.weekNumber}週  ${payload.rocLabel}`;
  const range = document.getElementById('weekSpendRange');
  if (range) range.textContent = `日期：${payload.rocLabel}（第${payload.weekNumber}週）`;
}

function salesBase() {
  return Number(document.getElementById('salesBaseWan').value) || 0;
}

function calcRateWan(pct) {
  return Math.round(salesBase() * (Number(pct) || 0) * 100) / 10000;
}

function syncRateLabels() {
  const project = current?.project;
  if (!project) return;
  const fee = Number(document.getElementById('salesFeePct').value) || 0;
  const reward = Number(document.getElementById('rewardPct').value) || 0;
  const ownerPct = Number(document.getElementById('ownerBudgetPct').value) || 0;
  project.salesFeePct = fee;
  project.rewardPct = reward;
  project.ownerBudgetPct = ownerPct;
  project.showReferralFee = document.getElementById('showReferralFee').checked;
  (project.ownerCategories || []).forEach((c) => {
    if (c.key === 'fee') {
      c.ratePct = ownerPct;
      c.label = `預算 ${ownerPct}%`;
    }
  });
  (project.execCategories || []).forEach((c) => {
    if (c.key === 'salesFee') {
      c.ratePct = fee;
      c.label = `廣告預算 ${fee}%`;
      c.inPie = false;
    } else if (c.key === 'reward') {
      c.ratePct = reward;
      c.label = `人事預算 ${reward}%`;
      c.inPie = true;
    } else if (c.key === 'total') {
      c.ratePct = fee + reward;
      c.label = `總預算 ${fee + reward}%`;
      c.inPie = false;
    } else if (c.key === 'referral') {
      c.label = c.label || '介紹費';
      c.inPie = false;
    }
  });
}

function readGridInputs(prefix, cats) {
  const out = {};
  cats.forEach((cat) => {
    const budgetEl = document.querySelector(`[data-${prefix}-budget="${cat.key}"]`);
    const sentEl = document.querySelector(`[data-${prefix}-sent="${cat.key}"]`);
    const invEl = document.querySelector(`[data-${prefix}-invoiced="${cat.key}"]`);
    const conEl = document.querySelector(`[data-${prefix}-contracted="${cat.key}"]`);
    out[cat.key] = {
      budgetWan: Number(budgetEl?.value) || 0,
      sent: wanToYuan(sentEl?.value),
      invoiced: wanToYuan(invEl?.value),
      contracted: wanToYuan(conEl?.value),
    };
  });
  return out;
}

function renderOwnerTable() {
  const table = document.getElementById('ownerBudgetTable');
  const cats = current.project.ownerCategories || [];
  const rows = current.project.ownerRows || {};
  const siteName = current.siteName || '';
  document.getElementById('ownerSiteLabel').textContent = siteName ? `｜${siteName}` : '';
  const head = `<thead><tr>
    <th class="budget-stub">${escapeHtml(siteName || '項目')}</th>
    ${cats.map((c) => `<th>${escapeHtml(c.label)}</th>`).join('')}
  </tr></thead>`;
  const budgetCells = cats.map((c) => {
    const wan = (c.kind === 'rate' || c.kind === 'rate_sum')
      ? calcRateWan(c.ratePct)
      : (rows[c.key]?.budgetWan ?? 0);
    const ro = (c.kind === 'rate' || c.kind === 'rate_sum') ? 'readonly' : '';
    return `<td><input type="number" step="0.01" ${ro} data-owner-budget="${c.key}" value="${fmtWan(wan)}"></td>`;
  }).join('');
  const contractedCells = cats.map((c) => {
    const val = yuanToWan(rows[c.key]?.contracted);
    return `<td><input type="number" step="0.01" class="budget-hot" data-owner-contracted="${c.key}" value="${fmtWan(val)}"></td>`;
  }).join('');
  const invoicedCells = cats.map((c) => {
    const val = yuanToWan(rows[c.key]?.invoiced);
    return `<td><input type="number" step="0.01" data-owner-invoiced="${c.key}" value="${fmtWan(val)}"></td>`;
  }).join('');
  const remainCells = cats.map((c) => {
    const remain = yuanToWan(rows[c.key]?.remainContract);
    return `<td class="${moneyClass(remain)}" data-owner-remain="${c.key}">${fmtWan(remain)}</td>`;
  }).join('');
  table.innerHTML = `${head}<tbody>
    <tr><th>預算（萬）</th>${budgetCells}</tr>
    <tr><th>已發包金額（萬）</th>${contractedCells}</tr>
    <tr><th>已請款金額（萬）</th>${invoicedCells}</tr>
    <tr><th>尚可發包（萬）</th>${remainCells}</tr>
  </tbody>`;
}

function renderExecTable() {
  const table = document.getElementById('execBudgetTable');
  const cats = current.project.execCategories || [];
  const rows = current.project.execRows || {};
  const siteName = current.siteName || '';
  document.getElementById('execSiteLabel').textContent = siteName ? `｜${siteName}` : '';
  const head = `<thead><tr>
    <th class="budget-stub">${escapeHtml(siteName || '項目')}</th>
    ${cats.map((c) => `<th${c.key === 'total' ? ' class="budget-total-col"' : ''}>${escapeHtml(c.label)}</th>`).join('')}
  </tr></thead>`;
  const budgetCells = cats.map((c) => {
    const wan = (c.kind === 'rate' || c.kind === 'rate_sum')
      ? calcRateWan(c.ratePct)
      : (rows[c.key]?.budgetWan ?? 0);
    const ro = (c.kind === 'rate' || c.kind === 'rate_sum') ? 'readonly' : '';
    const highlight = totalColClass(c.key);
    return `<td class="${highlight}">${wanInput('exec', 'budget', c.key, wan, '', ro === 'readonly')}</td>`;
  }).join('');
  const contractedCells = cats.map((c) => {
    const val = yuanToWan(rows[c.key]?.contracted);
    const highlight = totalColClass(c.key);
    const summed = isSumCat(c);
    return `<td class="${highlight}">${wanInput('exec', 'contracted', c.key, val, 'budget-hot', summed)}</td>`;
  }).join('');
  const invCells = cats.map((c) => {
    const val = yuanToWan(rows[c.key]?.invoiced);
    const highlight = totalColClass(c.key);
    const summed = isSumCat(c);
    return `<td class="${highlight}">${wanInput('exec', 'invoiced', c.key, val, '', summed)}</td>`;
  }).join('');
  const remainCells = cats.map((c) => {
    const remain = yuanToWan(rows[c.key]?.remainContract);
    const highlight = totalColClass(c.key, moneyClass(remain));
    return `<td class="${highlight}" data-exec-remain="${c.key}">${fmtWan(remain)}</td>`;
  }).join('');
  table.innerHTML = `${head}<tbody>
    <tr><th>預算（萬）</th>${budgetCells}</tr>
    <tr><th>已發包金額（萬）</th>${contractedCells}</tr>
    <tr><th>已請款金額（萬）</th>${invCells}</tr>
    <tr><th>尚可發包（萬）</th>${remainCells}</tr>
  </tbody>`;
}

function applyReferralColumn(show) {
  if (!current?.project) return;
  const cats = (current.project.execCategories || []).filter((c) => c.key !== 'referral');
  if (show) cats.push({ ...REFERRAL_CAT });
  current.project.execCategories = cats;
  current.project.showReferralFee = show;
  current.project.execRows = current.project.execRows || {};
  current.project.execRows.referral = current.project.execRows.referral || {
    budgetWan: 0, contracted: 0, invoiced: 0, remainContract: 0,
  };
  renderExecTable();
  refreshDerived();
}

function renderPie() {
  const cats = current.project.execCategories || [];
  const slices = [];
  cats.forEach((c) => {
    if (!c.inPie) return;
    const invoiced = Number(document.querySelector(`[data-exec-invoiced="${c.key}"]`)?.value) || 0;
    const wan = invoiced;
    if (wan > 0) slices.push({ label: c.label, wan, invoiced: wanToYuan(invoiced) });
  });
  const total = slices.reduce((s, x) => s + x.wan, 0);
  const svg = document.getElementById('budgetPie');
  const legend = document.getElementById('budgetPieLegend');
  if (!total) {
    svg.innerHTML = '<text x="160" y="160" text-anchor="middle" fill="#64748b">尚無已請款可繪圖</text>';
    legend.innerHTML = '';
    return;
  }
  let angle = -Math.PI / 2;
  const cx = 160;
  const cy = 160;
  const r = 132;
  const paths = [];
  slices.forEach((slice, idx) => {
    const frac = slice.wan / total;
    const next = angle + frac * Math.PI * 2;
    const x1 = cx + r * Math.cos(angle);
    const y1 = cy + r * Math.sin(angle);
    const x2 = cx + r * Math.cos(next);
    const y2 = cy + r * Math.sin(next);
    const large = frac > 0.5 ? 1 : 0;
    const color = PIE_COLORS[idx % PIE_COLORS.length];
    paths.push(`<path d="M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z" fill="${color}"></path>`);
    const mid = angle + (next - angle) / 2;
    const lx = cx + r * 0.58 * Math.cos(mid);
    const ly = cy + r * 0.58 * Math.sin(mid);
    const pct = Math.round(frac * 100);
    paths.push(`<text x="${lx}" y="${ly}" text-anchor="middle" font-size="11" fill="#fff">${pct}%</text>`);
    angle = next;
  });
  svg.innerHTML = paths.join('');
  legend.innerHTML = slices.map((slice, idx) => `
    <li>
      <span class="swatch" style="background:${PIE_COLORS[idx % PIE_COLORS.length]}"></span>
      ${escapeHtml(slice.label)}
      <strong>${fmtWan(slice.wan)} 萬</strong>
      （${total ? Math.round(slice.wan / total * 100) : 0}%）
    </li>
  `).join('');
}

function readExtraItems() {
  return extraItems.map((item) => ({
    key: item.key,
    label: document.querySelector(`[data-week-extra-label="${item.key}"]`)?.value.trim() || item.label,
    amount: Number(document.querySelector(`[data-week-extra="${item.key}"]`)?.value) || 0,
  }));
}

function renderWeekExtras() {
  const wrap = document.getElementById('weekExtraList');
  const mediaLine = `<div class="budget-extra-row budget-extra-fixed">
    <span>媒體</span>
    <strong data-week-media-sum>0</strong>
  </div>`;
  const rows = extraItems.map((line) => `<div class="budget-extra-row" data-extra-key="${escapeHtml(line.key)}">
      <input type="text" data-week-extra-label="${escapeHtml(line.key)}" value="${escapeHtml(line.label || '')}" placeholder="項目名稱">
      <input type="number" step="1" data-week-extra="${escapeHtml(line.key)}" value="${line.amount || 0}">
      <button type="button" class="link-btn" data-extra-del="${escapeHtml(line.key)}">刪</button>
    </div>`).join('');
  wrap.innerHTML = mediaLine + rows;
}

function photoKindLabel(kind) {
  return kind === 'map' ? '點位圖' : '媒體照';
}

function renderPhotoBlock(item, idx) {
  const photos = item.photos || [];
  const thumbs = photos.map((p) => `
    <figure class="budget-photo-card">
      <a href="${escapeHtml(p.url)}" target="_blank" rel="noopener">
        <img src="${escapeHtml(p.url)}" alt="${escapeHtml(p.caption || item.name)}">
      </a>
      <figcaption title="${escapeHtml(p.caption || p.filename || '')}">
        <span class="budget-photo-kind">${photoKindLabel(p.kind)}</span>
        <span class="budget-photo-caption">${escapeHtml(p.caption || p.filename || '')}</span>
      </figcaption>
      <button type="button" class="link-btn" data-photo-del="${idx}" data-photo-id="${escapeHtml(p.id)}">刪照片</button>
    </figure>
  `).join('');
  return `<div class="budget-photo-row">
    ${thumbs}
    <div class="budget-photo-upload">
      <select data-photo-kind="${idx}">
        <option value="media">媒體照</option>
        <option value="map">點位分布圖</option>
      </select>
      <input type="text" data-photo-caption="${idx}" placeholder="編號／點位／金額（選填）">
      <label class="btn btn-outline budget-file-btn">
        附照片
        <input type="file" accept="image/*" data-photo-upload="${idx}" hidden>
      </label>
    </div>
  </div>`;
}

function renderMediaTable() {
  const tbody = document.querySelector('#weekMediaTable tbody');
  const tfoot = document.querySelector('#weekMediaTable tfoot');
  tbody.innerHTML = mediaItems.map((item, idx) => {
    const active = /[-~至到]|^\d/.test(item.status || '');
    return `<tr>
      <td><input type="text" data-media-name="${idx}" value="${escapeHtml(item.name)}"></td>
      <td><input type="text" class="${active ? 'status-on' : ''}" data-media-status="${idx}" value="${escapeHtml(item.status || '')}"></td>
      <td><input type="number" step="1" data-media-week="${idx}" value="${item.weekCost || 0}"></td>
      <td class="cell-cum">${fmtYuan(item.cumulative || 0)}</td>
      <td><input type="number" step="1" data-media-opening="${idx}" value="${item.openingCumulative || 0}"></td>
      <td><button type="button" class="link-btn" data-media-del="${idx}">刪</button></td>
    </tr>
    <tr class="budget-photo-tr"><td colspan="6">${renderPhotoBlock(item, idx)}</td></tr>`;
  }).join('');
  const weekSum = mediaItems.reduce((s, i) => s + (Number(i.weekCost) || 0), 0);
  const cumSum = mediaItems.reduce((s, i) => s + (Number(i.cumulative) || 0), 0);
  tfoot.innerHTML = `<tr>
    <th colspan="2">週總計(元)</th>
    <th class="cell-cum">${fmtYuan(weekSum)}</th>
    <th class="cell-cum">${fmtYuan(cumSum)}</th>
    <th></th><th></th>
  </tr>`;
  renderPhotoGallery();
  fillMediaPreset();
}

function renderPhotoGallery() {
  const wrap = document.getElementById('mediaPhotoGallery');
  const groups = mediaItems
    .map((item) => ({ name: item.name, photos: item.photos || [] }))
    .filter((g) => g.photos.length);
  if (!groups.length) {
    wrap.innerHTML = '';
    return;
  }
  wrap.innerHTML = `<h4 class="section-title">本週上刊照片</h4>
    ${groups.map((g) => `<div class="budget-photo-group">
      <h5>${escapeHtml(g.name)}</h5>
      <div class="budget-photo-grid">
        ${g.photos.map((p) => `
          <figure class="budget-photo-card">
            <a href="${escapeHtml(p.url)}" target="_blank" rel="noopener">
              <img src="${escapeHtml(p.url)}" alt="${escapeHtml(p.caption || g.name)}">
            </a>
            <figcaption title="${escapeHtml(p.caption || '')}">${photoKindLabel(p.kind)} ${escapeHtml(p.caption || '')}</figcaption>
          </figure>
        `).join('')}
      </div>
    </div>`).join('')}`;
}

function fillMediaPreset() {
  const sel = document.getElementById('mediaPreset');
  const used = new Set(mediaItems.map((i) => i.name));
  const options = (mediaPresets.length ? mediaPresets : []).filter((n) => !used.has(n));
  sel.innerHTML = `<option value="">選擇基本媒體…</option>`
    + options.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
}

function refreshDerived() {
  if (!current) return;
  syncRateLabels();
  const ownerCats = current.project.ownerCategories || [];
  ownerCats.forEach((c) => {
    const budgetEl = document.querySelector(`[data-owner-budget="${c.key}"]`);
    if (budgetEl && (c.kind === 'rate' || c.kind === 'rate_sum')) {
      budgetEl.value = fmtWan(calcRateWan(c.ratePct));
    }
    const wan = Number(budgetEl?.value) || 0;
    const contracted = Number(document.querySelector(`[data-owner-contracted="${c.key}"]`)?.value) || 0;
    const remainEl = document.querySelector(`[data-owner-remain="${c.key}"]`);
    if (remainEl) {
      const remain = wan - contracted;
      remainEl.textContent = fmtWan(remain);
      remainEl.className = moneyClass(remain);
    }
  });
  const execCats = current.project.execCategories || [];
  execCats.forEach((c) => {
    const ths = document.querySelectorAll('#execBudgetTable thead th');
    const idx = execCats.findIndex((x) => x.key === c.key);
    if (ths[idx + 1]) ths[idx + 1].textContent = c.label;
    const budgetEl = document.querySelector(`[data-exec-budget="${c.key}"]`);
    if (budgetEl && (c.kind === 'rate' || c.kind === 'rate_sum')) {
      budgetEl.value = fmtWan(calcRateWan(c.ratePct));
    }
    const wan = Number(budgetEl?.value) || 0;
    let contracted = Number(document.querySelector(`[data-exec-contracted="${c.key}"]`)?.value) || 0;
    let invoiced = Number(document.querySelector(`[data-exec-invoiced="${c.key}"]`)?.value) || 0;
    if (c.key === 'salesFee') {
      const keys = execManualKeys();
      contracted = keys.reduce((s, k) => s + execAmountWan('contracted', k), 0);
      invoiced = keys.reduce((s, k) => s + execAmountWan('invoiced', k), 0);
      const conEl = document.querySelector('[data-exec-contracted="salesFee"]');
      const invEl = document.querySelector('[data-exec-invoiced="salesFee"]');
      if (conEl) conEl.value = fmtWan(contracted);
      if (invEl) invEl.value = fmtWan(invoiced);
    } else if (c.key === 'total') {
      contracted = execAmountWan('contracted', 'salesFee') + execAmountWan('contracted', 'reward');
      invoiced = execAmountWan('invoiced', 'salesFee') + execAmountWan('invoiced', 'reward');
      const conEl = document.querySelector('[data-exec-contracted="total"]');
      const invEl = document.querySelector('[data-exec-invoiced="total"]');
      if (conEl) conEl.value = fmtWan(contracted);
      if (invEl) invEl.value = fmtWan(invoiced);
    }
    const remainEl = document.querySelector(`[data-exec-remain="${c.key}"]`);
    if (remainEl) {
      const remain = wan - contracted;
      remainEl.textContent = fmtWan(remain);
      remainEl.className = totalColClass(c.key, moneyClass(remain));
    }
  });
  const ownerThs = document.querySelectorAll('#ownerBudgetTable thead th');
  ownerCats.forEach((c, idx) => {
    if (ownerThs[idx + 1]) ownerThs[idx + 1].textContent = c.label;
  });
  renderPie();
  refreshWeekTotals();
}

function readMediaItems() {
  return mediaItems.map((item, idx) => {
    const opening = Number(document.querySelector(`[data-media-opening="${idx}"]`)?.value) || 0;
    const weekCost = Number(document.querySelector(`[data-media-week="${idx}"]`)?.value) || 0;
    const priorWithoutOpening = Number(item.cumulative || 0)
      - Number(item.weekCost || 0)
      - Number(item.openingCumulative || 0);
    return {
      name: document.querySelector(`[data-media-name="${idx}"]`)?.value.trim() || item.name,
      status: document.querySelector(`[data-media-status="${idx}"]`)?.value.trim() || '',
      weekCost,
      openingCumulative: opening,
      cumulative: opening + Math.max(priorWithoutOpening, 0) + weekCost,
      photos: Array.isArray(item.photos) ? item.photos : [],
    };
  });
}

function refreshWeekTotals() {
  extraItems = readExtraItems();
  mediaItems = readMediaItems();
  const weekSum = mediaItems.reduce((s, i) => s + (Number(i.weekCost) || 0), 0);
  const cumSum = mediaItems.reduce((s, i) => s + (Number(i.cumulative) || 0), 0);
  document.querySelectorAll('[data-week-media-sum]').forEach((el) => {
    el.textContent = fmtYuan(weekSum);
  });
  const extraSum = extraItems.reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const grand = weekSum + extraSum;
  document.getElementById('weekGrandTotal').textContent = fmtWan(grand / WAN);
  const tfoot = document.querySelector('#weekMediaTable tfoot');
  if (tfoot) {
    tfoot.innerHTML = `<tr>
      <th colspan="2">週總計(元)</th>
      <th class="cell-cum">${fmtYuan(weekSum)}</th>
      <th class="cell-cum">${fmtYuan(cumSum)}</th>
      <th></th><th></th>
    </tr>`;
  }
  document.querySelectorAll('[data-media-week]').forEach((el) => {
    const idx = Number(el.getAttribute('data-media-week'));
    const td = el.closest('tr')?.querySelector('.cell-cum');
    if (td) td.textContent = fmtYuan(mediaItems[idx]?.cumulative || 0);
  });
}

function renderAll(payload) {
  current = payload;
  mediaPresets = payload.mediaPresets || mediaPresets;
  document.getElementById('budgetEmpty').classList.add('hidden');
  document.getElementById('budgetWorkspace').classList.remove('hidden');
  document.getElementById('salesBaseWan').value = payload.project.salesBaseWan || 0;
  document.getElementById('salesFeePct').value = payload.project.salesFeePct || 2.375;
  document.getElementById('rewardPct').value = payload.project.rewardPct || 1;
  document.getElementById('ownerBudgetPct').value = payload.project.ownerBudgetPct || 2.375;
  document.getElementById('showReferralFee').checked = !!payload.project.showReferralFee;
  const ownerCb = document.getElementById('showOwnerBudget');
  if (ownerCb) ownerCb.checked = !!payload.project.showOwnerBudget;
  document.getElementById('ownerBudgetSection')?.classList.toggle('hidden', !payload.project.showOwnerBudget);
  document.getElementById('budgetWeekStart').value = payload.weekStart;
  updateWeekLabel(payload);
  mediaItems = (payload.week.mediaItems || []).map((item) => ({
    ...item,
    photos: Array.isArray(item.photos) ? item.photos : [],
  }));
  extraItems = (payload.week.extraItems || payload.week.extraLines || [])
    .filter((line) => !line.fromTable && line.key !== 'media')
    .map((line) => ({
      key: line.key,
      label: line.label,
      amount: line.amount || 0,
    }));
  renderOwnerTable();
  renderExecTable();
  renderWeekExtras();
  renderMediaTable();
  refreshDerived();
}

function collectPayload() {
  const project = current.project;
  extraItems = readExtraItems();
  const extras = {};
  extraItems.forEach((item) => { extras[item.key] = item.amount; });
  const items = readMediaItems();
  return {
    siteId: document.getElementById('budgetSite').value,
    weekStart: mondayOf(document.getElementById('budgetWeekStart').value),
    project: {
      salesBaseWan: salesBase(),
      salesFeePct: Number(document.getElementById('salesFeePct').value) || 0,
      rewardPct: Number(document.getElementById('rewardPct').value) || 0,
      ownerBudgetPct: Number(document.getElementById('ownerBudgetPct').value) || 0,
      showReferralFee: document.getElementById('showReferralFee').checked,
      showOwnerBudget: !!document.getElementById('showOwnerBudget')?.checked,
      ownerCategories: project.ownerCategories,
      execCategories: project.execCategories,
      weekExtraFields: extraItems.map((i) => ({ key: i.key, label: i.label })),
      owner: readGridInputs('owner', project.ownerCategories || []),
      exec: readGridInputs('exec', project.execCategories || []),
      mediaCatalog: items.map((i) => ({
        name: i.name,
        status: i.status,
        openingCumulative: i.openingCumulative,
      })),
    },
    week: {
      extras,
      extraItems,
      mediaItems: items,
    },
  };
}

async function loadBudget() {
  const siteId = document.getElementById('budgetSite').value;
  const weekStart = mondayOf(document.getElementById('budgetWeekStart').value);
  document.getElementById('budgetWeekStart').value = weekStart;
  if (!siteId || !weekStart) {
    showToast('請選擇案場與週次', 'error');
    return;
  }
  try {
    const res = await fetch(`/api/budget?siteId=${encodeURIComponent(siteId)}&weekStart=${encodeURIComponent(weekStart)}`);
    const json = await res.json();
    if (!res.ok) {
      showToast(json.error || '載入失敗', 'error');
      return;
    }
    renderAll(json);
    showToast('已載入預算花費');
  } catch (err) {
    showToast(err?.message ? `載入失敗：${err.message}` : '載入失敗', 'error');
  }
}

async function saveBudget() {
  if (!current) {
    showToast('請先載入', 'error');
    return;
  }
  try {
    const res = await fetch('/api/budget', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(collectPayload()),
    });
    const json = await res.json();
    if (!res.ok) {
      showToast(json.error || '儲存失敗', 'error');
      return;
    }
    renderAll(json);
    showToast('已儲存預算花費');
  } catch {
    showToast('儲存失敗', 'error');
  }
}

function addMedia(name) {
  const trimmed = (name || '').trim();
  if (!trimmed) {
    showToast('請輸入媒體名稱', 'error');
    return;
  }
  mediaItems = readMediaItems();
  extraItems = readExtraItems();
  if (mediaItems.some((i) => i.name === trimmed)) {
    showToast('這個媒體項目已在表上', 'error');
    return;
  }
  mediaItems.push({
    name: trimmed,
    status: '',
    weekCost: 0,
    openingCumulative: 0,
    cumulative: 0,
    photos: [],
  });
  renderMediaTable();
  refreshWeekTotals();
}

async function uploadPhoto(idx, file) {
  if (!file) return;
  mediaItems = readMediaItems();
  extraItems = readExtraItems();
  const kind = document.querySelector(`[data-photo-kind="${idx}"]`)?.value || 'media';
  const caption = document.querySelector(`[data-photo-caption="${idx}"]`)?.value.trim() || '';
  const body = new FormData();
  body.append('siteId', document.getElementById('budgetSite').value);
  body.append('weekStart', mondayOf(document.getElementById('budgetWeekStart').value));
  body.append('kind', kind);
  body.append('caption', caption);
  body.append('file', file);
  try {
    const res = await fetch('/api/budget/photo', { method: 'POST', body });
    const json = await res.json();
    if (!res.ok) {
      showToast(json.error || '上傳失敗', 'error');
      return;
    }
    mediaItems[idx].photos = [...(mediaItems[idx].photos || []), json.photo];
    renderMediaTable();
    refreshWeekTotals();
    showToast('已附上照片，記得按儲存');
  } catch {
    showToast('上傳失敗', 'error');
  }
}

async function deletePhoto(idx, photoId) {
  mediaItems = readMediaItems();
  extraItems = readExtraItems();
  const photo = (mediaItems[idx]?.photos || []).find((p) => p.id === photoId);
  if (!photo) return;
  try {
    await fetch('/api/budget/photo', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        siteId: document.getElementById('budgetSite').value,
        path: photo.path,
      }),
    });
  } catch { /* ignore */ }
  mediaItems[idx].photos = (mediaItems[idx].photos || []).filter((p) => p.id !== photoId);
  renderMediaTable();
  refreshWeekTotals();
}

async function init() {
  for (let i = 0; i < 50 && !window.navReady; i += 1) {
    await new Promise((r) => setTimeout(r, 20));
  }
  if (window.navReady) await window.navReady;
  if (!window.currentUser) {
    window.location.replace('/login.html?next=/budget.html');
    return;
  }
  if (!(window.currentUser.permissions || []).includes('manage_weekly_reports')) {
    showToast('沒有權限', 'error');
    setTimeout(() => { window.location.replace('/'); }, 1200);
    return;
  }
  await loadSites();
  try {
    const siteId = document.getElementById('budgetSite').value;
    const qs = siteId ? `?siteId=${encodeURIComponent(siteId)}` : '';
    const res = await fetch(`/api/weekly/meta${qs}`);
    if (res.ok) {
      const json = await res.json();
      document.getElementById('budgetWeekStart').value = json.defaultWeekStart;
      updateWeekLabel({
        weekNumber: json.defaultWeekNumber,
        rocLabel: json.rocLabel,
      });
    }
  } catch { /* ignore */ }

  document.getElementById('loadBudgetBtn').addEventListener('click', loadBudget);
  document.getElementById('saveBudgetBtn').addEventListener('click', saveBudget);
  document.getElementById('prevBudgetWeekBtn').addEventListener('click', async () => {
    const cur = document.getElementById('budgetWeekStart').value;
    if (!cur) return;
    document.getElementById('budgetWeekStart').value = shiftWeek(mondayOf(cur), -7);
    await loadBudget();
  });
  document.getElementById('nextBudgetWeekBtn').addEventListener('click', async () => {
    const cur = document.getElementById('budgetWeekStart').value;
    if (!cur) return;
    document.getElementById('budgetWeekStart').value = shiftWeek(mondayOf(cur), 7);
    await loadBudget();
  });
  document.getElementById('budgetSite').addEventListener('change', () => {
    if (document.getElementById('budgetSite').value) loadBudget();
  });
  ['salesBaseWan', 'salesFeePct', 'rewardPct', 'ownerBudgetPct'].forEach((id) => {
    document.getElementById(id).addEventListener('input', refreshDerived);
  });
  document.getElementById('showReferralFee').addEventListener('change', (e) => {
    applyReferralColumn(e.target.checked);
  });
  document.getElementById('showOwnerBudget').addEventListener('change', (e) => {
    if (current?.project) current.project.showOwnerBudget = e.target.checked;
    document.getElementById('ownerBudgetSection').classList.toggle('hidden', !e.target.checked);
  });
  document.getElementById('budgetWorkspace').addEventListener('input', (e) => {
    if (e.target.matches('input') && e.target.type !== 'file') refreshDerived();
  });
  document.getElementById('addMediaItemBtn').addEventListener('click', () => {
    addMedia(document.getElementById('customMediaName').value);
    document.getElementById('customMediaName').value = '';
  });
  document.getElementById('addPresetMediaBtn').addEventListener('click', () => {
    addMedia(document.getElementById('mediaPreset').value);
  });
  document.getElementById('addWeekExtraBtn').addEventListener('click', () => {
    extraItems = readExtraItems();
    extraItems.push({
      key: `extra_${Date.now()}`,
      label: `雜項${extraItems.length + 1}`,
      amount: 0,
    });
    renderWeekExtras();
    refreshWeekTotals();
  });
  document.getElementById('weekExtraList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-extra-del]');
    if (!btn) return;
    const key = btn.getAttribute('data-extra-del');
    extraItems = readExtraItems().filter((item) => item.key !== key);
    renderWeekExtras();
    refreshWeekTotals();
  });
  document.getElementById('weekMediaTable').addEventListener('click', (e) => {
    const delMedia = e.target.closest('[data-media-del]');
    if (delMedia) {
      const idx = Number(delMedia.getAttribute('data-media-del'));
      mediaItems = readMediaItems().filter((_, i) => i !== idx);
      renderMediaTable();
      refreshWeekTotals();
      return;
    }
    const delPhoto = e.target.closest('[data-photo-del]');
    if (delPhoto) {
      deletePhoto(Number(delPhoto.getAttribute('data-photo-del')), delPhoto.getAttribute('data-photo-id'));
    }
  });
  document.getElementById('weekMediaTable').addEventListener('change', (e) => {
    const input = e.target.closest('[data-photo-upload]');
    if (!input) return;
    const idx = Number(input.getAttribute('data-photo-upload'));
    const file = input.files && input.files[0];
    input.value = '';
    uploadPhoto(idx, file);
  });
  if (document.getElementById('budgetSite').value && document.getElementById('budgetWeekStart').value) {
    loadBudget();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { init(); });
} else {
  init();
}
