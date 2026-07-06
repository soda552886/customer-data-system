import copy
import json
import sqlite3
from typing import Any

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
    if field_key not in overrides:
        return list(default_options)
    allowed = set(overrides[field_key])
    return [opt for opt in default_options if opt in allowed]


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
        fields.append({
            **item,
            'allOptions': defaults,
            'enabledOptions': enabled_options(defaults, overrides, key),
            'isCustomized': key in overrides,
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

    staff_enabled = enabled_options(
        sales_staff.get(site_id, []),
        overrides,
        SALES_STAFF_FIELD_KEY,
    )
    if SALES_STAFF_FIELD_KEY in overrides:
        sales_staff_out[site_id] = staff_enabled

    for section in sections_out:
        for field in section.get('fields', []):
            if field.get('type') not in ('select', 'multiselect'):
                continue
            if field.get('dynamicStaff'):
                continue
            key = field['key']
            if key in overrides:
                field['options'] = enabled_options(field.get('options', []), overrides, key)

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


def default_report_column_order(report_columns: list) -> dict:
    order = {}
    for col in report_columns:
        order.setdefault(col['group'], []).append(col['key'])
    return order


def report_column_map(report_columns: list) -> dict:
    return {col['key']: col for col in report_columns}


def load_site_report_column_order(
    conn: sqlite3.Connection, site_id: str, report_columns: list,
) -> Optional[dict]:
    row = conn.execute(
        'SELECT order_json FROM site_field_order WHERE site_id = ?', (site_id,),
    ).fetchone()
    if not row:
        return None
    data = json.loads(row['order_json'])
    if isinstance(data, dict) and 'columnKeys' in data:
        return _flat_keys_to_groups(data['columnKeys'], report_columns)
    return data if isinstance(data, dict) else None


def _flat_keys_to_groups(keys: list, report_columns: list) -> dict:
    col_map = report_column_map(report_columns)
    groups = default_report_column_order(report_columns)
    result = {g: [] for g in groups}
    for key in keys:
        col = col_map.get(key)
        if col and key not in result.get(col['group'], []):
            result[col['group']].append(key)
    for group, default_keys in groups.items():
        for key in default_keys:
            if key not in result[group]:
                result[group].append(key)
    return result


def save_site_report_column_order(conn: sqlite3.Connection, site_id: str, order: dict):
    conn.execute('DELETE FROM site_field_order WHERE site_id = ?', (site_id,))
    if order:
        conn.execute(
            'INSERT INTO site_field_order (site_id, order_json) VALUES (?, ?)',
            (site_id, json.dumps(order, ensure_ascii=False)),
        )


def normalize_report_column_order(report_columns: list, payload: dict) -> dict:
    defaults = default_report_column_order(report_columns)
    col_map = report_column_map(report_columns)
    normalized = {}
    for group, default_keys in defaults.items():
        submitted = (payload or {}).get(group) or []
        if not isinstance(submitted, list):
            continue
        allowed = set(default_keys)
        ordered = [k for k in submitted if k in allowed]
        for key in default_keys:
            if key not in ordered:
                ordered.append(key)
        if ordered != default_keys:
            normalized[group] = ordered
    return normalized


def build_site_report_order_config(report_columns: list, saved: Optional[dict]) -> dict:
    defaults = default_report_column_order(report_columns)
    order = saved if saved else defaults
    col_map = report_column_map(report_columns)
    groups = []
    seen_groups = []
    for col in report_columns:
        if col['group'] not in seen_groups:
            seen_groups.append(col['group'])

    for group_title in seen_groups:
        keys = order.get(group_title, defaults.get(group_title, []))
        columns = []
        seen = set()
        for key in keys:
            if key in col_map and key not in seen:
                columns.append(col_map[key])
                seen.add(key)
        for key in defaults.get(group_title, []):
            if key not in seen and key in col_map:
                columns.append(col_map[key])
                seen.add(key)
        if columns:
            groups.append({'groupTitle': group_title, 'columns': columns})

    return {
        'groups': groups,
        'isCustomized': saved is not None,
    }


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


def sort_keys_for_export(report_columns: list, selected_keys: list, saved: Optional[dict]) -> list:
    if not saved:
        return list(selected_keys)
    flat = flatten_report_column_order(report_columns, saved)
    key_index = {k: i for i, k in enumerate(flat)}
    return sorted(selected_keys, key=lambda k: key_index.get(k, 9999))
