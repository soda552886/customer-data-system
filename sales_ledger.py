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

# 案場請佣預設（可於單筆覆寫）
SITE_COMMISSION_DEFAULTS = {
    'libao_duoyi': {
        'rate': 0.0485,
        'payableRatio': 0.97,
        'retentionRatio': 0.03,
        'label': '鐸藝預設：底價×4.85%，本期可請97%，保留款3%',
    },
    '_default': {
        'rate': 0.0485,
        'payableRatio': 0.97,
        'retentionRatio': 0.03,
        'label': '預設：底價×4.85%，本期可請97%，保留款3%',
    },
}


def commission_defaults_for_site(site_id: str) -> dict:
    return dict(SITE_COMMISSION_DEFAULTS.get(site_id) or SITE_COMMISSION_DEFAULTS['_default'])


def _round4(val) -> float:
    return round(float(val or 0), 4)


def _as_ratio(val: float) -> float:
    """接受 0.0485 或 4.85（百分比）寫法。"""
    v = float(val or 0)
    if v > 1:
        return v / 100.0
    return v


def compute_commission(
    *,
    site_id: str,
    base_total: float,
    actual_total: float,
    body: dict,
) -> dict:
    """依底價／成交價自動算請佣；填期別或日期後已請＝97%可請金額。"""
    defaults = commission_defaults_for_site(site_id)
    mode = str(body.get('commissionBaseMode') or 'base').strip().lower()
    if mode not in ('base', 'deal'):
        mode = 'base'
    rate = _as_ratio(_num(body.get('commissionRate'), defaults['rate']))
    payable_ratio = _as_ratio(_num(body.get('commissionPayableRatio'), defaults['payableRatio']))
    retention_ratio = _as_ratio(_num(body.get('commissionRetentionRatio'), defaults['retentionRatio']))
    deduction = max(_num(body.get('commissionDeduction')), 0)

    suggested = base_total if mode == 'base' else actual_total
    # 有明確覆寫時用覆寫值（對應 Excel 紅字改拉成交價／特殊金額）
    if body.get('commissionSalesAmount') not in (None, ''):
        sales_amount = _num(body.get('commissionSalesAmount'), suggested)
    else:
        sales_amount = suggested

    claimable = max(sales_amount * rate - deduction, 0)
    payable = claimable * payable_ratio
    retention = claimable * retention_ratio

    period = str(body.get('commissionPeriod') or '').strip()
    claim_date = _parse_date(body.get('commissionClaimDate'))
    is_claimed = bool(period or claim_date)
    claimed = payable if is_claimed else 0.0
    unclaimed = max(claimable - claimed, 0)

    return {
        'commission_base_mode': mode,
        'commission_sales_amount': _round4(sales_amount),
        'commission_rate': rate,
        'commission_payable_ratio': payable_ratio,
        'commission_retention_ratio': retention_ratio,
        'commission_deduction': _round4(deduction),
        'commission_claimable': _round4(claimable),
        'commission_payable': _round4(payable),
        'commission_retention': _round4(retention),
        'commission_period': period,
        'commission_claim_date': claim_date,
        'commission_claimed': _round4(claimed),
        'commission_unclaimed': _round4(unclaimed),
        'commission_status': '已請' if is_claimed else '未請',
    }


