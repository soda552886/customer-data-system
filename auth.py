import os
import sqlite3
from functools import wraps
from typing import Optional

from flask import jsonify, request, session
from werkzeug.security import check_password_hash, generate_password_hash

ROLES = {
    'executive': '最高主管（蘇總/副總/米伽姐）',
    'field_staff': '現場專案/副專/女專',
    'sales': '業務',
}

ROLE_PERMISSIONS = {
    'executive': {
        'view_customers', 'edit_customers', 'delete_customers',
        'import_customers', 'export_customers', 'delete_all_customers',
        'manage_sites', 'manage_users', 'manage_field_options', 'view_audit_logs', 'submit_form',
    },
    'field_staff': {
        'view_customers', 'edit_customers', 'delete_customers',
        'import_customers', 'export_customers',
        'manage_field_options', 'view_audit_logs', 'submit_form',
    },
    'sales': {
        'submit_form',
    },
}

PROTECTED_PAGES = frozenset({
    '/search.html', '/import.html', '/sites.html', '/users.html',
    '/site-fields.html', '/field-options.html', '/audit-log.html',
})

PUBLIC_API_PREFIXES = (
    '/api/auth/login',
)
PUBLIC_API_EXACT = frozenset({
    '/api/sites',
    '/api/fields',
})
PUBLIC_API_POST_ONLY = frozenset({
    '/api/customers',
})


def hash_password(password: str) -> str:
    return generate_password_hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    return check_password_hash(password_hash, password)


def init_auth_tables(conn: sqlite3.Connection):
    conn.executescript('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            display_name TEXT NOT NULL,
            role TEXT NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        );
        CREATE TABLE IF NOT EXISTS user_sites (
            user_id INTEGER NOT NULL,
            site_id TEXT NOT NULL,
            PRIMARY KEY (user_id, site_id),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_user_sites_user ON user_sites(user_id);
    ''')


def seed_initial_admin(conn: sqlite3.Connection):
    count = conn.execute('SELECT COUNT(*) FROM users').fetchone()[0]
    if count > 0:
        return
    username = os.environ.get('ADMIN_USERNAME', 'admin')
    password = os.environ.get('ADMIN_INITIAL_PASSWORD', 'admin123')
    conn.execute(
        'INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)',
        (username, hash_password(password), '系統管理員', 'executive'),
    )
    conn.commit()


def migrate_retired_roles(conn: sqlite3.Connection):
    """將已移除的職務對應到現有職務。"""
    conn.execute("UPDATE users SET role = 'field_staff' WHERE role = 'supervisor'")
    conn.execute("UPDATE users SET role = 'executive' WHERE role = 'hr'")
    conn.commit()


def user_row_to_dict(row, site_ids=None):
    return {
        'id': row['id'],
        'username': row['username'],
        'displayName': row['display_name'],
        'role': row['role'],
        'roleLabel': ROLES.get(row['role'], row['role']),
        'isActive': bool(row['is_active']),
        'siteIds': site_ids if site_ids is not None else [],
        'permissions': sorted(ROLE_PERMISSIONS.get(row['role'], set())),
    }


def get_user_by_id(conn, user_id):
    row = conn.execute('SELECT * FROM users WHERE id = ?', (user_id,)).fetchone()
    if not row:
        return None
    site_ids = [
        r['site_id'] for r in conn.execute(
            'SELECT site_id FROM user_sites WHERE user_id = ?', (user_id,)
        ).fetchall()
    ]
    return user_row_to_dict(row, site_ids)


def get_user_by_username(conn, username):
    row = conn.execute(
        'SELECT * FROM users WHERE username = ?', (username.strip(),),
    ).fetchone()
    if not row:
        return None
    site_ids = [
        r['site_id'] for r in conn.execute(
            'SELECT site_id FROM user_sites WHERE user_id = ?', (row['id'],),
    ).fetchall()
    ]
    return user_row_to_dict(row, site_ids)


def get_current_user(conn):
    user_id = session.get('user_id')
    if not user_id:
        return None
    user = get_user_by_id(conn, user_id)
    if not user or not user['isActive']:
        session.clear()
        return None
    return user


def user_has_permission(user, permission: str) -> bool:
    if not user:
        return False
    return permission in ROLE_PERMISSIONS.get(user['role'], set())


def user_can_access_site(user, site_id: str) -> bool:
    if not user:
        return False
    if user['role'] == 'executive':
        return True
    if user['role'] == 'sales':
        site_ids = user.get('siteIds', [])
        if not site_ids:
            return True
        if not site_id:
            return True
        return site_id in site_ids
    if user['role'] == 'field_staff':
        site_ids = user.get('siteIds', [])
        if not site_ids:
            return False
        if not site_id:
            return True
        return site_id in site_ids
    return False


def get_allowed_site_ids(user) -> Optional[list]:
    """None means all sites."""
    if not user:
        return []
    if user['role'] == 'executive':
        return None
    if user['role'] == 'sales':
        site_ids = user.get('siteIds', [])
        return None if not site_ids else list(site_ids)
    return list(user.get('siteIds', []))


def is_public_api(path: str, method: str) -> bool:
    if path.startswith(PUBLIC_API_PREFIXES):
        return True
    if path in PUBLIC_API_EXACT and method == 'GET':
        return True
    if path == '/api/customers/lookup' and method == 'GET':
        return True
    if path in PUBLIC_API_POST_ONLY and method == 'POST':
        return True
    return False


def login_required_json(get_db_func):
    def decorator(f):
        @wraps(f)
        def wrapped(*args, **kwargs):
            conn = get_db_func()
            user = get_current_user(conn)
            conn.close()
            if not user:
                return jsonify({'error': '請先登入', 'code': 'AUTH_REQUIRED'}), 401
            return f(*args, **kwargs)
        return wrapped
    return decorator


def permission_required_json(get_db_func, permission: str):
    def decorator(f):
        @wraps(f)
        def wrapped(*args, **kwargs):
            conn = get_db_func()
            user = get_current_user(conn)
            conn.close()
            if not user:
                return jsonify({'error': '請先登入', 'code': 'AUTH_REQUIRED'}), 401
            if not user_has_permission(user, permission):
                return jsonify({'error': '權限不足', 'code': 'FORBIDDEN'}), 403
            return f(*args, **kwargs)
        return wrapped
    return decorator


def save_user_sites(conn, user_id: int, site_ids: list):
    conn.execute('DELETE FROM user_sites WHERE user_id = ?', (user_id,))
    for site_id in site_ids:
        if site_id:
            conn.execute(
                'INSERT OR IGNORE INTO user_sites (user_id, site_id) VALUES (?, ?)',
                (user_id, site_id),
            )
