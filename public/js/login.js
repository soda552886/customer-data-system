function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast ${type}`;
  setTimeout(() => toast.classList.add('hidden'), 3500);
}

const params = new URLSearchParams(window.location.search);
const nextUrl = params.get('next') || '/search.html';

function redirectAfterLogin(user) {
  if (user.role === 'sales') {
    window.location.href = '/';
    return;
  }
  window.location.href = nextUrl;
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