def init_sales_tables(conn: sqlite3.Connection):
    conn.executescript('''
        CREATE TABLE IF NOT EXISTS sales_deals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            site_id TEXT NOT NULL,
            record_type TEXT NOT NULL DEFAULT 'deal',
            order_no TEXT NOT NULL DEFAULT '',
            unit_no TEXT NOT NULL DEFAULT '',
            customer_name TEXT NOT NULL DEFAULT '',
            phone TEXT NOT NULL DEFAULT '',
            product_type TEXT NOT NULL DEFAULT '',
            area_ping REAL NOT NULL DEFAULT 0,
            parking_count REAL NOT NULL DEFAULT 0,
            parking_nos TEXT NOT NULL DEFAULT '',
            parking_no1 TEXT NOT NULL DEFAULT '',
            parking_no2 TEXT NOT NULL DEFAULT '',
            list_price REAL NOT NULL DEFAULT 0,
            base_price REAL NOT NULL DEFAULT 0,
            total_price REAL NOT NULL DEFAULT 0,
            house_sale_price REAL NOT NULL DEFAULT 0,
            parking_sale_price REAL NOT NULL DEFAULT 0,
            actual_house_price REAL NOT NULL DEFAULT 0,
            actual_total_price REAL NOT NULL DEFAULT 0,
            surcharge REAL NOT NULL DEFAULT 0,
            appliance_gift REAL NOT NULL DEFAULT 0,
            pickup_voucher REAL NOT NULL DEFAULT 0,
            decoration REAL NOT NULL DEFAULT 0,
            company_loan_interest REAL NOT NULL DEFAULT 0,
            house_base_price REAL NOT NULL DEFAULT 0,
            parking_base_price REAL NOT NULL DEFAULT 0,
            excess_price REAL NOT NULL DEFAULT 0,
            units REAL NOT NULL DEFAULT 1,
            deposit_date TEXT,
            supplement_date TEXT,
            sign_date TEXT,
            report_date TEXT,
            owner_sale_report_date TEXT,
            owner_sign_report_date TEXT,
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
    # SQLite CREATE TABLE IF NOT EXISTS 不會替既有表補欄位，逐欄升級。
    migrations = {
        'order_no': "TEXT NOT NULL DEFAULT ''",
        'parking_no1': "TEXT NOT NULL DEFAULT ''",
        'parking_no2': "TEXT NOT NULL DEFAULT ''",
        'house_sale_price': 'REAL NOT NULL DEFAULT 0',
        'parking_sale_price': 'REAL NOT NULL DEFAULT 0',
        'actual_house_price': 'REAL NOT NULL DEFAULT 0',
        'actual_total_price': 'REAL NOT NULL DEFAULT 0',
        'surcharge': 'REAL NOT NULL DEFAULT 0',
        'appliance_gift': 'REAL NOT NULL DEFAULT 0',
        'pickup_voucher': 'REAL NOT NULL DEFAULT 0',
        'decoration': 'REAL NOT NULL DEFAULT 0',
        'company_loan_interest': 'REAL NOT NULL DEFAULT 0',
        'house_base_price': 'REAL NOT NULL DEFAULT 0',
        'parking_base_price': 'REAL NOT NULL DEFAULT 0',
        'excess_price': 'REAL NOT NULL DEFAULT 0',
        'supplement_date': 'TEXT',
        'owner_sale_report_date': 'TEXT',
        'owner_sign_report_date': 'TEXT',
        'commission_base_mode': "TEXT NOT NULL DEFAULT 'base'",
        'commission_sales_amount': 'REAL NOT NULL DEFAULT 0',
        'commission_rate': 'REAL NOT NULL DEFAULT 0.0485',
        'commission_payable_ratio': 'REAL NOT NULL DEFAULT 0.97',
        'commission_retention_ratio': 'REAL NOT NULL DEFAULT 0.03',
        'commission_deduction': 'REAL NOT NULL DEFAULT 0',
        'commission_payable': 'REAL NOT NULL DEFAULT 0',
        'commission_retention': 'REAL NOT NULL DEFAULT 0',
        'commission_period': "TEXT NOT NULL DEFAULT ''",
        'commission_claim_date': 'TEXT',
        'commission_unclaimed': 'REAL NOT NULL DEFAULT 0',
    }
    existing = {
        row['name'] for row in conn.execute('PRAGMA table_info(sales_deals)').fetchall()
    }
    for name, definition in migrations.items():
        if name not in existing:
            conn.execute(f'ALTER TABLE sales_deals ADD COLUMN {name} {definition}')


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
        'orderNo': row['order_no'] or '',
        'unitNo': row['unit_no'] or '',
        'customerName': row['customer_name'] or '',
        'phone': row['phone'] or '',
        'productType': row['product_type'] or '',
        'areaPing': row['area_ping'] or 0,
        'parkingCount': row['parking_count'] or 0,
        'parkingNos': row['parking_nos'] or '',
        'parkingNo1': row['parking_no1'] or '',
        'parkingNo2': row['parking_no2'] or '',
        'listPrice': row['list_price'] or 0,
        'basePrice': row['base_price'] or 0,
        'totalPrice': row['total_price'] or 0,
        'contractTotal': row['total_price'] or 0,
        'houseSalePrice': row['house_sale_price'] or 0,
        'parkingSalePrice': row['parking_sale_price'] or 0,
        'actualHousePrice': row['actual_house_price'] or 0,
        'actualTotalPrice': row['actual_total_price'] or 0,
        'surcharge': row['surcharge'] or 0,
        'applianceGift': row['appliance_gift'] or 0,
        'pickupVoucher': row['pickup_voucher'] or 0,
        'decoration': row['decoration'] or 0,
        'companyLoanInterest': row['company_loan_interest'] or 0,
        'houseBasePrice': row['house_base_price'] or 0,
        'parkingBasePrice': row['parking_base_price'] or 0,
        'baseTotal': row['base_price'] or 0,
        'excessPrice': row['excess_price'] or 0,
        'units': row['units'] if row['units'] is not None else 1,
        'depositDate': row['deposit_date'],
        'supplementDate': row['supplement_date'],
        'signDate': row['sign_date'],
        'reportDate': row['report_date'],
        'ownerSaleReportDate': row['owner_sale_report_date'] or row['report_date'],
        'ownerSignReportDate': row['owner_sign_report_date'],
        'salesperson1': row['salesperson1'] or '',
        'salesperson2': row['salesperson2'] or '',
        'isCoManaged': bool(row['is_co_managed']),
        'commissionBaseMode': (row['commission_base_mode'] if 'commission_base_mode' in row.keys() else None) or 'base',
        'commissionSalesAmount': row['commission_sales_amount'] if 'commission_sales_amount' in row.keys() else 0,
        'commissionRate': row['commission_rate'] if 'commission_rate' in row.keys() else 0.0485,
        'commissionPayableRatio': row['commission_payable_ratio'] if 'commission_payable_ratio' in row.keys() else 0.97,
        'commissionRetentionRatio': row['commission_retention_ratio'] if 'commission_retention_ratio' in row.keys() else 0.03,
        'commissionDeduction': row['commission_deduction'] if 'commission_deduction' in row.keys() else 0,
        'commissionClaimable': row['commission_claimable'] or 0,
        'commissionPayable': row['commission_payable'] if 'commission_payable' in row.keys() else 0,
        'commissionRetention': row['commission_retention'] if 'commission_retention' in row.keys() else 0,
        'commissionPeriod': (row['commission_period'] if 'commission_period' in row.keys() else '') or '',
        'commissionClaimDate': row['commission_claim_date'] if 'commission_claim_date' in row.keys() else None,
        'commissionClaimed': row['commission_claimed'] or 0,
        'commissionUnclaimed': row['commission_unclaimed'] if 'commission_unclaimed' in row.keys() else 0,
        'commissionStatus': '已請' if (
            (row['commission_period'] if 'commission_period' in row.keys() else '')
            or (row['commission_claim_date'] if 'commission_claim_date' in row.keys() else None)
        ) else '未請',
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
            '(order_no LIKE ? OR unit_no LIKE ? OR customer_name LIKE ? OR phone LIKE ? '
            'OR salesperson1 LIKE ? OR parking_nos LIKE ? OR parking_no1 LIKE ? OR parking_no2 LIKE ?)'
        )
        like = f'%{q}%'
        params.extend([like] * 8)
    where = ' AND '.join(clauses)
    total = conn.execute(f'SELECT COUNT(*) AS c FROM sales_deals WHERE {where}', params).fetchone()['c']
    rows = conn.execute(
        f'''
        SELECT * FROM sales_deals
        WHERE {where}
        ORDER BY
          COALESCE(owner_sale_report_date, report_date, sign_date, deposit_date, '') DESC,
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


def normalize_deal_payload(body: dict, site_id: str = '') -> dict:
    record_type = str(body.get('recordType') or 'deal').strip()
    if record_type not in RECORD_TYPES:
        record_type = 'deal'
    s1 = str(body.get('salesperson1') or '').strip()
    s2 = str(body.get('salesperson2') or '').strip()
    co = _truthy(body.get('isCoManaged')) or bool(s1 and s2)
    house_sale = _num(body.get('houseSalePrice'))
    parking_sale = _num(body.get('parkingSalePrice'))
    surcharge = _num(body.get('surcharge'))
    appliance_gift = _num(body.get('applianceGift'))
    pickup_voucher = _num(body.get('pickupVoucher'))
    decoration = _num(body.get('decoration'))
    company_loan_interest = _num(body.get('companyLoanInterest'))
    house_base = _num(body.get('houseBasePrice'))
    parking_base = _num(body.get('parkingBasePrice'))
    deductions = (
        surcharge + appliance_gift + pickup_voucher
        + decoration + company_loan_interest
    )
    contract_total = house_sale + parking_sale
    actual_house = house_sale - deductions
    actual_total = actual_house + parking_sale
    base_total = house_base + parking_base
    excess = contract_total - base_total - deductions
    parking_no1 = str(body.get('parkingNo1') or '').strip()
    parking_no2 = str(body.get('parkingNo2') or '').strip()
    parking_nos = '、'.join(x for x in (parking_no1, parking_no2) if x)
    parking_count = sum(1 for x in (parking_no1, parking_no2) if x)
    # 相容舊資料／API：尚未拆分房售、車售時保留既有總價。
    if contract_total == 0 and _num(body.get('totalPrice')):
        contract_total = _num(body.get('totalPrice'))
        actual_house = contract_total - deductions
        actual_total = actual_house
        excess = contract_total - base_total - deductions
    if base_total == 0 and _num(body.get('basePrice')):
        base_total = _num(body.get('basePrice'))
        excess = contract_total - base_total - deductions
    if not parking_nos:
        parking_nos = str(body.get('parkingNos') or '').strip()
        parking_count = _num(body.get('parkingCount'))

    site = site_id or str(body.get('siteId') or '').strip()
    comm = compute_commission(
        site_id=site,
        base_total=base_total,
        actual_total=actual_total,
        body=body,
    )

    return {
        'record_type': record_type,
        'order_no': str(body.get('orderNo') or '').strip(),
        'unit_no': str(body.get('unitNo') or '').strip(),
        'customer_name': str(body.get('customerName') or '').strip(),
        'phone': str(body.get('phone') or '').strip(),
        'product_type': str(body.get('productType') or '').strip(),
        'area_ping': _num(body.get('areaPing')),
        'parking_count': parking_count,
        'parking_nos': parking_nos,
        'parking_no1': parking_no1,
        'parking_no2': parking_no2,
        'list_price': _num(body.get('listPrice')),
        'base_price': base_total,
        'total_price': contract_total,
        'house_sale_price': house_sale,
        'parking_sale_price': parking_sale,
        'actual_house_price': actual_house,
        'actual_total_price': actual_total,
        'surcharge': surcharge,
        'appliance_gift': appliance_gift,
        'pickup_voucher': pickup_voucher,
        'decoration': decoration,
        'company_loan_interest': company_loan_interest,
        'house_base_price': house_base,
        'parking_base_price': parking_base,
        'excess_price': excess,
        'units': _num(body.get('units'), 1),
        'deposit_date': _parse_date(body.get('depositDate')),
        'supplement_date': _parse_date(body.get('supplementDate')),
        'sign_date': _parse_date(body.get('signDate')),
        'report_date': _parse_date(body.get('ownerSaleReportDate') or body.get('reportDate')),
        'owner_sale_report_date': _parse_date(body.get('ownerSaleReportDate') or body.get('reportDate')),
        'owner_sign_report_date': _parse_date(body.get('ownerSignReportDate')),
        'salesperson1': s1,
        'salesperson2': s2,
        'is_co_managed': 1 if co else 0,
        'commission_base_mode': comm['commission_base_mode'],
        'commission_sales_amount': comm['commission_sales_amount'],
        'commission_rate': comm['commission_rate'],
        'commission_payable_ratio': comm['commission_payable_ratio'],
        'commission_retention_ratio': comm['commission_retention_ratio'],
        'commission_deduction': comm['commission_deduction'],
        'commission_claimable': comm['commission_claimable'],
        'commission_payable': comm['commission_payable'],
        'commission_retention': comm['commission_retention'],
        'commission_period': comm['commission_period'],
        'commission_claim_date': comm['commission_claim_date'],
        'commission_claimed': comm['commission_claimed'],
        'commission_unclaimed': comm['commission_unclaimed'],
        'commission_booked': _num(body.get('commissionBooked')),
        'next_month_claimable': _num(body.get('nextMonthClaimable')),
        'next_month_units': _num(body.get('nextMonthUnits')),
        'next_month_parking': _num(body.get('nextMonthParking')),
        'customer_id': int(body['customerId']) if body.get('customerId') not in (None, '') else None,
        'memo': str(body.get('memo') or '').strip(),
        'extra': json.dumps(body.get('extra') or {}, ensure_ascii=False),
    }


def create_sales_deal(conn: sqlite3.Connection, site_id: str, body: dict, user_id=None) -> int:
    data = normalize_deal_payload(body, site_id=site_id)
    cur = conn.execute(
        '''
        INSERT INTO sales_deals (
          site_id, record_type, order_no, unit_no, customer_name, phone, product_type,
          area_ping, parking_count, parking_nos, parking_no1, parking_no2,
          list_price, base_price, total_price,
          house_sale_price, parking_sale_price, actual_house_price, actual_total_price,
          surcharge, appliance_gift, pickup_voucher, decoration, company_loan_interest,
          house_base_price, parking_base_price, excess_price, units,
          deposit_date, supplement_date, sign_date, report_date,
          owner_sale_report_date, owner_sign_report_date,
          salesperson1, salesperson2, is_co_managed,
          commission_base_mode, commission_sales_amount, commission_rate,
          commission_payable_ratio, commission_retention_ratio, commission_deduction,
          commission_claimable, commission_payable, commission_retention,
          commission_period, commission_claim_date, commission_claimed, commission_unclaimed,
          commission_booked,
          next_month_claimable, next_month_units, next_month_parking,
          customer_id, memo, extra, created_by, updated_by
        ) VALUES (
          ?,?,?,?,?,?,?,
          ?,?,?,?,?,
          ?,?,?,
          ?,?,?,?,
          ?,?,?,?,?,
          ?,?,?,?,
          ?,?,?,?,?,?,
          ?,?,?,
          ?,?,?,?,?,?,
          ?,?,?,
          ?,?,?,?,
          ?,
          ?,?,?,
          ?,?,?,?,?
        )
        ''',
        (
            site_id, data['record_type'], data['order_no'], data['unit_no'], data['customer_name'],
            data['phone'], data['product_type'],
            data['area_ping'], data['parking_count'], data['parking_nos'],
            data['parking_no1'], data['parking_no2'],
            data['list_price'], data['base_price'], data['total_price'],
            data['house_sale_price'], data['parking_sale_price'], data['actual_house_price'],
            data['actual_total_price'], data['surcharge'], data['appliance_gift'],
            data['pickup_voucher'], data['decoration'], data['company_loan_interest'],
            data['house_base_price'], data['parking_base_price'], data['excess_price'], data['units'],
            data['deposit_date'], data['supplement_date'], data['sign_date'], data['report_date'],
            data['owner_sale_report_date'], data['owner_sign_report_date'],
            data['salesperson1'], data['salesperson2'],
            data['is_co_managed'],
            data['commission_base_mode'], data['commission_sales_amount'], data['commission_rate'],
            data['commission_payable_ratio'], data['commission_retention_ratio'], data['commission_deduction'],
            data['commission_claimable'], data['commission_payable'], data['commission_retention'],
            data['commission_period'], data['commission_claim_date'], data['commission_claimed'],
            data['commission_unclaimed'], data['commission_booked'],
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
    data = normalize_deal_payload(body, site_id=site_id)
    conn.execute(
        '''
        UPDATE sales_deals SET
          record_type=?, order_no=?, unit_no=?, customer_name=?, phone=?, product_type=?,
          area_ping=?, parking_count=?, parking_nos=?, parking_no1=?, parking_no2=?,
          list_price=?, base_price=?, total_price=?,
          house_sale_price=?, parking_sale_price=?, actual_house_price=?, actual_total_price=?,
          surcharge=?, appliance_gift=?, pickup_voucher=?, decoration=?, company_loan_interest=?,
          house_base_price=?, parking_base_price=?, excess_price=?, units=?,
          deposit_date=?, supplement_date=?, sign_date=?, report_date=?,
          owner_sale_report_date=?, owner_sign_report_date=?,
          salesperson1=?, salesperson2=?, is_co_managed=?,
          commission_base_mode=?, commission_sales_amount=?, commission_rate=?,
          commission_payable_ratio=?, commission_retention_ratio=?, commission_deduction=?,
          commission_claimable=?, commission_payable=?, commission_retention=?,
          commission_period=?, commission_claim_date=?, commission_claimed=?, commission_unclaimed=?,
          commission_booked=?,
          next_month_claimable=?, next_month_units=?, next_month_parking=?,
          customer_id=?, memo=?, extra=?, updated_by=?,
          updated_at=datetime('now', 'localtime')
        WHERE id=? AND site_id=?
        ''',
        (
            data['record_type'], data['order_no'], data['unit_no'], data['customer_name'],
            data['phone'], data['product_type'],
            data['area_ping'], data['parking_count'], data['parking_nos'],
            data['parking_no1'], data['parking_no2'],
            data['list_price'], data['base_price'], data['total_price'],
            data['house_sale_price'], data['parking_sale_price'], data['actual_house_price'],
            data['actual_total_price'], data['surcharge'], data['appliance_gift'],
            data['pickup_voucher'], data['decoration'], data['company_loan_interest'],
            data['house_base_price'], data['parking_base_price'], data['excess_price'], data['units'],
            data['deposit_date'], data['supplement_date'], data['sign_date'], data['report_date'],
            data['owner_sale_report_date'], data['owner_sign_report_date'],
            data['salesperson1'], data['salesperson2'],
            data['is_co_managed'],
            data['commission_base_mode'], data['commission_sales_amount'], data['commission_rate'],
            data['commission_payable_ratio'], data['commission_retention_ratio'], data['commission_deduction'],
            data['commission_claimable'], data['commission_payable'], data['commission_retention'],
            data['commission_period'], data['commission_claim_date'], data['commission_claimed'],
            data['commission_unclaimed'], data['commission_booked'],
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
    payable_amount = 0.0
    retention_amount = 0.0
    claimed_amount = 0.0
    unclaimed_amount = 0.0
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
        report_d = row['owner_sale_report_date'] or row['report_date']
        sign_d = row['sign_date']
        owner_sign_d = row['owner_sign_report_date']
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
            payable = _num(row['commission_payable']) if 'commission_payable' in row.keys() else 0
            retention = _num(row['commission_retention']) if 'commission_retention' in row.keys() else 0
            claimed = _num(row['commission_claimed'])
            unclaimed = (
                _num(row['commission_unclaimed'])
                if 'commission_unclaimed' in row.keys()
                else max(_num(row['commission_claimable']) - claimed, 0)
            )
            if payable <= 0 and _num(row['commission_claimable']) > 0:
                payable = _num(row['commission_claimable']) * 0.97
            if retention <= 0 and _num(row['commission_claimable']) > 0:
                retention = _num(row['commission_claimable']) * 0.03
            payable_amount += payable
            retention_amount += retention
            claimed_amount += claimed
            unclaimed_amount += unclaimed
            booked_amount += _num(row['commission_booked'])
            if _num(row['commission_claimable']) > 0:
                claimable_units += units
                claimable_parking += parking
            if claimed > 0:
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
        elif rt == 'signing' and _in_range(owner_sign_d or sign_d or report_d, start, end):
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
            'payableAmount': round(payable_amount, 4),
            'retentionAmount': round(retention_amount, 4),
            'claimedAmount': round(claimed_amount, 4),
            'unclaimedAmount': round(unclaimed_amount, 4),
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
