const GROUP_LABELS = { residential: '住宅建案', commercial: '商用不動產' };

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function loadSites() {
  const tbody = document.getElementById('sitesBody');
  try {
    const res = await fetch('/api/sites');
    const sites = await res.json();
    if (sites.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" class="empty-row">沒有可管理的案場</td></tr>';
      return;
    }
    tbody.innerHTML = sites.map((s) => `
      <tr>
        <td><strong>${escapeHtml(s.name)}</strong></td>
        <td>${GROUP_LABELS[s.group] || s.group}</td>
        <td>
          <a href="/site-fields.html?site=${encodeURIComponent(s.id)}" class="btn-sm">設定欄位選項</a>
        </td>
      </tr>
    `).join('');
  } catch {
    tbody.innerHTML = '<tr><td colspan="3" class="empty-row">載入失敗</td></tr>';
  }
}

async function boot() {
  if (window.navReady) await window.navReady;
  await loadSites();
}
boot();
