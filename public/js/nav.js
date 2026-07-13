const NAV_ITEMS = [
  { href: '/', label: '填寫表單', perm: 'submit_form', public: true },
  { href: '/search.html', label: '查看資料', perm: 'view_customers' },
  { href: '/import.html', label: '匯入資料', public: true },
  { href: '/field-options.html', label: '欄位選項', perm: 'manage_field_options' },
  { href: '/audit-log.html', label: '操作紀錄', perm: 'view_audit_logs' },
  { href: '/sites.html', label: '案場管理', perm: 'manage_sites' },
  { href: '/users.html', label: '人員管理', perm: 'manage_users' },
];

window.currentUser = null;

function hasPerm(user, perm) {
  if (!user) return perm === 'submit_form';
  return (user.permissions || []).includes(perm);
}

function renderNav(activePath) {
  const nav = document.getElementById('mainNav');
  if (!nav) return;

  const user = window.currentUser;
  const links = NAV_ITEMS.filter((item) => {
    if (item.public) return true;
    return user && hasPerm(user, item.perm);
  }).map((item) => {
    const active = activePath === item.href ? ' active' : '';
    return `<a href="${item.href}" class="nav-link${active}">${item.label}</a>`;
  }).join('');

  const userArea = user
    ? `<span class="nav-user">${user.displayName}（${user.roleLabel}）</span>
       <button type="button" class="btn-sm nav-logout" id="logoutBtn">登出</button>`
    : `<a href="/login.html" class="nav-link nav-login">登入</a>`;

  nav.innerHTML = links + userArea;

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.href = '/';
    });
  }
}

async function initNav(activePath) {
  try {
    const res = await fetch('/api/auth/me');
    const json = await res.json();
    if (json.authenticated) {
      window.currentUser = json.user;
    }
  } catch { /* ignore */ }
  renderNav(activePath || window.location.pathname);
}

window.navReady = null;

document.addEventListener('DOMContentLoaded', () => {
  window.navReady = initNav(window.location.pathname);
});
