# -*- coding: utf-8 -*-
"""Weekly report helpers: stats from customers + draft persistence + Excel export."""
from __future__ import annotations

import io
import json
import sqlite3
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from typing import Optional

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill


WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']
HOPE_SINCERITY = {'A', 'A+', 'A-', 'B', 'B+', '有望', '高'}


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
        'unreported': {'units': 0, 'parking': 0, 'amount': 0},
        'commission': {
            'sellableAmount': 0,
            'claimableAmount': 0,
            'claimedAmount': 0,
            'claimableUnits': 0,
            'claimableParking': 0,
            'claimedUnits': 0,
            'claimedParking': 0,
        },
        'inventory': {
            'totalUnits': 122,
            'soldUnits': 0,
            'totalParking': 99,
            'soldParking': 0,
            'totalAmount': 175190,
            'soldAmount': 0,
            'residentialTotal': 80,
            'residentialSold': 0,
            'officeTotal': 42,
            'officeSold': 0,
        },
        'reviewNotes': '',
        'competitorNotes': '',
        'memo': '',
    }


def merge_manual(base: dict, saved: Optional[dict]) -> dict:
    if not saved:
        return base
    out = json.loads(json.dumps(base))
    for key, val in saved.items():
        if isinstance(val, dict) and isinstance(out.get(key), dict):
            merged = dict(out[key])
            merged.update(val)
            out[key] = merged
        else:
            out[key] = val
    # keep day skeleton length aligned to week
    if isinstance(out.get('days'), list) and isinstance(base.get('days'), list):
        days = []
        saved_days = {d.get('date'): d for d in out['days'] if isinstance(d, dict)}
        for stub in base['days']:
            prev = saved_days.get(stub['date']) or {}
            days.append({**stub, **{k: prev[k] for k in ('weather', 'phoneCalls') if k in prev}})
        out['days'] = days
    return out


def _record_date(row, data: dict):
    raw = row['visit_date'] or data.get('returnVisitDate') or data.get('visitDate') or ''
    return parse_ymd(raw)


