# -*- coding: utf-8 -*-
"""銷售總表：成交／簽約／未報／退戶明細，供週報與請佣摘要自動彙總。"""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime
from typing import Optional


RECORD_TYPES = {
    'deal': '成交（已報）',
    'unreported': '未報',
    'signing': '簽約',
    'purchase': '買進',
    'refund': '退換戶',
}

STATUS_ACTIVE = {'deal', 'unreported', 'signing', 'purchase'}


def init_sales_tables(conn: sqlite3.Connection):
    conn.executescript('''
        CREATE TABLE IF NOT EXISTS sales_deals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            site_id TEXT NOT NULL,
            record_type TEXT NOT NULL DEFAULT 'deal',
            unit_no TEXT NOT NULL DEFAULT '',
            customer_name TEXT NOT NULL DEFAULT '',
            phone TEXT NOT NULL DEFAULT '',
            product_type TEXT NOT NULL DEFAULT '',
            area_ping REAL NOT NULL DEFAULT 0,
            parking_count REAL NOT NULL DEFAULT 0,
            parking_nos TEXT NOT NULL DEFAULT '',
            list_price REAL NOT NULL DEFAULT 0,
            base_price REAL NOT NULL DEFAULT 0,
            total_price REAL NOT NULL DEFAULT 0,
            units REAL NOT NULL DEFAULT 1,
            deposit_date TEXT,
            sign_date TEXT,
            report_date TEXT,
            salesperson1 TEXT NOT NULL DEFAULT '',
            salesperson2 TEXT NOT NULL DEFAULT '',
            is_co_managed INTEGER NOT NULL DEFAULT 0,
            commission_claimable REAL NOT NULL DEFAULT 0,
            commission_claimed REAL NOT NULL DEFAULT 0,
            commission_booked REAL NOT NULL DEFAULT 0,
            next_month_claimable REAL NOT NULL DEFAULT 0,
            next_month_units REAL NOT NULL DEFAULT 0,
            next_month_parking REAL NOT NULL DEFAULT 0,
            customer_id INTEGER,
            memo TEXT NOT NULL DEFAULT '',
            extra TEXT NOT NULL DEFAULT '{}',
            created_by INTEGER,
            updated_by INTEGER,
            created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_sales_deals_site ON sales_deals(site_id);
        CREATE INDEX IF NOT EXISTS idx_sales_deals_type ON sales_deals(site_id, record_type);
        CREATE INDEX IF NOT EXISTS idx_sales_deals_report ON sales_deals(site_id, report_date);
        CREATE INDEX IF NOT EXISTS idx_sales_deals_sign ON sales_deals(site_id, sign_date);
    ''')


def _parse_date(value) -> Optional[str]:
    if value is None or value == '':
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    s = str(value).strip().replace('/', '-')
    if not s:
        return None
    # allow YYYY-MM-DD or with time
    try:
        return datetime.strptime(s[:10], '%Y-%m-%d').date().isoformat()
    except ValueError:
        return s[:10]


def _num(val, default=0.0) -> float:
    try:
        if val is None or val == '':
            return float(default)
        return float(val)
    except (TypeError, ValueError):
        return float(default)


def _truthy(val) -> bool:
    if isinstance(val, bool):
        return val
    if isinstance(val, (int, float)):
        return val != 0
    return str(val or '').strip().lower() in {'1', 'true', 'yes', 'y', '是', '有'}


def row_to_deal(row) -> dict:
    extra = {}
    try:
        extra = json.loads(row['extra'] or '{}')
    except (TypeError, json.JSONDecodeError):
        extra = {}
    return {
        'id': row['id'],
        'siteId': row['site_id'],
        'recordType': row['record_type'],
        'recordTypeLabel': RECORD_TYPES.get(row['record_type'], row['record_type']),
        'unitNo': row['unit_no'] or '',
        'customerName': row['customer_name'] or '',
        'phone': row['phone'] or '',
        'productType': row['product_type'] or '',
        'areaPing': row['area_ping'] or 0,
        'parkingCount': row['parking_count'] or 0,
        'parkingNos': row['parking_nos'] or '',
        'listPrice': row['list_price'] or 0,
        'basePrice': row['base_price'] or 0,
        'totalPrice': row['total_price'] or 0,
        'units': row['units'] if row['units'] is not None else 1,
        'depositDate': row['deposit_date'],
        'signDate': row['sign_date'],
        'reportDate': row['report_date'],
        'salesperson1': row['salesperson1'] or '',
        'salesperson2': row['salesperson2'] or '',
        'isCoManaged': bool(row['is_co_managed']),
        'commissionClaimable': row['commission_claimable'] or 0,
        'commissionClaimed': row['commission_claimed'] or 0,
        'commissionBooked': row['commission_booked'] or 0,
        'nextMonthClaimable': row['next_month_claimable'] or 0,
        'nextMonthUnits': row['next_month_units'] or 0,
        'nextMonthParking': row['next_month_parking'] or 0,
        'customerId': row['customer_id'],
        'memo': row['memo'] or '',
        'extra': extra,
        'createdAt': row['created_at'],
        'updatedAt': row['updated_at'],
    }


