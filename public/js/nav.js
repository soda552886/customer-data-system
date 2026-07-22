const APP_SWITCHER_ITEMS = [
  { id: 'customers', label: '客資系統', href: '/', match: (path) => path !== '/weekly.html' },
  { id: 'weekly', label: '週報系統', href: '/weekly.html', match: (path) => path === '/weekly.html', perm: 'manage_weekly_reports' },
];

const NAV_ITEMS = [
  { href: '/', label: '填寫表單', perm: 'submit_form', public: true, app: 'customers' },
  { href: '/search.html', label: '查看資料', perm: 'view_customers', app: 'customers' },
  { href: '/import.html', label: '匯入資料', public: true, app: 'customers' },
  { href: '/field-options.html', label: '欄位選項', perm: 'manage_field_options', app: 'customers' },
  { href: '/audit-log.html', label: '操作紀錄', perm: 'view_audit_logs', app: 'customers' },
  { href: '/sites.html', label: '案場管理', perm: 'manage_sites', app: 'customers' },
  { href: '/users.html', label: '人員管理', perm: 'manage_users', app: 'customers' },
  { href: '/weekly.html', label: '週報工作台', perm: 'manage_weekly_reports', app: 'weekly' },
];

window.currentUser = null;

function hasPerm(user, perm) {
  if (!user) return perm === 'submit_form';
  return (user.permissions || []).includes(perm);
}

function currentApp(path) {
  return path === '/weekly.html' ? 'weekly' : 'customers';
}

function ensureAppSwitcher(activePath) {
  const headerInner = document.querySelector('.header-inner');
  if (!headerInner) return;

  let wrap = document.getElementById('appSwitcher');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'appSwitcher';
    wrap.className = 'app-switcher';
    wrap.innerHTML = `
      <button type="button" class="app-switcher-btn" id="appSwitcherBtn" aria-label="切換系統" aria-expanded="false">
        <span class="hamburger-icon" aria-hidden="true"><span></span><span></span><span></span></span>
      </button>
      <div class="app-switcher-menu hidden" id="appSwitcherMenu" role="menu"></div>
    `;
    headerInner.insertBefore(wrap, headerInner.firstChild);

    document.getElementById('appSwitcherBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      const menu = document.getElementById('appSwitcherMenu');
      const btn = document.getElementById('appSwitcherBtn');
      const open = menu.classList.toggle('hidden') === false;
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('click', () => {
      document.getElementById('appSwitcherMenu')?.classList.add('hidden');
      document.getElementById('appSwitcherBtn')?.setAttribute('aria-expanded', 'false');
    });
  }

  const user = window.currentUser;
  const menu = document.getElementById('appSwitcherMenu');
  menu.innerHTML = APP_SWITCHER_ITEMS.filter((item) => {
    if (!item.perm) return true;
    return user && hasPerm(user, item.perm);
  }).map((item) => {
    const active = item.match(activePath) ? ' active' : '';
    return `<a href="${item.href}" class="app-switcher-item${active}" role="menuitem">${item.label}</a>`;
  }).join('');

  const title = headerInner.querySelector('h1');
  // 標題維持各頁原本文案，不在切換系統時改寫
  if (title) title.style.whiteSpace = 'nowrap';
}

function renderNav(activePath) {
  const nav = document.getElementById('mainNav');
  if (!nav) return;

  const user = window.currentUser;
  const app = currentApp(activePath);
  const links = NAV_ITEMS.filter((item) => {
    if (item.app && item.app !== app) return false;
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
  ensureAppSwitcher(activePath);

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

function startNav() {
  window.navReady = initNav(window.location.pathname);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startNav);
} else {
  startNav();
}