def _is_hope(sincerity: str) -> bool:
    s = (sincerity or '').strip().upper()
    if not s:
        return False
    if s in {x.upper() for x in HOPE_SINCERITY}:
        return True
    return '有望' in (sincerity or '')


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
    hope_customers = []

    month_start = start.replace(day=1)
    year_start = start.replace(month=1, day=1)
    period = {
        'week': {'visits': 0, 'new': 0, 'return': 0, 'deals': 0},
        'month': {'visits': 0, 'new': 0, 'return': 0, 'deals': 0},
        'year': {'visits': 0, 'new': 0, 'return': 0, 'deals': 0},
        'all': {'visits': 0, 'new': 0, 'return': 0, 'deals': 0},
    }
    sales_stats = defaultdict(lambda: {'visits': 0, 'deals': 0, 'weekVisits': 0, 'weekDeals': 0})

    for row in rows:
        data = json.loads(row['data'] or '{}')
        d = _record_date(row, data)
        vt = row['visit_type'] or ''
        is_deal = int(row['is_deal'] or 0) == 1
        staff = str(data.get('salesperson1') or '').strip() or '未填'
        sincerity = str(data.get('sincerity') or '').strip()

        if d:
            period['all']['visits'] += 1
            if vt == '回訪':
                period['all']['return'] += 1
            else:
                period['all']['new'] += 1
            if is_deal:
                period['all']['deals'] += 1

            sales_stats[staff]['visits'] += 1
            if is_deal:
                sales_stats[staff]['deals'] += 1

            if d >= year_start:
                period['year']['visits'] += 1
                if vt == '回訪':
                    period['year']['return'] += 1
                else:
                    period['year']['new'] += 1
                if is_deal:
                    period['year']['deals'] += 1

            if d >= month_start:
                period['month']['visits'] += 1
                if vt == '回訪':
                    period['month']['return'] += 1
                else:
                    period['month']['new'] += 1
                if is_deal:
                    period['month']['deals'] += 1

        if not d or d < start or d > end:
            continue

        key = d.isoformat()
        if vt == '回訪':
            by_day[key]['return'] += 1
        else:
            by_day[key]['new'] += 1
        by_day[key]['total'] += 1
        if is_deal:
            by_day[key]['deal'] += 1

        period['week']['visits'] += 1
        if vt == '回訪':
            period['week']['return'] += 1
        else:
            period['week']['new'] += 1
        if is_deal:
            period['week']['deals'] += 1

        sales_stats[staff]['weekVisits'] += 1
        if is_deal:
            sales_stats[staff]['weekDeals'] += 1

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
            'isDeal': is_deal,
            'customerName': data.get('customerName') or '',
            'phone': data.get('phone') or '',
            'region': region,
            'media': media,
            'source': source,
            'sincerity': sincerity,
            'salesperson1': staff,
            'discussion': (data.get('discussion') or '')[:120],
        }
        visitors.append(item)
        if vt == '回訪':
            return_visits.append(item)
        if is_deal:
            deals.append(item)
        if _is_hope(sincerity):
            hope_customers.append(item)

    visitors.sort(key=lambda x: (x['date'], x['id']))
    return_visits.sort(key=lambda x: (x['date'], x['id']))
    deals.sort(key=lambda x: (x['date'], x['id']))
    hope_customers.sort(key=lambda x: (x['date'], x['id']))

    totals = {
        'new': sum(v['new'] for v in by_day.values()),
        'return': sum(v['return'] for v in by_day.values()),
        'deal': sum(v['deal'] for v in by_day.values()),
        'total': sum(v['total'] for v in by_day.values()),
    }

    conversion = []
    for name, st in sales_stats.items():
        visits = st['visits']
        deal_n = st['deals']
        conversion.append({
            'name': name,
            'visits': visits,
            'deals': deal_n,
            'rate': round((deal_n / visits * 100), 1) if visits else 0,
            'weekVisits': st['weekVisits'],
            'weekDeals': st['weekDeals'],
        })
    conversion.sort(key=lambda x: (-x['deals'], -x['visits'], x['name']))

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
        'period': period,
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
        'conversion': conversion,
        'visitors': visitors,
        'returnVisits': return_visits,
        'hopeCustomers': hope_customers,
        'dealsFromCustomers': deals,
    }


def inventory_summary(manual: dict) -> dict:
    inv = manual.get('inventory') or {}
    total_u = float(inv.get('totalUnits') or 0)
    sold_u = float(inv.get('soldUnits') or 0)
    total_p = float(inv.get('totalParking') or 0)
    sold_p = float(inv.get('soldParking') or 0)
    total_a = float(inv.get('totalAmount') or 0)
    sold_a = float(inv.get('soldAmount') or 0)
    res_t = float(inv.get('residentialTotal') or 0)
    res_s = float(inv.get('residentialSold') or 0)
    off_t = float(inv.get('officeTotal') or 0)
    off_s = float(inv.get('officeSold') or 0)
    return {
        'unitRate': round(sold_u / total_u * 100, 2) if total_u else 0,
        'parkingRate': round(sold_p / total_p * 100, 2) if total_p else 0,
        'amountRate': round(sold_a / total_a * 100, 2) if total_a else 0,
        'residentialRate': round(res_s / res_t * 100, 2) if res_t else 0,
        'officeRate': round(off_s / off_t * 100, 2) if off_t else 0,
        'remainUnits': max(total_u - sold_u, 0),
        'remainParking': max(total_p - sold_p, 0),
        'remainAmount': max(total_a - sold_a, 0),
    }


