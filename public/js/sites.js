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
      const canDeleteSite = count === 0;
      const created = s.created_at ? s.created_at.slice(0, 10) : '-';
      const clearBtn = count > 0
        ? `<button class="btn-sm btn-danger-sm" onclick="clearSiteData('${s.id}', '${escapeAttr(s.name)}', ${count})">清空資料</button>`
        : '';
      const deleteSiteBtn = canDeleteSite
        ? `<button class="btn-sm btn-danger-sm" onclick="deleteSite('${s.id}', '${escapeAttr(s.name)}')">刪除案場</button>`
        : '';
      const fieldOptionsBtn = `<a href="/site-fields.html?site=${encodeURIComponent(s.id)}" class="btn-sm">欄位選項</a>`;
      const actions = [fieldOptionsBtn, clearBtn, deleteSiteBtn].filter(Boolean).join(' ') || '<span class="hint">—</span>';
      return `<tr>
        <td><strong>${escapeHtml(s.name)}</strong></td>
        <td>${GROUP_LABELS[s.group] || s.group}</td>
        <td>${count} 筆</td>
        <td>${created}</td>
        <td class="action-btns">${actions}</td>
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

window.clearSiteData = async function (id, name, count) {
  if (!confirm(`確定要清空案場「${name}」的全部 ${count} 筆客戶資料？\n案場設定會保留，此操作無法復原。`)) return;

  const typed = prompt('請輸入 DELETE ALL 以確認：');
  if (typed !== 'DELETE ALL') {
    if (typed !== null) showToast('確認碼不正確，已取消', 'error');
    return;
  }

  try {
    const res = await fetch('/api/customers/all', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: 'DELETE ALL', siteId: id }),
    });
    const json = await res.json();
    if (res.ok) {
      showToast(`已清空 ${name}：刪除 ${json.deleted} 筆`);
      loadSitesList();
    } else {
      showToast(json.error || '清空失敗', 'error');
    }
  } catch {
    showToast('清空失敗', 'error');
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