def list_sales_deals(
    conn: sqlite3.Connection,
    site_id: str,
    *,
    record_type: Optional[str] = None,
    q: str = '',
    limit: int = 500,
    offset: int = 0,
) -> tuple[list, int]:
    clauses = ['site_id = ?']
    params: list = [site_id]
    if record_type:
        clauses.append('record_type = ?')
        params.append(record_type)
    if q:
        clauses.append(
            '(unit_no LIKE ? OR customer_name LIKE ? OR phone LIKE ? OR salesperson1 LIKE ? OR parking_nos LIKE ?)'
        )
        like = f'%{q}%'
        params.extend([like, like, like, like, like])
    where = ' AND '.join(clauses)
    total = conn.execute(f'SELECT COUNT(*) AS c FROM sales_deals WHERE {where}', params).fetchone()['c']
    rows = conn.execute(
        f'''
        SELECT * FROM sales_deals
        WHERE {where}
        ORDER BY
          COALESCE(report_date, sign_date, deposit_date, '') DESC,
          id DESC
        LIMIT ? OFFSET ?
        ''',
        [*params, limit, offset],
    ).fetchall()
    return [row_to_deal(r) for r in rows], int(total)


def get_sales_deal(conn: sqlite3.Connection, deal_id: int, site_id: Optional[str] = None):
    if site_id:
        row = conn.execute(
            'SELECT * FROM sales_deals WHERE id = ? AND site_id = ?',
            (deal_id, site_id),
        ).fetchone()
    else:
        row = conn.execute('SELECT * FROM sales_deals WHERE id = ?', (deal_id,)).fetchone()
    return row_to_deal(row) if row else None


def normalize_deal_payload(body: dict) -> dict:
    record_type = str(body.get('recordType') or 'deal').strip()
    if record_type not in RECORD_TYPES:
        record_type = 'deal'
    s1 = str(body.get('salesperson1') or '').strip()
    s2 = str(body.get('salesperson2') or '').strip()
    co = _truthy(body.get('isCoManaged')) or bool(s1 and s2)
    return {
        'record_type': record_type,
        'unit_no': str(body.get('unitNo') or '').strip(),
        'customer_name': str(body.get('customerName') or '').strip(),
        'phone': str(body.get('phone') or '').strip(),
        'product_type': str(body.get('productType') or '').strip(),
        'area_ping': _num(body.get('areaPing')),
        'parking_count': _num(body.get('parkingCount')),
        'parking_nos': str(body.get('parkingNos') or '').strip(),
        'list_price': _num(body.get('listPrice')),
        'base_price': _num(body.get('basePrice')),
        'total_price': _num(body.get('totalPrice')),
        'units': _num(body.get('units'), 1),
        'deposit_date': _parse_date(body.get('depositDate')),
        'sign_date': _parse_date(body.get('signDate')),
        'report_date': _parse_date(body.get('reportDate')),
        'salesperson1': s1,
        'salesperson2': s2,
        'is_co_managed': 1 if co else 0,
        'commission_claimable': _num(body.get('commissionClaimable')),
        'commission_claimed': _num(body.get('commissionClaimed')),
        'commission_booked': _num(body.get('commissionBooked')),
        'next_month_claimable': _num(body.get('nextMonthClaimable')),
        'next_month_units': _num(body.get('nextMonthUnits')),
        'next_month_parking': _num(body.get('nextMonthParking')),
        'customer_id': int(body['customerId']) if body.get('customerId') not in (None, '') else None,
        'memo': str(body.get('memo') or '').strip(),
        'extra': json.dumps(body.get('extra') or {}, ensure_ascii=False),
    }