def commission_summary(manual: dict) -> dict:
    c = manual.get('commission') or {}
    claimable_amt = float(c.get('claimableAmount') or 0)
    claimed_amt = float(c.get('claimedAmount') or 0)
    claimable_u = float(c.get('claimableUnits') or 0)
    claimed_u = float(c.get('claimedUnits') or 0)
    claimable_p = float(c.get('claimableParking') or 0)
    claimed_p = float(c.get('claimedParking') or 0)
    return {
        'unclaimedAmount': max(claimable_amt - claimed_amt, 0),
        'unclaimedUnits': max(claimable_u - claimed_u, 0),
        'unclaimedParking': max(claimable_p - claimed_p, 0),
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


def build_weekly_excel(site_name: str, start, end, week_number, manual: dict, auto: dict) -> bytes:
    wb = Workbook()
    header_font = Font(bold=True, color='FFFFFF')
    header_fill = PatternFill('solid', fgColor='1A4D7C')
    inv = inventory_summary(manual)
    com = commission_summary(manual)

    def style_header(ws, row=1):
        for cell in ws[row]:
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = Alignment(horizontal='center')

    # --- 摘要 ---
    ws = wb.active
    ws.title = '週報摘要'
    ws.append([f'{site_name} 第{week_number}週週報'])
    ws.append(['區間', f'{start.isoformat()} ~ {end.isoformat()}'])
    ws.append([])
    t = auto.get('totals') or {}
    p = auto.get('period') or {}
    phone_sum = sum(float(d.get('phoneCalls') or 0) for d in (manual.get('days') or []))
    ws.append(['項目', '數值'])
    style_header(ws, ws.max_row)
    rows_summary = [
        ('本週來人(組)', t.get('total', 0)),
        ('本週新客', t.get('new', 0)),
        ('本週回訪', t.get('return', 0)),
        ('本週來電(通)', phone_sum),
        ('客資成交筆數', t.get('deal', 0)),
        ('手填成交戶/車/萬', f"{(manual.get('deals') or {}).get('units', 0)} / {(manual.get('deals') or {}).get('parking', 0)} / {(manual.get('deals') or {}).get('amount', 0)}"),
        ('手填簽約戶/車/萬', f"{(manual.get('signings') or {}).get('units', 0)} / {(manual.get('signings') or {}).get('parking', 0)} / {(manual.get('signings') or {}).get('amount', 0)}"),
        ('本月來人', (p.get('month') or {}).get('visits', 0)),
        ('本月成交(客資)', (p.get('month') or {}).get('deals', 0)),
        ('本年來人', (p.get('year') or {}).get('visits', 0)),
        ('本年成交(客資)', (p.get('year') or {}).get('deals', 0)),
        ('去化率(戶)', f"{inv['unitRate']}%"),
        ('去化率(金額)', f"{inv['amountRate']}%"),
        ('可請佣-已請佣(萬)', com['unclaimedAmount']),
        ('可請佣-已請佣(戶)', com['unclaimedUnits']),
    ]
    for r in rows_summary:
        ws.append(list(r))
    ws.append([])
    ws.append(['成交檢討', manual.get('reviewNotes') or ''])
    ws.append(['區域個案分析', manual.get('competitorNotes') or ''])
    ws.append(['備註', manual.get('memo') or ''])
    ws.column_dimensions['A'].width = 22
    ws.column_dimensions['B'].width = 50

    # --- 每日 ---
    ws = wb.create_sheet('每日統計')
    ws.append(['日期', '星期', '新客', '回訪', '合計', '成交', '來電', '天氣'])
    style_header(ws)
    days = manual.get('days') or []
    for i, d in enumerate(auto.get('byDay') or []):
        m = days[i] if i < len(days) else {}
        ws.append([
            d.get('date'), d.get('weekday'), d.get('new'), d.get('return'),
            d.get('total'), d.get('deal'), m.get('phoneCalls', 0), m.get('weather', ''),
        ])

    # --- 成交比 ---
    ws = wb.create_sheet('成交比')
    ws.append(['銷售人員', '累計接待', '累計成交', '成交率%', '本週接待', '本週成交'])
    style_header(ws)
    for row in auto.get('conversion') or []:
        ws.append([
            row['name'], row['visits'], row['deals'], row['rate'],
            row['weekVisits'], row['weekDeals'],
        ])

    # --- 去化／請佣 ---
    ws = wb.create_sheet('去化與請佣')
    inv_m = manual.get('inventory') or {}
    ws.append(['去化項目', '數值'])
    style_header(ws)
    for label, key in [
        ('總戶數', 'totalUnits'), ('已售戶數', 'soldUnits'),
        ('總車位', 'totalParking'), ('已售車位', 'soldParking'),
        ('總金額(萬)', 'totalAmount'), ('已售金額(萬)', 'soldAmount'),
        ('住宅總戶', 'residentialTotal'), ('住宅已售', 'residentialSold'),
        ('事務所總戶', 'officeTotal'), ('事務所已售', 'officeSold'),
    ]:
        ws.append([label, inv_m.get(key, 0)])
    ws.append(['戶數去化率%', inv['unitRate']])
    ws.append(['金額去化率%', inv['amountRate']])
    ws.append(['住宅去化率%', inv['residentialRate']])
    ws.append(['事務所去化率%', inv['officeRate']])
    ws.append([])
    ws.append(['請佣項目', '數值'])
    style_header(ws, ws.max_row)
    c = manual.get('commission') or {}
    for label, key in [
        ('累積銷售金額(萬)', 'sellableAmount'),
        ('可請佣金額(萬)', 'claimableAmount'),
        ('已請佣金額(萬)', 'claimedAmount'),
        ('可請佣戶數', 'claimableUnits'),
        ('已請佣戶數', 'claimedUnits'),
        ('可請佣車位', 'claimableParking'),
        ('已請佣車位', 'claimedParking'),
    ]:
        ws.append([label, c.get(key, 0)])
    ws.append(['未請佣金額(萬)', com['unclaimedAmount']])
    ws.append(['未請佣戶數', com['unclaimedUnits']])
    ws.append(['未請佣車位', com['unclaimedParking']])

    # --- 區域媒體 ---
    ws = wb.create_sheet('區域媒體來源')
    ws.append(['區域', '組數', '', '媒體', '組數', '', '來源', '組數'])
    style_header(ws)
    regions = auto.get('byRegion') or []
    medias = auto.get('byMedia') or []
    sources = auto.get('bySource') or []
    for i in range(max(len(regions), len(medias), len(sources))):
        r = regions[i] if i < len(regions) else {'name': '', 'count': ''}
        m = medias[i] if i < len(medias) else {'name': '', 'count': ''}
        s = sources[i] if i < len(sources) else {'name': '', 'count': ''}
        ws.append([r.get('name'), r.get('count'), '', m.get('name'), m.get('count'), '', s.get('name'), s.get('count')])

    # --- 客況 ---
    ws = wb.create_sheet('本週客況')
    ws.append(['日期', '類型', '姓名', '電話', '區域', '媒體', '來源', '誠意度', '銷售', '成交', '洽談'])
    style_header(ws)
    for v in auto.get('visitors') or []:
        ws.append([
            v.get('date'), v.get('visitType'), v.get('customerName'), v.get('phone'),
            v.get('region'), v.get('media'), v.get('source'), v.get('sincerity'),
            v.get('salesperson1'), '是' if v.get('isDeal') else '否', v.get('discussion'),
        ])

    # --- 回訪／有望 ---
    ws = wb.create_sheet('回訪與有望客')
    ws.append(['【回訪】'])
    ws.append(['日期', '姓名', '電話', '區域', '媒體', '誠意度', '銷售'])
    style_header(ws, ws.max_row)
    for v in auto.get('returnVisits') or []:
        ws.append([v.get('date'), v.get('customerName'), v.get('phone'), v.get('region'), v.get('media'), v.get('sincerity'), v.get('salesperson1')])
    ws.append([])
    ws.append(['【有望客】'])
    ws.append(['日期', '類型', '姓名', '電話', '區域', '誠意度', '銷售'])
    style_header(ws, ws.max_row)
    for v in auto.get('hopeCustomers') or []:
        ws.append([v.get('date'), v.get('visitType'), v.get('customerName'), v.get('phone'), v.get('region'), v.get('sincerity'), v.get('salesperson1')])

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
