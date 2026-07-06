let roles = [];
let sites = [];
let users = [];

function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast ${type}`;
  setTimeout(() => toast.classList.add('hidden'), 3500);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderRoleSelect(selectEl, selected = '') {
  selectEl.innerHTML = roles.map((r) =>
    `<option value="${r.id}" ${r.id === selected ? 'selected' : ''}>${escapeHtml(r.label)}</option>`,
  ).join('');
}

function renderSiteChecks(container, selectedIds = []) {
  const set = new Set(selectedIds);
  container.innerHTML = sites.map((s) => `
    <label class="checkbox-label">
      <input type="checkbox" value="${s.id}" ${set.has(s.id) ? 'checked' : ''}>
      ${escapeHtml(s.name)}
    </label>
  `).join('');
}

function getCheckedSiteIds(container) {
  return Array.from(container.querySelectorAll('input:checked')).map((cb) => cb.value);
}

function siteNames(ids) {
  if (!ids || ids.length === 0) return '—';
  return ids.map((id) => sites.find((s) => s.id === id)?.name || id).join('、');
}

async function loadMeta() {
  const [rolesRes, sitesRes] = await Promise.all([
    fetch('/api/auth/roles'),
    fetch('/api/sites'),
  ]);
  const rolesJson = await rolesRes.json();
  sites = await sitesRes.json();
  roles = rolesJson.roles || [];
  renderRoleSelect(document.getElementById('newRole'));
  renderRoleSelect(document.getElementById('editRole'));
  renderSiteChecks(document.getElementById('newSiteChecks'));
}

async function loadUsers() {
  const res = await fetch('/api/users');
  if (!res.ok) {
    document.getElementById('usersBody').innerHTML =
      '<tr><td colspan="6" class="empty-row">無法載入人員列表</td></tr>';
    return;
  }
  users = await res.json();
  const tbody = document.getElementById('usersBody');
  if (users.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-row">尚無人員</td></tr>';
    return;
  }
  tbody.innerHTML = users.map((u) => `
    <tr>
      <td>${escapeHtml(u.username)}</td>
      <td>${escapeHtml(u.displayName)}</td>
      <td>${escapeHtml(u.roleLabel)}</td>
      <td>${escapeHtml(siteNames(u.siteIds))}</td>
      <td>${u.isActive ? '啟用' : '<span class="hint">停用</span>'}</td>
      <td><button class="btn-sm" onclick="openEditUser(${u.id})">編輯</button></td>
    </tr>
  `).join('');
}

window.openEditUser = function (id) {
  const user = users.find((u) => u.id === id);
  if (!user) return;
  document.getElementById('editUserId').value = user.id;
  document.getElementById('editUsername').value = user.username;
  document.getElementById('editDisplayName').value = user.displayName;
  document.getElementById('editRole').value = user.role;
  document.getElementById('editIsActive').value = user.isActive ? '1' : '0';
  document.getElementById('editPassword').value = '';
  renderSiteChecks(document.getElementById('editSiteChecks'), user.siteIds);
  document.getElementById('editUserModal').classList.remove('hidden');
};

document.getElementById('addUserForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    username: document.getElementById('newUsername').value.trim(),
    password: document.getElementById('newPassword').value,
    displayName: document.getElementById('newDisplayName').value.trim(),
    role: document.getElementById('newRole').value,
    siteIds: getCheckedSiteIds(document.getElementById('newSiteChecks')),
  };
  const res = await fetch('/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) {
    showToast(json.error || '新增失敗', 'error');
    return;
  }
  showToast('人員已新增');
  e.target.reset();
  renderSiteChecks(document.getElementById('newSiteChecks'));
  loadUsers();
});

document.getElementById('editUserForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('editUserId').value;
  const body = {
    displayName: document.getElementById('editDisplayName').value.trim(),
    role: document.getElementById('editRole').value,
    isActive: document.getElementById('editIsActive').value === '1',
    siteIds: getCheckedSiteIds(document.getElementById('editSiteChecks')),
  };
  const pwd = document.getElementById('editPassword').value;
  if (pwd) body.password = pwd;

  const res = await fetch(`/api/users/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) {
    showToast(json.error || '儲存失敗', 'error');
    return;
  }
  showToast('已儲存');
  document.getElementById('editUserModal').classList.add('hidden');
  loadUsers();
});

document.getElementById('closeEditUser').addEventListener('click', () => {
  document.getElementById('editUserModal').classList.add('hidden');
});
document.getElementById('cancelEditUser').addEventListener('click', () => {
  document.getElementById('editUserModal').classList.add('hidden');
});

loadMeta().then(loadUsers);