def create_sales_deal(conn: sqlite3.Connection, site_id: str, body: dict, user_id=None) -> int:
    data = normalize_deal_payload(body)
    cur = conn.execute(
        '''
        INSERT INTO sales_deals (
          site_id, record_type, unit_no, customer_name, phone, product_type,
          area_ping, parking_count, parking_nos, list_price, base_price, total_price, units,
          deposit_date, sign_date, report_date, salesperson1, salesperson2, is_co_managed,
          commission_claimable, commission_claimed, commission_booked,
          next_month_claimable, next_month_units, next_month_parking,
          customer_id, memo, extra, created_by, updated_by
        ) VALUES (
          ?,?,?,?,?,?,
          ?,?,?,?,?,?,?,
          ?,?,?,?,?,?,
          ?,?,?,
          ?,?,?,
          ?,?,?,?,?
        )
        ''',
        (
            site_id, data['record_type'], data['unit_no'], data['customer_name'], data['phone'], data['product_type'],
            data['area_ping'], data['parking_count'], data['parking_nos'], data['list_price'], data['base_price'],
            data['total_price'], data['units'],
            data['deposit_date'], data['sign_date'], data['report_date'], data['salesperson1'], data['salesperson2'],
            data['is_co_managed'],
            data['commission_claimable'], data['commission_claimed'], data['commission_booked'],
            data['next_month_claimable'], data['next_month_units'], data['next_month_parking'],
            data['customer_id'], data['memo'], data['extra'], user_id, user_id,
        ),
    )
    return cur.lastrowid


def update_sales_deal(conn: sqlite3.Connection, deal_id: int, site_id: str, body: dict, user_id=None) -> bool:
    existing = conn.execute(
        'SELECT id FROM sales_deals WHERE id = ? AND site_id = ?',
        (deal_id, site_id),
    ).fetchone()
    if not existing:
        return False
    data = normalize_deal_payload(body)
    conn.execute(
        '''
        UPDATE sales_deals SET
          record_type=?, unit_no=?, customer_name=?, phone=?, product_type=?,
          area_ping=?, parking_count=?, parking_nos=?, list_price=?, base_price=?, total_price=?, units=?,
          deposit_date=?, sign_date=?, report_date=?, salesperson1=?, salesperson2=?, is_co_managed=?,
          commission_claimable=?, commission_claimed=?, commission_booked=?,
          next_month_claimable=?, next_month_units=?, next_month_parking=?,
          customer_id=?, memo=?, extra=?, updated_by=?,
          updated_at=datetime('now', 'localtime')
        WHERE id=? AND site_id=?
        ''',
        (
            data['record_type'], data['unit_no'], data['customer_name'], data['phone'], data['product_type'],
            data['area_ping'], data['parking_count'], data['parking_nos'], data['list_price'], data['base_price'],
            data['total_price'], data['units'],
            data['deposit_date'], data['sign_date'], data['report_date'], data['salesperson1'], data['salesperson2'],
            data['is_co_managed'],
            data['commission_claimable'], data['commission_claimed'], data['commission_booked'],
            data['next_month_claimable'], data['next_month_units'], data['next_month_parking'],
            data['customer_id'], data['memo'], data['extra'], user_id,
            deal_id, site_id,
        ),
    )
    return True


def delete_sales_deal(conn: sqlite3.Connection, deal_id: int, site_id: str) -> bool:
    cur = conn.execute(
        'DELETE FROM sales_deals WHERE id = ? AND site_id = ?',
        (deal_id, site_id),
    )
    return cur.rowcount > 0


def _in_range(date_s: Optional[str], start, end) -> bool:
    if not date_s:
        return False
    try:
        d = datetime.strptime(str(date_s)[:10], '%Y-%m-%d').date()
    except ValueError:
        return False
    return start <= d <= end


def _block():
    return {'units': 0.0, 'parking': 0.0, 'amount': 0.0}


