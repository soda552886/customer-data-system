# -*- coding: utf-8 -*-
"""Weekly report helpers: stats from customers + draft persistence."""
from __future__ import annotations

import json
import sqlite3
from collections import Counter
from datetime import datetime, timedelta
from typing import Optional


WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']


def init_weekly_tables(conn: sqlite3.Connection):
    conn.executescript('''
        CREATE TABLE IF NOT EXISTS weekly_reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            site_id TEXT NOT NULL,
            site_name TEXT NOT NULL,
            week_number INTEGER,
            week_start TEXT NOT NULL,
            week_end TEXT NOT NULL,
            data TEXT NOT NULL DEFAULT '{}',
            created_by INTEGER,
            updated_by INTEGER,
            created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
            UNIQUE(site_id, week_start)
        );
        CREATE INDEX IF NOT EXISTS idx_weekly_reports_site ON weekly_reports(site_id);
        CREATE INDEX IF NOT EXISTS idx_weekly_reports_start ON weekly_reports(week_start);
    ''')


def parse_ymd(value: str):
    if not value:
        return None
    s = str(value).strip().split()[0].replace('/', '-')
    try:
        return datetime.strptime(s[:10], '%Y-%m-%d').date()
    except ValueError:
        return None


def monday_of(d):
    return d - timedelta(days=d.weekday())


def week_bounds(week_start: str):
    start = parse_ymd(week_start)
    if not start:
        raise ValueError('無效的週起始日期')
    start = monday_of(start)
    end = start + timedelta(days=6)
    return start, end


def roc_year(d) -> int:
    return d.year - 1911


def default_week_number(start) -> int:
    # ISO week as a practical default; user can override
    return int(start.isocalendar()[1])


def empty_manual_payload(start, end, week_number=None):
    days = []
    for i in range(7):
        d = start + timedelta(days=i)
        days.append({
            'date': d.isoformat(),
            'weekday': WEEKDAY_LABELS[i],
            'weather': '',
            'phoneCalls': 0,
        })
    return {
        'weekNumber': week_number if week_number is not None else default_week_number(start),
        'days': days,
        'deals': {'units': 0, 'parking': 0, 'amount': 0},
        'signings': {'units': 0, 'parking': 0, 'amount': 0},
        'purchases': {'units': 0, 'parking': 0, 'amount': 0},
        'commission': {
            'sellableAmount': 0,
            'claimableAmount': 0,
            'claimedAmount': 0,
            'claimableUnits': 0,
            'claimedUnits': 0,
        },
        'reviewNotes': '',
        'competitorNotes': '',
        'memo': '',
    }


def _record_date(row, data: dict):
    raw = row['visit_date'] or data.get('returnVisitDate') or data.get('visitDate') or ''
    return parse_ymd(raw)


