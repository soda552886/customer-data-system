import json
import sqlite3
from typing import Optional

ACTION_LABELS = {
    'login': '登入',
    'logout': '登出',
    'customer_create': '新增客戶',
    'customer_update': '編輯客戶',
    'customer_delete': '刪除客戶',
    'customer_import': '匯入客戶',
    'customer_clear_site': '清空案場資料',
    'field_options_update': '更新欄位選項',
    'report_column_order_update': '更新報表欄位順序',
    'user_create': '新增人員',
    'user_update': '更新人員',
    'site_create': '新增案場',
    'site_delete': '刪除案場',
}


def init_audit_table(conn: sqlite3.Connection):
    conn.executescript('''
        CREATE TABLE IF NOT EXISTS operation_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            username TEXT,
            display_name TEXT,
            role TEXT,
            action TEXT NOT NULL,
            entity_type TEXT,
            entity_id TEXT,
            site_id TEXT,
            site_name TEXT,
            summary TEXT NOT NULL,
            detail_json TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_operation_logs_created ON operation_logs(created_at);
        CREATE INDEX IF NOT EXISTS idx_operation_logs_site ON operation_logs(site_id);
        CREATE INDEX IF NOT EXISTS idx_operation_logs_user ON operation_logs(user_id);
    ''')


def log_operation(
    conn: sqlite3.Connection,
    user: Optional[dict],
    action: str,
    summary: str,
    *,
    entity_type: str = None,
    entity_id: str = None,
    site_id: str = None,
    site_name: str = None,
    detail: dict = None,
):
    conn.execute(
        '''INSERT INTO operation_logs
           (user_id, username, display_name, role, action, entity_type, entity_id,
            site_id, site_name, summary, detail_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
        (
            user['id'] if user else None,
            user['username'] if user else None,
            user['displayName'] if user else None,
            user['role'] if user else None,
            action,
            entity_type,
            str(entity_id) if entity_id is not None else None,
            site_id,
            site_name,
            summary,
            json.dumps(detail, ensure_ascii=False) if detail else None,
        ),
    )


def row_to_log_dict(row) -> dict:
    detail = None
    if row['detail_json']:
        try:
            detail = json.loads(row['detail_json'])
        except json.JSONDecodeError:
            detail = row['detail_json']
    return {
        'id': row['id'],
        'userId': row['user_id'],
        'username': row['username'],
        'displayName': row['display_name'],
        'role': row['role'],
        'action': row['action'],
        'actionLabel': ACTION_LABELS.get(row['action'], row['action']),
        'entityType': row['entity_type'],
        'entityId': row['entity_id'],
        'siteId': row['site_id'],
        'siteName': row['site_name'],
        'summary': row['summary'],
        'detail': detail,
        'createdAt': row['created_at'],
    }
