function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast ${type}`;
  setTimeout(() => toast.classList.add('hidden'), 3500);
}

const params = new URLSearchParams(window.location.search);
const nextUrl = params.get('next') || '/search.html';

function redirectAfterLogin(user) {
  // 若有指定 next（例如週報），一律導向該頁；否則業務回填表單、其他人回查看資料
  if (nextUrl && nextUrl !== '/login.html') {
    window.location.href = nextUrl;
    return;
  }
  window.location.href = user.role === 'sales' ? '/' : '/search.html';
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const json = await res.json();
    if (!res.ok) {
      showToast(json.error || '登入失敗', 'error');
      return;
    }
    const user = json.user;
    redirectAfterLogin(user);
  } catch {
    showToast('登入失敗，請稍後再試', 'error');
  } finally {
    btn.disabled = false;
  }
});

fetch('/api/auth/me').then((r) => r.json()).then((json) => {
  if (json.authenticated) {
    redirectAfterLogin(json.user);
  }
});
