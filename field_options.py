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
