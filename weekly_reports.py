# -*- coding: utf-8 -*-
"""Weekly report helpers: stats from customers + draft persistence + Excel export."""
from __future__ import annotations

import io
import json
import sqlite3
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Optional

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill, Border, Side
from openpyxl.utils import get_column_letter


WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']
HOPE_SINCERITY = {'A', 'A+', 'A-', 'B', 'B+', '有望', '高'}
FORMER_SALES_LABEL = '前期銷售'


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
        # null = 尚未選取（預設納入全部本週來人）；[] = 刻意報 0 組；[id…] = 僅報選取組
        'includedVisitorIds': None,
        'deals': {'units': 0, 'parking': 0, 'amount': 0},
        'signings': {'units': 0, 'parking': 0, 'amount': 0},
        'purchases': {'units': 0, 'parking': 0, 'amount': 0},
        'unreported': {'units': 0, 'parking': 0, 'amount': 0},
        'commission': {
            'sellableAmount': 0,
            'claimableAmount': 0,
            'claimedAmount': 0,
            'bookedAmount': 0,
            'claimableUnits': 0,
            'claimableParking': 0,
            'claimedUnits': 0,
            'claimedParking': 0,
            'nextMonthUnits': 0,
            'nextMonthParking': 0,
            'nextMonthAmount': 0,
        },
        'inventory': {
            'totalUnits': 122,
            'soldUnits': 0,
            'totalParking': 99,
            'soldParking': 0,
            'totalAmount': 175190,
            'soldAmount': 0,
            'soldBasePrice': 0,
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


def _truthy(val) -> bool:
    if isinstance(val, bool):
        return val
    s = str(val or '').strip().lower()
    return s in {'1', 'true', 'yes', 'y', '是', '有', '共同', '共同經營'}


def _num(val, default=0.0) -> float:
    try:
        if val is None or val == '':
            return float(default)
        return float(val)
    except (TypeError, ValueError):
        return float(default)


def _pct(part, whole, digits=1) -> float:
    if not whole:
        return 0.0
    return round(part / whole * 100, digits)


def _media_of(data: dict) -> str:
    media = data.get('media1') or data.get('media') or data.get('media2') or '未填'
    return str(media).strip() or '未填'


def _is_co_managed(data: dict) -> bool:
    if _truthy(data.get('isCoManaged')):
        return True
    s1 = str(data.get('salesperson1') or '').strip()
    s2 = str(data.get('salesperson2') or '').strip()
    return bool(s1 and s2)


def _sales_bucket(name: str, active_staff: Optional[set]) -> str:
    n = (name or '').strip() or '未填'
    if active_staff is not None and n not in active_staff and n != '未填':
        return FORMER_SALES_LABEL
    return n


def _credit_weight(data: dict) -> float:
    return 0.5 if _is_co_managed(data) else 1.0


def _dim_bucket():
    return {
        'priorVisits': 0.0, 'weekVisits': 0.0, 'cumVisits': 0.0,
        'priorDeals': 0.0, 'weekDeals': 0.0, 'cumDeals': 0.0,
        'priorAmount': 0.0, 'weekAmount': 0.0, 'cumAmount': 0.0,
    }


def _finalize_dimension(counter: dict, week_visits: float, week_deals: float,
                        cum_visits: float, cum_deals: float,
                        week_phones: float, cum_phones: float) -> list:
    rows = []
    for name, st in counter.items():
        st['cumVisits'] = st['priorVisits'] + st['weekVisits']
        st['cumDeals'] = st['priorDeals'] + st['weekDeals']
        st['cumAmount'] = st['priorAmount'] + st['weekAmount']
        rows.append({
            'name': name,
            'priorVisits': round(st['priorVisits'], 2),
            'weekVisits': round(st['weekVisits'], 2),
            'cumVisits': round(st['cumVisits'], 2),
            'priorDeals': round(st['priorDeals'], 2),
            'weekDeals': round(st['weekDeals'], 2),
            'cumDeals': round(st['cumDeals'], 2),
            'priorAmount': round(st['priorAmount'], 2),
            'weekAmount': round(st['weekAmount'], 2),
            'cumAmount': round(st['cumAmount'], 2),
            'weekVisitPct': _pct(st['weekVisits'], week_visits),
            'cumVisitPct': _pct(st['cumVisits'], cum_visits),
            'weekDealPct': _pct(st['weekDeals'], week_deals),
            'cumDealPct': _pct(st['cumDeals'], cum_deals),
            # 來電無法歸屬到區域／媒體，改以「佔當週／累計來人比例」對照來電總量僅供參考欄
            'weekPhonePct': _pct(st['weekVisits'], week_visits) if week_phones else 0.0,
            'cumPhonePct': _pct(st['cumVisits'], cum_visits) if cum_phones else 0.0,
            # 相容舊 UI
            'count': round(st['weekVisits'], 2),
        })
    rows.sort(key=lambda x: (-x['weekVisits'], -x['cumVisits'], x['name']))
    return rows


def build_auto_stats(
    conn: sqlite3.Connection,
    site_id: str,
    start,
    end,
    *,
    included_visitor_ids=None,
    active_staff=None,
    week_phone_total: float = 0,
) -> dict:
    """Build auto stats. included_visitor_ids=None means include all week visitors."""
    rows = conn.execute(
        'SELECT * FROM customers WHERE site_id = ?',
        (site_id,),
    ).fetchall()

    active_set = set(active_staff) if active_staff is not None else None
    include_set = None
    if included_visitor_ids is not None:
        include_set = {int(x) for x in included_visitor_ids}

    day_keys = [(start + timedelta(days=i)).isoformat() for i in range(7)]
    by_day = {k: {'new': 0.0, 'return': 0.0, 'deal': 0.0, 'total': 0.0} for k in day_keys}

    dim_all = {
        'region': defaultdict(_dim_bucket),
        'media': defaultdict(_dim_bucket),
        'occupation': defaultdict(_dim_bucket),
        'age': defaultdict(_dim_bucket),
        'source': defaultdict(_dim_bucket),
    }
    # 新客專用（區域／媒體／來源報表）
    dim_new = {
        'region': defaultdict(_dim_bucket),
        'media': defaultdict(_dim_bucket),
        'source': defaultdict(_dim_bucket),
    }

    visitors_all_week = []
    visitors = []
    return_visits = []
    deals = []
    hope_customers = []

    month_start = start.replace(day=1)
    year_start = start.replace(month=1, day=1)
    period = {
        'week': {'visits': 0.0, 'new': 0.0, 'return': 0.0, 'deals': 0.0, 'amount': 0.0},
        'month': {'visits': 0.0, 'new': 0.0, 'return': 0.0, 'deals': 0.0, 'amount': 0.0},
        'year': {'visits': 0.0, 'new': 0.0, 'return': 0.0, 'deals': 0.0, 'amount': 0.0},
        'all': {'visits': 0.0, 'new': 0.0, 'return': 0.0, 'deals': 0.0, 'amount': 0.0},
        'prior': {'visits': 0.0, 'new': 0.0, 'return': 0.0, 'deals': 0.0, 'amount': 0.0},
    }

    sales_stats = defaultdict(lambda: {
        'visits': 0.0, 'deals': 0.0, 'amount': 0.0, 'refunds': 0.0, 'refundAmount': 0.0,
        'weekVisits': 0.0, 'weekDeals': 0.0, 'weekAmount': 0.0, 'weekRefunds': 0.0,
    })

    def add_dim(store, key, weight, is_deal, amount, in_week, in_prior):
        if not key:
            key = '未填'
        st = store[key]
        if in_week:
            st['weekVisits'] += weight
            if is_deal:
                st['weekDeals'] += weight
                st['weekAmount'] += amount * weight
        elif in_prior:
            st['priorVisits'] += weight
            if is_deal:
                st['priorDeals'] += weight
                st['priorAmount'] += amount * weight

    for row in rows:
        data = json.loads(row['data'] or '{}')
        d = _record_date(row, data)
        vt = row['visit_type'] or ''
        is_new = vt != '回訪'
        is_deal = int(row['is_deal'] or 0) == 1
        is_refund = (
            _truthy(data.get('isRefund'))
            or bool(str(data.get('cancelDate') or '').strip())
            or str(data.get('customerStatus') or '').strip() == '退戶'
        )
        amount = _num(data.get('dealAmount'))
        refund_amount = _num(data.get('refundAmount'))
        weight = _credit_weight(data)
        staff1 = str(data.get('salesperson1') or '').strip() or '未填'
        staff2 = str(data.get('salesperson2') or '').strip()
        co = _is_co_managed(data)
        recipients = [staff1]
        if co and staff2:
            recipients = [staff1, staff2]
        elif co and not staff2:
            recipients = [staff1]

        region = str(data.get('region') or '未填').strip() or '未填'
        media = _media_of(data)
        occupation = str(data.get('occupation') or '未填').strip() or '未填'
        age = str(data.get('age') or '未填').strip() or '未填'
        source = str(data.get('customerSource') or '未填').strip() or '未填'
        sincerity = str(data.get('sincerity') or '').strip()

        in_week = bool(d and start <= d <= end)
        in_prior = bool(d and d < start)
        in_month = bool(d and d >= month_start)
        in_year = bool(d and d >= year_start)

        # 週報選取：僅影響「本週」呈現與本週小計；前期累計仍吃全歷史
        week_included = True
        if in_week and include_set is not None:
            week_included = int(row['id']) in include_set

        item = {
            'id': row['id'],
            'date': d.isoformat() if d else '',
            'visitType': vt,
            'isDeal': is_deal,
            'isRefund': is_refund,
            'isCoManaged': co,
            'dealAmount': amount,
            'refundAmount': refund_amount,
            'customerName': data.get('customerName') or '',
            'phone': data.get('phone') or '',
            'region': region,
            'media': media,
            'occupation': occupation,
            'age': age,
            'source': source,
            'sincerity': sincerity,
            'salesperson1': staff1,
            'salesperson2': staff2,
            'discussion': (data.get('discussion') or '')[:120],
            'included': week_included if in_week else None,
        }

        if in_week:
            visitors_all_week.append(item)

        # —— 銷售成交比（含共同經營拆分、前期銷售歸戶）——
        if d:
            for name in recipients:
                bucket = _sales_bucket(name, active_set)
                w = weight if len(recipients) == 1 else 0.5
                # 若只勾共同經營但沒填銷售2，仍算 0.5 給銷售1（另一半不歸戶）
                if co and len(recipients) == 1:
                    w = 0.5
                sales_stats[bucket]['visits'] += w
                if is_deal and not is_refund:
                    sales_stats[bucket]['deals'] += w
                    sales_stats[bucket]['amount'] += amount * w
                if is_refund:
                    sales_stats[bucket]['refunds'] += w
                    sales_stats[bucket]['refundAmount'] += refund_amount * w
                if in_week and week_included:
                    sales_stats[bucket]['weekVisits'] += w
                    if is_deal and not is_refund:
                        sales_stats[bucket]['weekDeals'] += w
                        sales_stats[bucket]['weekAmount'] += amount * w
                    if is_refund:
                        sales_stats[bucket]['weekRefunds'] += w

        if not d:
            continue

        # period / dims：本週僅計「有納入週報」者
        use_week = in_week and week_included

        def bump_period(key, w=1.0):
            period[key]['visits'] += w
            if is_new:
                period[key]['new'] += w
            else:
                period[key]['return'] += w
            if is_deal and not is_refund:
                period[key]['deals'] += w
                period[key]['amount'] += amount * w

        bump_period('all')
        if in_year:
            bump_period('year')
        if in_month:
            bump_period('month')
        if in_prior:
            bump_period('prior')
        if use_week:
            bump_period('week')

        # 維度：前期 + 本週（本週受選取過濾）
        for dim_key, dim_val in (
            ('region', region), ('media', media),
            ('occupation', occupation), ('age', age), ('source', source),
        ):
            add_dim(dim_all[dim_key], dim_val, 1.0, is_deal and not is_refund, amount, use_week, in_prior)
            if is_new and dim_key in dim_new:
                add_dim(dim_new[dim_key], dim_val, 1.0, is_deal and not is_refund, amount, use_week, in_prior)

        if not use_week:
            continue

        key = d.isoformat()
        if is_new:
            by_day[key]['new'] += 1
        else:
            by_day[key]['return'] += 1
        by_day[key]['total'] += 1
        if is_deal and not is_refund:
            by_day[key]['deal'] += 1

        visitors.append(item)
        if not is_new:
            return_visits.append(item)
        if is_deal and not is_refund:
            deals.append(item)
        if _is_hope(sincerity):
            hope_customers.append(item)

    visitors_all_week.sort(key=lambda x: (x['date'], x['id']))
    visitors.sort(key=lambda x: (x['date'], x['id']))
    return_visits.sort(key=lambda x: (x['date'], x['id']))
    deals.sort(key=lambda x: (x['date'], x['id']))
    hope_customers.sort(key=lambda x: (x['date'], x['id']))

    totals = {
        'new': sum(v['new'] for v in by_day.values()),
        'return': sum(v['return'] for v in by_day.values()),
        'deal': sum(v['deal'] for v in by_day.values()),
        'total': sum(v['total'] for v in by_day.values()),
        'actualTotal': len(visitors_all_week),
        'reportedTotal': len(visitors),
    }

    week_visits = period['week']['visits']
    week_deals = period['week']['deals']
    cum_visits = period['prior']['visits'] + period['week']['visits']
    cum_deals = period['prior']['deals'] + period['week']['deals']
    # 累計來電：僅有本週手填；前期來電無法從客資推得，cumPhone 暫用本週
    week_phones = float(week_phone_total or 0)
    cum_phones = week_phones

    def dims_pack(src):
        return {
            key: _finalize_dimension(
                src[key], week_visits, week_deals, cum_visits, cum_deals, week_phones, cum_phones,
            )
            for key in src
        }

    conversion = []
    for name, st in sales_stats.items():
        visits = st['visits']
        deal_n = st['deals']
        conversion.append({
            'name': name,
            'visits': round(visits, 2),
            'deals': round(deal_n, 2),
            'amount': round(st['amount'], 2),
            'refunds': round(st['refunds'], 2),
            'refundAmount': round(st['refundAmount'], 2),
            'rate': round((deal_n / visits * 100), 1) if visits else 0,
            'weekVisits': round(st['weekVisits'], 2),
            'weekDeals': round(st['weekDeals'], 2),
            'weekAmount': round(st['weekAmount'], 2),
            'weekRefunds': round(st['weekRefunds'], 2),
        })
    conversion.sort(key=lambda x: (
        0 if x['name'] == FORMER_SALES_LABEL else 1,
        -x['deals'], -x['visits'], x['name'],
    ))
    # 合計列
    if conversion:
        tot = {
            'name': '合計',
            'visits': round(sum(x['visits'] for x in conversion), 2),
            'deals': round(sum(x['deals'] for x in conversion), 2),
            'amount': round(sum(x['amount'] for x in conversion), 2),
            'refunds': round(sum(x['refunds'] for x in conversion), 2),
            'refundAmount': round(sum(x['refundAmount'] for x in conversion), 2),
            'weekVisits': round(sum(x['weekVisits'] for x in conversion), 2),
            'weekDeals': round(sum(x['weekDeals'] for x in conversion), 2),
            'weekAmount': round(sum(x['weekAmount'] for x in conversion), 2),
            'weekRefunds': round(sum(x['weekRefunds'] for x in conversion), 2),
        }
        tot['rate'] = round((tot['deals'] / tot['visits'] * 100), 1) if tot['visits'] else 0
        conversion.append(tot)

    all_dims = dims_pack(dim_all)
    new_dims = dims_pack(dim_new)

    return {
        'byDay': [
            {
                'date': k,
                'weekday': WEEKDAY_LABELS[i],
                'new': by_day[k]['new'],
                'return': by_day[k]['return'],
                'deal': by_day[k]['deal'],
                'total': by_day[k]['total'],
            }
            for i, k in enumerate(day_keys)
        ],
        'totals': totals,
        'period': period,
        # 相容舊欄位：區域／媒體／來源改為「僅新客」
        'byRegion': new_dims['region'],
        'byMedia': new_dims['media'],
        'bySource': new_dims['source'],
        'byOccupation': all_dims['occupation'],
        'byAge': all_dims['age'],
        'dimensions': {
            'all': all_dims,
            'newOnly': new_dims,
        },
        'conversion': conversion,
        'visitors': visitors,
        'visitorsAllWeek': visitors_all_week,
        'returnVisits': return_visits,
        'hopeCustomers': hope_customers,
        'dealsFromCustomers': deals,
    }


def inventory_summary(manual: dict) -> dict:
    inv = manual.get('inventory') or {}
    total_u = _num(inv.get('totalUnits'))
    sold_u = _num(inv.get('soldUnits'))
    total_p = _num(inv.get('totalParking'))
    sold_p = _num(inv.get('soldParking'))
    total_a = _num(inv.get('totalAmount'))
    sold_a = _num(inv.get('soldAmount'))
    sold_base = _num(inv.get('soldBasePrice'))
    res_t = _num(inv.get('residentialTotal'))
    res_s = _num(inv.get('residentialSold'))
    off_t = _num(inv.get('officeTotal'))
    off_s = _num(inv.get('officeSold'))
    # 未售金額以底價：總底價金額 - 已售底價（totalAmount 視為總底價）
    remain_base = max(total_a - sold_base, 0)
    return {
        'unitRate': round(sold_u / total_u * 100, 2) if total_u else 0,
        'parkingRate': round(sold_p / total_p * 100, 2) if total_p else 0,
        'amountRate': round(sold_a / total_a * 100, 2) if total_a else 0,
        'basePriceRate': round(sold_base / total_a * 100, 2) if total_a else 0,
        'residentialRate': round(res_s / res_t * 100, 2) if res_t else 0,
        'officeRate': round(off_s / off_t * 100, 2) if off_t else 0,
        'remainUnits': max(total_u - sold_u, 0),
        'remainParking': max(total_p - sold_p, 0),
        'remainAmount': max(total_a - sold_a, 0),
        'remainBasePrice': remain_base,
    }


def commission_summary(manual: dict) -> dict:
    c = manual.get('commission') or {}
    claimable_amt = _num(c.get('claimableAmount'))
    claimed_amt = _num(c.get('claimedAmount'))
    claimable_u = _num(c.get('claimableUnits'))
    claimed_u = _num(c.get('claimedUnits'))
    claimable_p = _num(c.get('claimableParking'))
    claimed_p = _num(c.get('claimedParking'))
    return {
        'unclaimedAmount': round(max(claimable_amt - claimed_amt, 0), 4),
        'unclaimedUnits': max(claimable_u - claimed_u, 0),
        'unclaimedParking': max(claimable_p - claimed_p, 0),
        'bookedAmount': round(_num(c.get('bookedAmount')), 4),
        'nextMonthUnits': _num(c.get('nextMonthUnits')),
        'nextMonthParking': _num(c.get('nextMonthParking')),
        'nextMonthAmount': round(_num(c.get('nextMonthAmount')), 4),
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


def _style_header(ws, row=1):
    header_font = Font(bold=True, color='FFFFFF')
    header_fill = PatternFill('solid', fgColor='1A4D7C')
    for cell in ws[row]:
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal='center', wrap_text=True)


def _append_dim_table(ws, title, rows):
    if title:
        ws.append([title])
    ws.append([
        '項目', '前期累計(來人)', '本週小計(來人)', '目前累計(來人)',
        '佔本週來人%', '佔累計來人%',
        '前期成交', '本週成交', '累計成交',
        '佔本週成交%', '佔累計成交%',
    ])
    _style_header(ws, ws.max_row)
    for r in rows or []:
        ws.append([
            r.get('name'), r.get('priorVisits'), r.get('weekVisits'), r.get('cumVisits'),
            r.get('weekVisitPct'), r.get('cumVisitPct'),
            r.get('priorDeals'), r.get('weekDeals'), r.get('cumDeals'),
            r.get('weekDealPct'), r.get('cumDealPct'),
        ])
    ws.append([])


def build_weekly_excel(site_name: str, start, end, week_number, manual: dict, auto: dict) -> bytes:
    wb = Workbook()
    inv = inventory_summary(manual)
    com = commission_summary(manual)
    thin = Border(
        left=Side(style='thin', color='CCCCCC'),
        right=Side(style='thin', color='CCCCCC'),
        top=Side(style='thin', color='CCCCCC'),
        bottom=Side(style='thin', color='CCCCCC'),
    )

    # —— 週報一覽（接近 PPT 閱讀順序，單頁）——
    ws = wb.active
    ws.title = '週報一覽'
    t = auto.get('totals') or {}
    p = auto.get('period') or {}
    phone_sum = sum(_num(d.get('phoneCalls')) for d in (manual.get('days') or []))
    deals = manual.get('deals') or {}
    signings = manual.get('signings') or {}
    purchases = manual.get('purchases') or {}

    ws.append([f'{site_name}　第{week_number}週週報告'])
    ws['A1'].font = Font(bold=True, size=16, color='1A4D7C')
    ws.append([f'區間：{start.isoformat()} ～ {end.isoformat()}'])
    ws.append([])
    ws.append(['一、本週來人成交狀況'])
    ws.append(['項目', '數值', '項目', '數值'])
    _style_header(ws, ws.max_row)
    overview_pairs = [
        ('本週來人(組)', t.get('total', 0), '實際來人(組)', t.get('actualTotal', t.get('total', 0))),
        ('本週新客／回訪', f"{t.get('new', 0)} / {t.get('return', 0)}", '本週來電(通)', phone_sum),
        ('本週成交(戶/車/萬)', f"{deals.get('units', 0)}/{deals.get('parking', 0)}/{deals.get('amount', 0)}",
         '本週簽約(戶/車/萬)', f"{signings.get('units', 0)}/{signings.get('parking', 0)}/{signings.get('amount', 0)}"),
        ('本週買進(戶/車/萬)', f"{purchases.get('units', 0)}/{purchases.get('parking', 0)}/{purchases.get('amount', 0)}",
         '客資成交筆數', t.get('deal', 0)),
        ('本月來人／成交', f"{(p.get('month') or {}).get('visits', 0)} / {(p.get('month') or {}).get('deals', 0)}",
         '本年來人／成交', f"{(p.get('year') or {}).get('visits', 0)} / {(p.get('year') or {}).get('deals', 0)}"),
        ('去化率(戶/底價%)', f"{inv['unitRate']}% / {inv['basePriceRate']}%",
         '未售底價(萬)', inv['remainBasePrice']),
        ('可請佣-已請(萬)', com['unclaimedAmount'], '已入帳(萬)', com['bookedAmount']),
        ('預計下月可請(戶/車/萬)',
         f"{com['nextMonthUnits']}/{com['nextMonthParking']}/{com['nextMonthAmount']}",
         '剩餘戶／車', f"{inv['remainUnits']} / {inv['remainParking']}"),
    ]
    for a, b, c, d in overview_pairs:
        ws.append([a, b, c, d])
    ws.append([])
    ws.append(['二、成交檢討'])
    ws.append([manual.get('reviewNotes') or ''])
    ws.merge_cells(start_row=ws.max_row, start_column=1, end_row=ws.max_row, end_column=4)
    ws.append(['三、區域個案分析'])
    ws.append([manual.get('competitorNotes') or ''])
    ws.merge_cells(start_row=ws.max_row, start_column=1, end_row=ws.max_row, end_column=4)
    ws.append(['備註', manual.get('memo') or ''])
    ws.append([])
    ws.append(['四、銷售成交比'])
    ws.append(['銷售人員', '累計接待', '累計成交', '成交率%', '成交金額', '退戶組數', '退戶金額',
               '本週接待', '本週成交', '本週金額'])
    _style_header(ws, ws.max_row)
    for row in auto.get('conversion') or []:
        ws.append([
            row.get('name'), row.get('visits'), row.get('deals'), row.get('rate'),
            row.get('amount'), row.get('refunds'), row.get('refundAmount'),
            row.get('weekVisits'), row.get('weekDeals'), row.get('weekAmount'),
        ])
    ws.append([])
    ws.append(['五、來人區域分析（新客）'])
    _append_dim_table(ws, '', auto.get('byRegion') or [])
    # _append_dim_table already added header; fix by writing region inline without duplicate title
    # Actually _append_dim_table adds title then header - for section we already have title. OK.

    ws.append(['六、來人媒體分析（新客）'])
    _append_dim_table(ws, '', auto.get('byMedia') or [])
    ws.append(['七、職業／年齡分析'])
    _append_dim_table(ws, '職業', auto.get('byOccupation') or [])
    _append_dim_table(ws, '年齡', auto.get('byAge') or [])

    for col in range(1, 12):
        ws.column_dimensions[get_column_letter(col)].width = 14
    ws.column_dimensions['A'].width = 22

    # —— 每日 ——
    ws = wb.create_sheet('每日統計')
    ws.append(['日期', '星期', '新客', '回訪', '合計', '成交', '來電', '天氣'])
    _style_header(ws)
    days = manual.get('days') or []
    for i, d in enumerate(auto.get('byDay') or []):
        m = days[i] if i < len(days) else {}
        ws.append([
            d.get('date'), d.get('weekday'), d.get('new'), d.get('return'),
            d.get('total'), d.get('deal'), m.get('phoneCalls', 0), m.get('weather', ''),
        ])

    # —— 成交比 ——
    ws = wb.create_sheet('成交比')
    ws.append(['銷售人員', '累計接待', '累計成交', '成交率%', '成交金額', '退戶組數', '退戶金額',
               '本週接待', '本週成交', '本週金額', '本週退戶'])
    _style_header(ws)
    for row in auto.get('conversion') or []:
        ws.append([
            row.get('name'), row.get('visits'), row.get('deals'), row.get('rate'),
            row.get('amount'), row.get('refunds'), row.get('refundAmount'),
            row.get('weekVisits'), row.get('weekDeals'), row.get('weekAmount'), row.get('weekRefunds'),
        ])

    # —— 去化／請佣 ——
    ws = wb.create_sheet('去化與請佣')
    inv_m = manual.get('inventory') or {}
    ws.append(['去化項目', '數值'])
    _style_header(ws)
    for label, key in [
        ('總戶數', 'totalUnits'), ('已售戶數', 'soldUnits'),
        ('總車位', 'totalParking'), ('已售車位', 'soldParking'),
        ('總金額／總底價(萬)', 'totalAmount'), ('已售表價(萬)', 'soldAmount'),
        ('已售底價(萬)', 'soldBasePrice'),
        ('住宅總戶', 'residentialTotal'), ('住宅已售', 'residentialSold'),
        ('事務所總戶', 'officeTotal'), ('事務所已售', 'officeSold'),
    ]:
        ws.append([label, inv_m.get(key, 0)])
    ws.append(['戶數去化率%', inv['unitRate']])
    ws.append(['底價去化率%', inv['basePriceRate']])
    ws.append(['未售底價(萬)', inv['remainBasePrice']])
    ws.append([])
    ws.append(['請佣項目', '數值'])
    _style_header(ws, ws.max_row)
    c = manual.get('commission') or {}
    for label, key in [
        ('累積銷售金額(萬)', 'sellableAmount'),
        ('可請佣金額(萬)', 'claimableAmount'),
        ('已請佣金額(萬)', 'claimedAmount'),
        ('已入帳金額(萬)', 'bookedAmount'),
        ('可請佣戶數', 'claimableUnits'),
        ('已請佣戶數', 'claimedUnits'),
        ('可請佣車位', 'claimableParking'),
        ('已請佣車位', 'claimedParking'),
        ('預計下月可請戶數', 'nextMonthUnits'),
        ('預計下月可請車位', 'nextMonthParking'),
        ('預計下月可請金額(萬)', 'nextMonthAmount'),
    ]:
        ws.append([label, c.get(key, 0)])
    ws.append(['未請佣金額(萬)', com['unclaimedAmount']])
    ws.append(['未請佣戶數', com['unclaimedUnits']])
    ws.append(['未請佣車位', com['unclaimedParking']])

    # —— 維度詳表 ——
    ws = wb.create_sheet('區域媒體職業年齡')
    for title, rows in [
        ('區域（新客）', auto.get('byRegion')),
        ('媒體（新客）', auto.get('byMedia')),
        ('來源（新客）', auto.get('bySource')),
        ('職業', auto.get('byOccupation')),
        ('年齡', auto.get('byAge')),
    ]:
        _append_dim_table(ws, title, rows)

    # —— 客況（僅納入週報者）——
    ws = wb.create_sheet('本週客況')
    ws.append(['納入', '日期', '類型', '姓名', '電話', '區域', '媒體', '職業', '年齡', '來源',
               '誠意度', '銷售1', '銷售2', '共同', '成交', '成交金額', '退戶', '洽談'])
    _style_header(ws)
    for v in auto.get('visitors') or []:
        ws.append([
            '是', v.get('date'), v.get('visitType'), v.get('customerName'), v.get('phone'),
            v.get('region'), v.get('media'), v.get('occupation'), v.get('age'), v.get('source'),
            v.get('sincerity'), v.get('salesperson1'), v.get('salesperson2'),
            '是' if v.get('isCoManaged') else '否',
            '是' if v.get('isDeal') else '否', v.get('dealAmount'),
            '是' if v.get('isRefund') else '否', v.get('discussion'),
        ])

    ws = wb.create_sheet('回訪與有望客')
    ws.append(['【回訪】'])
    ws.append(['日期', '姓名', '電話', '區域', '媒體', '誠意度', '銷售'])
    _style_header(ws, ws.max_row)
    for v in auto.get('returnVisits') or []:
        ws.append([v.get('date'), v.get('customerName'), v.get('phone'), v.get('region'),
                   v.get('media'), v.get('sincerity'), v.get('salesperson1')])
    ws.append([])
    ws.append(['【有望客】'])
    ws.append(['日期', '類型', '姓名', '電話', '區域', '誠意度', '銷售'])
    _style_header(ws, ws.max_row)
    for v in auto.get('hopeCustomers') or []:
        ws.append([v.get('date'), v.get('visitType'), v.get('customerName'), v.get('phone'),
                   v.get('region'), v.get('sincerity'), v.get('salesperson1')])

    # 套用細邊框於一覽表數值區（輕量）
    for sheet in wb.worksheets:
        for row in sheet.iter_rows(min_row=1, max_row=min(sheet.max_row, 80), max_col=min(sheet.max_column, 12)):
            for cell in row:
                if cell.value is not None:
                    cell.border = thin

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
