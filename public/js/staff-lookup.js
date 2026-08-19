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
  const sel = document.getElementById('lookupSite');
  const res = await fetch('/api/sites');
  const sites = await res.json();
  sel.innerHTML = '<option value="">請選擇案場</option>';
  (sites || []).forEach((s) => sel.appendChild(new Option(s.name, s.id)));
}

async function loadStaff() {
  const siteId = document.getElementById('lookupSite').value;
  const sel = document.getElementById('lookupStaff');
  sel.innerHTML = '<option value="">請選擇銷售人員</option>';
  if (!siteId) return;
  const [fieldsRes, lookupRes] = await Promise.all([
    fetch(`/api/fields?siteId=${encodeURIComponent(siteId)}`),
    fetch(`/api/customers/staff-lookup?siteId=${encodeURIComponent(siteId)}`),
  ]);
  const fields = fieldsRes.ok ? await fieldsRes.json() : {};
  const lookup = lookupRes.ok ? await lookupRes.json() : {};
  const names = new Set();
  const staffMap = fields.salesStaff || {};
  const fromFields = Array.isArray(staffMap) ? staffMap : (staffMap[siteId] || []);
  fromFields.forEach((n) => names.add(n));
  (lookup.staff || []).forEach((n) => names.add(n));
  [...names].filter(Boolean).sort().forEach((n) => sel.appendChild(new Option(n, n)));
}

async function runLookup() {
  const siteId = document.getElementById('lookupSite').value;
  const salesperson = document.getElementById('lookupStaff').value;
  if (!siteId || !salesperson) {
    showToast('請選擇案場與銷售人員', 'error');
    return;
  }
  const params = new URLSearchParams({ siteId, salesperson });
  const res = await fetch(`/api/customers/staff-lookup?${params}`);
  const json = await res.json();
  const tbody = document.querySelector('#lookupTable tbody');
  const count = document.getElementById('lookupCount');
  if (!res.ok) {
    showToast(json.error || '查詢失敗', 'error');
    return;
  }
  const rows = json.records || [];
  count.textContent = rows.length ? `共 ${rows.length} 筆（僅檢視）` : '';
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty-row">此銷售人員尚無接待紀錄</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map((r) => `
    <tr>
      <td class="cell-date">${escapeHtml(r.visitDate || r.returnVisitDate || '')}</td>
      <td>${escapeHtml(r.visitType || '')}</td>
      <td>${escapeHtml(r.customerName || '')}</td>
      <td>${escapeHtml(r.region || '')}</td>
      <td>${escapeHtml(r.media1 || r.media || '')}</td>
      <td>${escapeHtml(r.occupation || '')}</td>
      <td>${escapeHtml(r.age || '')}</td>
      <td>${escapeHtml(r.sincerity || '')}</td>
      <td class="cell-wrap cell-discussion">${escapeHtml(r.discussion || '')}</td>
      <td>${escapeHtml([r.salesperson1, r.salesperson2].filter(Boolean).join('、'))}</td>
    </tr>
  `).join('');
}

async function boot() {
  if (window.navReady) await window.navReady;
  await loadSites();
  document.getElementById('lookupSite').addEventListener('change', loadStaff);
  document.getElementById('lookupBtn').addEventListener('click', runLookup);
}

boot();
