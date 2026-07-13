import copy
import json
import sqlite3
from typing import Any, Optional

SALES_STAFF_FIELD_KEY = '__salesStaff__'


def init_field_options_table(conn: sqlite3.Connection):
    conn.executescript('''
        CREATE TABLE IF NOT EXISTS site_field_options (
            site_id TEXT NOT NULL,
            field_key TEXT NOT NULL,
            options_json TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
            PRIMARY KEY (site_id, field_key),
            FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_site_field_options_site ON site_field_options(site_id);
        CREATE TABLE IF NOT EXISTS site_field_order (
            site_id TEXT PRIMARY KEY,
            order_json TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
        );
    ''')


def field_applies_to_site(field: dict, site_id: str) -> bool:
    sites = field.get('sites')
    if sites and site_id not in sites:
        return False
    return True


def default_options_for_field(field: dict, site_id: str, sales_staff: dict) -> list:
    if field.get('dynamicStaff'):
        return list(sales_staff.get(site_id, []))
    return list(field.get('options') or [])


def iter_configurable_fields(sections: list, site_id: str, sales_staff: dict) -> list:
    items = []
    staff_defaults = list(sales_staff.get(site_id, []))
    staff_added = False

    for section in sections:
        for field in section.get('fields', []):
            if field.get('type') not in ('select', 'multiselect'):
                continue
            if not field_applies_to_site(field, site_id):
                continue

            if field.get('dynamicStaff'):
                if staff_added or not staff_defaults:
                    continue
                staff_added = True
                items.append({
                    'key': SALES_STAFF_FIELD_KEY,
                    'label': '銷售人員',
                    'sectionTitle': section.get('title', ''),
                    'type': 'select',
                    'defaultOptions': staff_defaults,
                })
                continue

            options = field.get('options') or []
            if not options:
                continue
            items.append({
                'key': field['key'],
                'label': field['label'],
                'sectionTitle': section.get('title', ''),
                'type': field['type'],
                'defaultOptions': options,
            })
    return items


def load_site_option_overrides(conn: sqlite3.Connection, site_id: str) -> dict:
    rows = conn.execute(
        'SELECT field_key, options_json FROM site_field_options WHERE site_id = ?',
        (site_id,),
    ).fetchall()
    return {row['field_key']: json.loads(row['options_json']) for row in rows}


def save_site_option_overrides(conn: sqlite3.Connection, site_id: str, config: dict):
    conn.execute('DELETE FROM site_field_options WHERE site_id = ?', (site_id,))
    for field_key, options in config.items():
        if not options:
            continue
        conn.execute(
            'INSERT INTO site_field_options (site_id, field_key, options_json) VALUES (?, ?, ?)',
            (site_id, field_key, json.dumps(list(options), ensure_ascii=False)),
        )


def enabled_options(default_options: list, overrides: dict, field_key: str) -> list:
    """Return enabled options for a field.

    Empty or non-matching overrides fall back to defaults so required
    dropdowns (e.g. 區域) never become unusable on the form.
    """
    defaults = list(default_options or [])
    if field_key not in overrides:
        return defaults
    allowed = set(overrides.get(field_key) or [])
    if not allowed:
        return defaults
    enabled = [opt for opt in defaults if opt in allowed]
    return enabled if enabled else defaults


def build_site_field_config(
    sections: list,
    site_id: str,
    sales_staff: dict,
    overrides: dict,
) -> dict:
    fields = []
    for item in iter_configurable_fields(sections, site_id, sales_staff):
        key = item['key']
        defaults = item['defaultOptions']
        enabled = enabled_options(defaults, overrides, key)
        # Treat empty/invalid override as not customized
        is_customized = (
            key in overrides
            and bool(overrides.get(key))
            and enabled != defaults
            and set(enabled) != set(defaults)
        )
        fields.append({
            **item,
            'allOptions': defaults,
            'enabledOptions': enabled,
            'isCustomized': is_customized,
        })
    return {'siteId': site_id, 'fields': fields}


def apply_site_field_options(
    sections: list,
    site_id: str,
    sales_staff: dict,
    overrides: dict,
) -> tuple[list, dict]:
    sections_out = copy.deepcopy(sections)
    sales_staff_out = copy.deepcopy(sales_staff)

    if SALES_STAFF_FIELD_KEY in overrides:
        staff_defaults = list(sales_staff.get(site_id, []))
        staff_enabled = enabled_options(staff_defaults, overrides, SALES_STAFF_FIELD_KEY)
        # Only apply when at least one salesperson remains
        if staff_enabled:
            sales_staff_out[site_id] = staff_enabled

    for section in sections_out:
        for field in section.get('fields', []):
            if field.get('type') not in ('select', 'multiselect'):
                continue
            if field.get('dynamicStaff'):
                continue
            key = field['key']
            if key not in overrides:
                continue
            defaults = list(field.get('options') or [])
            enabled = enabled_options(defaults, overrides, key)
            # Never blank out a dropdown — empty would block form submit
            if enabled:
                field['options'] = enabled

    return sections_out, sales_staff_out