def aggregate_for_weekly(conn: sqlite3.Connection, site_id: str, start, end) -> dict:
    """彙總銷售總表 → 週報成交／簽約／買進／未報／請佣／去化建議值。"""
    rows = conn.execute(
        'SELECT * FROM sales_deals WHERE site_id = ?',
        (site_id,),
    ).fetchall()

    deals = _block()
    signings = _block()
    purchases = _block()
    unreported = _block()
    refunds = _block()

    sellable_amount = 0.0
    claimable_amount = 0.0
    claimed_amount = 0.0
    booked_amount = 0.0
    claimable_units = 0.0
    claimable_parking = 0.0
    claimed_units = 0.0
    claimed_parking = 0.0
    next_month_amount = 0.0
    next_month_units = 0.0
    next_month_parking = 0.0

    sold_units = 0.0
    sold_parking = 0.0
    sold_amount = 0.0
    sold_base = 0.0
    residential_sold = 0.0
    office_sold = 0.0

    week_deal_rows = []

    for row in rows:
        rt = row['record_type'] or 'deal'
        units = _num(row['units'], 1)
        parking = _num(row['parking_count'])
        amount = _num(row['total_price']) or _num(row['list_price'])
        base = _num(row['base_price'])
        report_d = row['report_date']
        sign_d = row['sign_date']
        deposit_d = row['deposit_date']

        # 累計請佣／銷售（不含退換戶，或退換戶沖銷）
        if rt == 'refund':
            sellable_amount -= amount
            sold_units -= units
            sold_parking -= parking
            sold_amount -= amount
            sold_base -= base
        elif rt in ('deal', 'signing', 'unreported', 'purchase'):
            # 已報／簽約／買進計入累積銷售；未報也常算入銷售金額但週報另列
            if rt != 'unreported':
                sellable_amount += amount
                sold_units += units
                sold_parking += parking
                sold_amount += amount
                sold_base += base
                pt = str(row['product_type'] or '')
                if '事務' in pt or '辦公' in pt:
                    office_sold += units
                elif pt:
                    residential_sold += units

            claimable_amount += _num(row['commission_claimable'])
            claimed_amount += _num(row['commission_claimed'])
            booked_amount += _num(row['commission_booked'])
            if _num(row['commission_claimable']) > 0:
                claimable_units += units
                claimable_parking += parking
            if _num(row['commission_claimed']) > 0:
                claimed_units += units
                claimed_parking += parking
            next_month_amount += _num(row['next_month_claimable'])
            next_month_units += _num(row['next_month_units'])
            next_month_parking += _num(row['next_month_parking'])

        # 本週區塊
        def add(block, u, p, a):
            block['units'] += u
            block['parking'] += p
            block['amount'] += a

        if rt == 'deal' and _in_range(report_d or sign_d or deposit_d, start, end):
            add(deals, units, parking, amount)
            week_deal_rows.append(row_to_deal(row))
        elif rt == 'signing' and _in_range(sign_d or report_d, start, end):
            add(signings, units, parking, amount)
        elif rt == 'purchase' and _in_range(report_d or sign_d or deposit_d, start, end):
            add(purchases, units, parking, amount)
        elif rt == 'unreported':
            # 未報：列在總表即計入未報小計（或本週新增的未報）
            if _in_range(report_d or deposit_d or sign_d, start, end) or not (report_d or deposit_d or sign_d):
                add(unreported, units, parking, amount)
        elif rt == 'refund' and _in_range(report_d or sign_d, start, end):
            add(refunds, units, parking, amount)

    def round_block(b):
        return {
            'units': round(b['units'], 2),
            'parking': round(b['parking'], 2),
            'amount': round(b['amount'], 2),
        }

    return {
        'deals': round_block(deals),
        'signings': round_block(signings),
        'purchases': round_block(purchases),
        'unreported': round_block(unreported),
        'refunds': round_block(refunds),
        'commission': {
            'sellableAmount': round(sellable_amount, 4),
            'claimableAmount': round(claimable_amount, 4),
            'claimedAmount': round(claimed_amount, 4),
            'bookedAmount': round(booked_amount, 4),
            'claimableUnits': round(claimable_units, 2),
            'claimableParking': round(claimable_parking, 2),
            'claimedUnits': round(claimed_units, 2),
            'claimedParking': round(claimed_parking, 2),
            'nextMonthUnits': round(next_month_units, 2),
            'nextMonthParking': round(next_month_parking, 2),
            'nextMonthAmount': round(next_month_amount, 4),
        },
        'inventory': {
            'soldUnits': round(max(sold_units, 0), 2),
            'soldParking': round(max(sold_parking, 0), 2),
            'soldAmount': round(max(sold_amount, 0), 2),
            'soldBasePrice': round(max(sold_base, 0), 2),
            'residentialSold': round(max(residential_sold, 0), 2),
            'officeSold': round(max(office_sold, 0), 2),
        },
        'weekDealCount': len(week_deal_rows),
        'weekDeals': week_deal_rows[:50],
        'totalRecords': len(rows),
    }
