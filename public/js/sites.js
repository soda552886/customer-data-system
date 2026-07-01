const GROUP_LABELS = { residential: '住宅建案', commercial: '商用不動產' };

function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast ${type}`;
  setTimeout(() => toast.classList.add('hidden'), 3500);
}

async function loadSitesList() {
  const tbody = document.getElementById('sitesBody');
  try {
    const res = await fetch('/api/sites');
    const sites = await res.json();
    document.getElementById('siteCount').textContent = `${sites.length} 個`;

    if (sites.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-row">尚無案場，請上方新增</td></tr>';
      return;
    }

    tbody.innerHTML = sites.map((s) => {
      const count = s.customer_count || 0;
      const canDelete = count === 0;
      const created = s.created_at ? s.created_at.slice(0, 10) : '-';
      return `<tr>
        <td><strong>${escapeHtml(s.name)}</strong></td>
        <td>${GROUP_LABELS[s.group] || s.group}</td>
        <td>${count} 筆</td>
        <td>${created}</td>
        <td>${canDelete
          ? `<button class="btn-sm btn-danger-sm" onclick="deleteSite('${s.id}', '${escapeAttr(s.name)}')">刪除</button>`
          : '<span class="hint">有資料不可刪</span>'
        }</td>
      </tr>`;
    }).join('');
  } catch {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-row">載入失敗</td></tr>';
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  return String(str).replace(/'/g, "\\'");
}

window.deleteSite = async function (id, name) {
  if (!confirm(`確定要刪除案場「${name}」？`)) return;
  try {
    const res = await fetch(`/api/sites/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (res.ok) {
      showToast('案場已刪除');
      loadSitesList();
    } else {
      showToast(json.error || '刪除失敗', 'error');
    }
  } catch {
    showToast('刪除失敗', 'error');
  }
};

document.getElementById('addSiteForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('siteName').value.trim();
  const group = document.getElementById('siteGroup').value;
  if (!name) return;

  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;

  try {
    const res = await fetch('/api/sites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, group }),
    });
    const json = await res.json();
    if (res.ok) {
      showToast(`已新增案場：${name}`);
      document.getElementById('siteName').value = '';
      loadSitesList();
    } else {
      showToast(json.error || '新增失敗', 'error');
    }
  } catch {
    showToast('新增失敗', 'error');
  } finally {
    btn.disabled = false;
  }
});

loadSitesList();