def normalize_save_payload(
    sections: list,
    site_id: str,
    sales_staff: dict,
    payload: dict,
) -> dict:
    """Keep only valid field keys and option values."""
    configurable = {
        item['key']: item['defaultOptions']
        for item in iter_configurable_fields(sections, site_id, sales_staff)
    }
    normalized = {}
    for field_key, selected in (payload or {}).items():
        if field_key not in configurable:
            continue
        allowed = set(configurable[field_key])
        picked = [opt for opt in (selected or []) if opt in allowed]
        if picked and set(picked) != allowed:
            normalized[field_key] = picked
    return normalized


def report_column_map(report_columns: list) -> dict:
    return {col['key']: col for col in report_columns}


def default_report_column_order(report_columns: list) -> dict:
    order = {}
    for col in report_columns:
        order.setdefault(col['group'], []).append(col['key'])
    return order


def flatten_report_column_order(report_columns: list, saved: Optional[dict]) -> list:
    defaults = default_report_column_order(report_columns)
    order = saved if saved else defaults
    seen_groups = []
    for col in report_columns:
        if col['group'] not in seen_groups:
            seen_groups.append(col['group'])
    flat = []
    for group in seen_groups:
        flat.extend(order.get(group, defaults.get(group, [])))
    return flat


def default_report_export_items(report_columns: list) -> list:
    return [{'key': col['key'], 'enabled': True} for col in report_columns]


def _merge_report_export_items(report_columns: list, items: list) -> list:
    col_map = report_column_map(report_columns)
    seen = set()
    merged = []
    for item in items or []:
        key = item.get('key')
        if not key or key not in col_map or key in seen:
            continue
        merged.append({
            'key': key,
            'enabled': bool(item.get('enabled', True)),
        })
        seen.add(key)
    for col in report_columns:
        if col['key'] not in seen:
            merged.append({'key': col['key'], 'enabled': True})
    return merged


def _migrate_legacy_report_export(data, report_columns: list) -> Optional[list]:
    if not isinstance(data, dict):
        return None
    if data.get('version') == 2 and isinstance(data.get('items'), list):
        return _merge_report_export_items(report_columns, data['items'])
    if 'columnKeys' in data and isinstance(data['columnKeys'], list):
        items = [{'key': k, 'enabled': True} for k in data['columnKeys'] if k in report_column_map(report_columns)]
        return _merge_report_export_items(report_columns, items)
    if any(k in data for k in default_report_column_order(report_columns)):
        flat = []
        seen = set()
        for key in flatten_report_column_order(report_columns, data):
            if key not in seen:
                flat.append(key)
                seen.add(key)
        items = [{'key': k, 'enabled': True} for k in flat]
        return _merge_report_export_items(report_columns, items)
    return None


def load_site_report_export_config(
    conn: sqlite3.Connection, site_id: str, report_columns: list,
) -> Optional[list]:
    row = conn.execute(
        'SELECT order_json FROM site_field_order WHERE site_id = ?', (site_id,),
    ).fetchone()
    if not row:
        return None
    data = json.loads(row['order_json'])
    return _migrate_legacy_report_export(data, report_columns)


def save_site_report_export_config(conn: sqlite3.Connection, site_id: str, items: list):
    conn.execute('DELETE FROM site_field_order WHERE site_id = ?', (site_id,))
    if items:
        payload = {'version': 2, 'items': items}
        conn.execute(
            'INSERT INTO site_field_order (site_id, order_json) VALUES (?, ?)',
            (site_id, json.dumps(payload, ensure_ascii=False)),
        )


def normalize_report_export_payload(report_columns: list, payload: dict) -> Optional[list]:
    raw_items = payload.get('items') if isinstance(payload, dict) else payload
    if not isinstance(raw_items, list):
        return None
    merged = _merge_report_export_items(report_columns, raw_items)
    defaults = default_report_export_items(report_columns)
    if merged == defaults:
        return None
    return merged


def build_site_report_export_config(report_columns: list, saved: Optional[list]) -> dict:
    items = saved if saved is not None else default_report_export_items(report_columns)
    col_map = report_column_map(report_columns)
    columns = []
    for item in items:
        col = col_map.get(item['key'])
        if not col:
            continue
        columns.append({
            'key': col['key'],
            'label': col['label'],
            'group': col['group'],
            'enabled': bool(item.get('enabled', True)),
        })
    enabled_count = sum(1 for c in columns if c['enabled'])
    return {
        'columns': columns,
        'isCustomized': saved is not None,
        'enabledCount': enabled_count,
        'totalCount': len(columns),
    }


def export_column_keys_for_site(report_columns: list, saved: Optional[list]) -> list:
    items = saved if saved is not None else default_report_export_items(report_columns)
    return [item['key'] for item in items if item.get('enabled', True)]