def build_auto_stats(conn: sqlite3.Connection, site_id: str, start, end) -> dict:
    rows = conn.execute(
        'SELECT * FROM customers WHERE site_id = ?',
        (site_id,),
    ).fetchall()

    day_keys = [(start + timedelta(days=i)).isoformat() for i in range(7)]
    by_day = {
        k: {'new': 0, 'return': 0, 'deal': 0, 'total': 0}
        for k in day_keys
    }
    region_counter = Counter()
    media_counter = Counter()
    source_counter = Counter()
    visitors = []
    return_visits = []
    deals = []

    for row in rows:
        data = json.loads(row['data'] or '{}')
        d = _record_date(row, data)
        if not d or d < start or d > end:
            continue
        key = d.isoformat()
        vt = row['visit_type'] or ''
        if vt == '回訪':
            by_day[key]['return'] += 1
        else:
            by_day[key]['new'] += 1
        by_day[key]['total'] += 1
        if int(row['is_deal'] or 0) == 1:
            by_day[key]['deal'] += 1

        region = str(data.get('region') or '未填').strip() or '未填'
        region_counter[region] += 1

        media = (
            data.get('media1')
            or data.get('media')
            or data.get('media2')
            or '未填'
        )
        media = str(media).strip() or '未填'
        media_counter[media] += 1

        source = str(data.get('customerSource') or '未填').strip() or '未填'
        source_counter[source] += 1

        item = {
            'id': row['id'],
            'date': key,
            'visitType': vt,
            'isDeal': bool(row['is_deal']),
            'customerName': data.get('customerName') or '',
            'phone': data.get('phone') or '',
            'region': region,
            'media': media,
            'source': source,
            'sincerity': data.get('sincerity') or '',
            'salesperson1': data.get('salesperson1') or '',
            'discussion': (data.get('discussion') or '')[:120],
        }
        visitors.append(item)
        if vt == '回訪':
            return_visits.append(item)
        if item['isDeal']:
            deals.append(item)

    visitors.sort(key=lambda x: (x['date'], x['id']))
    return_visits.sort(key=lambda x: (x['date'], x['id']))
    deals.sort(key=lambda x: (x['date'], x['id']))

    totals = {
        'new': sum(v['new'] for v in by_day.values()),
        'return': sum(v['return'] for v in by_day.values()),
        'deal': sum(v['deal'] for v in by_day.values()),
        'total': sum(v['total'] for v in by_day.values()),
    }

    return {
        'byDay': [
            {
                'date': k,
                'weekday': WEEKDAY_LABELS[i],
                **by_day[k],
            }
            for i, k in enumerate(day_keys)
        ],
        'totals': totals,
        'byRegion': [
            {'name': name, 'count': count}
            for name, count in region_counter.most_common()
        ],
        'byMedia': [
            {'name': name, 'count': count}
            for name, count in media_counter.most_common()
        ],
        'bySource': [
            {'name': name, 'count': count}
            for name, count in source_counter.most_common()
        ],
        'visitors': visitors,
        'returnVisits': return_visits,
        'dealsFromCustomers': deals,
    }


def load_weekly_report(conn: sqlite3.Connection, site_id: str, week_start: str):
    row = conn.execute(
        'SELECT * FROM weekly_reports WHERE site_id = ? AND week_start = ?',
        (site_id, week_start),
    ).fetchone()
    if not row:
        return None
    return {
        'id': row['id'],
        'siteId': row['site_id'],
        'siteName': row['site_name'],
        'weekNumber': row['week_number'],
        'weekStart': row['week_start'],
        'weekEnd': row['week_end'],
        'data': json.loads(row['data'] or '{}'),
        'updatedAt': row['updated_at'],
    }


def upsert_weekly_report(
    conn: sqlite3.Connection,
    *,
    site_id: str,
    site_name: str,
    week_start: str,
    week_end: str,
    week_number: Optional[int],
    data: dict,
    user_id: Optional[int],
):
    existing = conn.execute(
        'SELECT id FROM weekly_reports WHERE site_id = ? AND week_start = ?',
        (site_id, week_start),
    ).fetchone()
    payload = json.dumps(data, ensure_ascii=False)
    if existing:
        conn.execute(
            '''
            UPDATE weekly_reports
            SET site_name = ?, week_number = ?, week_end = ?, data = ?,
                updated_by = ?, updated_at = datetime('now', 'localtime')
            WHERE id = ?
            ''',
            (site_name, week_number, week_end, payload, user_id, existing['id']),
        )
        return existing['id']
    cur = conn.execute(
        '''
        INSERT INTO weekly_reports
          (site_id, site_name, week_number, week_start, week_end, data, created_by, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ''',
        (site_id, site_name, week_number, week_start, week_end, payload, user_id, user_id),
    )
    return cur.lastrowid


def list_weekly_reports(conn: sqlite3.Connection, site_id: str, limit: int = 30):
    rows = conn.execute(
        '''
        SELECT id, site_id, site_name, week_number, week_start, week_end, updated_at
        FROM weekly_reports
        WHERE site_id = ?
        ORDER BY week_start DESC
        LIMIT ?
        ''',
        (site_id, limit),
    ).fetchall()
    return [{
        'id': r['id'],
        'siteId': r['site_id'],
        'siteName': r['site_name'],
        'weekNumber': r['week_number'],
        'weekStart': r['week_start'],
        'weekEnd': r['week_end'],
        'updatedAt': r['updated_at'],
    } for r in rows]
