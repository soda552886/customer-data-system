let sites = [];
let currentPage = 1;

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatLogTime(raw) {
  if (!raw) return '—';
  // DB stores a naive timestamp; treat it as UTC then render in Taipei time.
  const iso = String(raw).trim().replace(' ', 'T');
  const d = new Date(`${iso}Z`);
  if (Number.isNaN(d.getTime())) return String(raw).slice(0, 19);
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(d).replace(/\//g, '-');
}

async function loadSites() {
  const res = await fetch('/api/sites');
  sites = await res.json();
  const sel = document.getElementById('logSite');
  sites.forEach((s) => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.name;
    sel.appendChild(opt);
  });
}

async function loadLogs() {
  const params = new URLSearchParams();
  params.set('page', String(currentPage));
  params.set('limit', '50');
  const siteId = document.getElementById('logSite').value;
  const action = document.getElementById('logAction').value;
  if (siteId) params.set('siteId', siteId);
  if (action) params.set('action', action);

  const res = await fetch(`/api/audit-logs?${params}`);
  const data = await res.json();
  const tbody = document.getElementById('logBody');
  document.getElementById('logCount').textContent = `${data.total || 0} 筆`;

  if (!res.ok || !data.records || data.records.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-row">查無紀錄</td></tr>';
    document.getElementById('logPagination').classList.add('hidden');
    return;
  }

  tbody.innerHTML = data.records.map((r) => `
    <tr>
      <td>${escapeHtml(formatLogTime(r.createdAt))}</td>
      <td>${escapeHtml(r.displayName || r.username || '—')}</td>
      <td>${escapeHtml(r.actionLabel || r.action)}</td>
      <td>${escapeHtml(r.siteName || '—')}</td>
      <td>${escapeHtml(r.summary)}</td>
    </tr>
  `).join('');

  renderPagination(data.total, data.page, data.limit);
}

function renderPagination(total, page, limit) {
  const totalPages = Math.ceil(total / limit);
  const pag = document.getElementById('logPagination');
  if (totalPages <= 1) {
    pag.classList.add('hidden');
    return;
  }
  pag.classList.remove('hidden');
  let html = '';
  if (page > 1) html += `<button type="button" onclick="goLogPage(${page - 1})">上一頁</button>`;
  html += `<span class="hint">第 ${page} / ${totalPages} 頁</span>`;
  if (page < totalPages) html += `<button type="button" onclick="goLogPage(${page + 1})">下一頁</button>`;
  pag.innerHTML = html;
}

window.goLogPage = function (page) {
  currentPage = page;
  loadLogs();
};

document.getElementById('searchLogBtn').addEventListener('click', () => {
  currentPage = 1;
  loadLogs();
});

async function boot() {
  if (window.navReady) await window.navReady;
  await loadSites();
  await loadLogs();
}
boot();
