# -*- coding: utf-8 -*-
"""案場去化分析：依銷售總表戶別對應樓層／戶別，供週報單價、總價、狀況圖。"""
from __future__ import annotations

import json
import re
import sqlite3
from typing import Optional

from sales_ledger import _num, _parse_date, _truthy, row_to_deal


STATUS_RESERVED = 'reserved'  # 訂足
STATUS_SIGNED = 'signed'      # 簽約
STATUS_OWNER = 'owner'        # 業主戶
STATUS_AVAILABLE = 'available'

STATUS_RANK = {
    STATUS_AVAILABLE: 0,
    STATUS_RESERVED: 1,
    STATUS_SIGNED: 2,
    STATUS_OWNER: 3,
}

_SPLIT_UNITS = re.compile(r'[、,，;；/／\n]+')
_SPACE = re.compile(r'\s+')


def ensure_unit_map_column(conn: sqlite3.Connection):
    names = [row[1] for row in conn.execute('PRAGMA table_info(sites)').fetchall()]
    if 'unit_map' not in names:
        conn.execute('ALTER TABLE sites ADD COLUMN unit_map TEXT')


def _clean_unit_text(raw) -> str:
    s = str(raw or '').strip().upper()
    s = s.replace('　', ' ')
    s = s.replace('樓', 'F').replace('層', 'F')
    s = s.replace('號', '').replace('戶', '')
    s = s.replace('－', '-').replace('–', '-').replace('—', '-')
    s = s.replace('之', '-')
    s = _SPACE.sub('', s)
    return s


def _col_id(letter: str, num) -> str:
    try:
        n = int(num)
    except (TypeError, ValueError):
        n = num
    return f'{str(letter).upper()}{n}'


def _building_id_from_col(col: str) -> str:
    m = re.match(r'^([A-Z])', str(col or ''))
    return m.group(1) if m else '主'


def parse_one_unit(token: str) -> Optional[dict]:
    """解析單一戶號，例如 A1-10F、10F-A1、A棟10F-1、8A1。"""
    t = _clean_unit_text(token)
    if not t or t in ('合計', '-', '—', '無'):
        return None

    m = re.match(r'^([A-Z])棟(\d{1,2})F?-(\d{1,2})$', t)
    if m:
        floor = int(m.group(2))
        col = _col_id(m.group(1), m.group(3))
        return {'buildingId': m.group(1), 'col': col, 'floor': floor, 'raw': token}

    m = re.match(r'^(\d{1,2})F-?([A-Z])(\d{1,2})$', t)
    if m:
        col = _col_id(m.group(2), m.group(3))
        return {'buildingId': m.group(2), 'col': col, 'floor': int(m.group(1)), 'raw': token}

    m = re.match(r'^([A-Z])-?(\d{1,2})[-/](\d{1,2})F$', t)
    if m:
        col = _col_id(m.group(1), m.group(2))
        return {'buildingId': m.group(1), 'col': col, 'floor': int(m.group(3)), 'raw': token}

    m = re.match(r'^([A-Z])(\d{2,5})F$', t)
    if m:
        letter, digits = m.group(1), m.group(2)
        split = None
        if len(digits) >= 3:
            floor2 = int(digits[-2:])
            col_n = digits[:-2]
            if col_n and 10 <= floor2 <= 50:
                split = (col_n, floor2)
        if split is None and len(digits) >= 2:
            floor1 = int(digits[-1:])
            col_n = digits[:-1]
            if col_n and 1 <= floor1 <= 9:
                split = (col_n, floor1)
        if split:
            col = _col_id(letter, split[0])
            return {'buildingId': letter, 'col': col, 'floor': split[1], 'raw': token}

    m = re.match(r'^([A-Z])-?(\d{1,2})[-/](\d{1,2})$', t)
    if m:
        floor = int(m.group(3))
        if 1 <= floor <= 50:
            col = _col_id(m.group(1), m.group(2))
            return {'buildingId': m.group(1), 'col': col, 'floor': floor, 'raw': token}

    m = re.match(r'^(\d{1,2})([A-Z])(\d{1,2})$', t)
    if m:
        floor = int(m.group(1))
        if 1 <= floor <= 50:
            col = _col_id(m.group(2), m.group(3))
            return {'buildingId': m.group(2), 'col': col, 'floor': floor, 'raw': token}

    m = re.match(r'^([A-Z])(\d{1,2})$', t)
    if m:
        col = _col_id(m.group(1), m.group(2))
        return {'buildingId': m.group(1), 'col': col, 'floor': None, 'raw': token}

    m = re.match(r'^(\d{1,2})F$', t)
    if m:
        return {'buildingId': '主', 'col': '主', 'floor': int(m.group(1)), 'raw': token}

    digits = re.match(r'^(\d{1,2})-(\d{1,2})$', t)
    if digits:
        a, b = int(digits.group(1)), int(digits.group(2))
        if 1 <= a <= 50 and 1 <= b <= 30:
            return {'buildingId': '主', 'col': str(b), 'floor': a, 'raw': token}

    return None


def parse_unit_nos(raw) -> list[dict]:
    text = str(raw or '').strip()
    if not text:
        return []
    parts = [p for p in _SPLIT_UNITS.split(text) if p.strip()]
    if not parts:
        parts = [text]
    out = []
    seen = set()
    for part in parts:
        parsed = parse_one_unit(part)
        if not parsed or parsed.get('floor') in (None, 0):
            continue
        key = (parsed['buildingId'], parsed['col'], parsed['floor'])
        if key in seen:
            continue
        seen.add(key)
        out.append(parsed)
    return out


def _natural_col_key(col: str):
    m = re.match(r'^([A-Z]*)(\d+)$', str(col))
    if m:
        return (m.group(1), int(m.group(2)))
    return (str(col), 0)


def _to_ymd(value) -> Optional[str]:
    return _parse_date(value)


def roc_ym(iso_date: Optional[str]) -> str:
    if not iso_date or len(str(iso_date)) < 7:
        return ''
    try:
        y = int(str(iso_date)[0:4])
        m = int(str(iso_date)[5:7])
    except ValueError:
        return ''
    roc = y - 1911 if y >= 1912 else y
    return f'{roc}/{m:02d}'


def load_unit_map(conn: sqlite3.Connection, site_id: str) -> dict:
    ensure_unit_map_column(conn)
    row = conn.execute('SELECT unit_map FROM sites WHERE id = ?', (site_id,)).fetchone()
    raw = None
    if row:
        try:
            raw = row['unit_map']
        except (KeyError, IndexError, TypeError):
            raw = None
    return normalize_unit_map(raw)


def save_unit_map(conn: sqlite3.Connection, site_id: str, payload) -> dict:
    ensure_unit_map_column(conn)
    data = normalize_unit_map(payload)
    conn.execute(
        'UPDATE sites SET unit_map = ? WHERE id = ?',
        (json.dumps(data, ensure_ascii=False), site_id),
    )
    return data


def normalize_unit_map(raw) -> dict:
    data = raw
    if isinstance(raw, str):
        try:
            data = json.loads(raw or '{}')
        except (TypeError, json.JSONDecodeError):
            data = {}
    if not isinstance(data, dict):
        data = {}
    buildings = data.get('buildings') or []
    out = []
    for item in buildings:
        if not isinstance(item, dict):
            continue
        bid = str(item.get('id') or item.get('buildingId') or '').strip().upper()
        name = str(item.get('name') or '').strip()
        columns = _normalize_columns(item.get('columns'))
        if not bid and columns:
            bid = _building_id_from_col(columns[0]['id'])
        if not bid:
            continue
        if not name:
            name = f'{bid}棟' if re.match(r'^[A-Z]$', bid) else bid
        floors = _normalize_floors(item)
        owners = _normalize_owner_keys(item.get('ownerUnits') or item.get('owners'), bid)
        if not columns or not floors:
            continue
        out.append({
            'id': bid,
            'name': name,
            'columns': columns,
            'floors': floors,
            'ownerUnits': owners,
        })
    return {'buildings': out}


def _normalize_columns(raw) -> list[dict]:
    out = []
    seen = set()
    if isinstance(raw, str):
        items = []
        for part in re.split(r'[、,，;；\s]+', raw):
            part = part.strip()
            if not part:
                continue
            if ':' in part or '：' in part:
                k, v = re.split(r'[:：]', part, 1)
                items.append({'id': k, 'ping': v})
            else:
                items.append({'id': part})
        raw = items
    if not isinstance(raw, (list, tuple)):
        return []
    for item in raw:
        if isinstance(item, str):
            cid = _clean_unit_text(item)
            ping = 0
        elif isinstance(item, dict):
            cid = _clean_unit_text(item.get('id') or item.get('col') or '')
            ping = _num(item.get('ping') or item.get('areaPing'))
        else:
            continue
        cid = re.sub(r'[^A-Z0-9]', '', cid)
        if not cid or cid in seen:
            continue
        seen.add(cid)
        out.append({'id': cid, 'ping': ping or 0})
    out.sort(key=lambda c: _natural_col_key(c['id']))
    return out


def _normalize_floors(item: dict) -> list[int]:
    floors = item.get('floors')
    skip = set()
    for x in item.get('skipFloors') or []:
        try:
            skip.add(int(x))
        except (TypeError, ValueError):
            pass
    if isinstance(floors, str):
        nums = []
        for part in re.split(r'[、,，;；\s]+', floors):
            part = part.strip().upper().replace('F', '')
            if part.isdigit():
                nums.append(int(part))
        floors = nums
    if isinstance(floors, (list, tuple)) and floors:
        out = []
        for x in floors:
            try:
                n = int(x)
            except (TypeError, ValueError):
                continue
            if 1 <= n <= 80 and n not in skip and n not in out:
                out.append(n)
        out.sort(reverse=True)
        return out
    floor_max = item.get('floorMax', item.get('maxFloor'))
    floor_min = item.get('floorMin', item.get('minFloor'))
    try:
        hi = int(floor_max) if floor_max not in (None, '') else 0
        lo = int(floor_min) if floor_min not in (None, '') else 0
    except (TypeError, ValueError):
        hi, lo = 0, 0
    if hi and lo and 1 <= lo <= hi <= 80:
        return [n for n in range(hi, lo - 1, -1) if n not in skip]
    return []


def _normalize_owner_keys(raw, building_id: str) -> list[str]:
    if isinstance(raw, str):
        raw = [p.strip() for p in re.split(r'[、,，;；\n]+', raw) if p.strip()]
    if not isinstance(raw, (list, tuple)):
        return []
    keys = []
    for item in raw:
        parsed_list = parse_unit_nos(item) if not isinstance(item, dict) else []
        if isinstance(item, dict):
            col = str(item.get('col') or item.get('id') or '').strip().upper()
            try:
                floor = int(item.get('floor'))
            except (TypeError, ValueError):
                floor = 0
            if col and floor:
                parsed_list = [{'buildingId': item.get('buildingId') or building_id, 'col': col, 'floor': floor}]
        for p in parsed_list:
            keys.append(_cell_key(p['buildingId'], p['col'], p['floor']))
    return list(dict.fromkeys(keys))


def _cell_key(building_id, col, floor) -> str:
    return f'{building_id}|{col}|{floor}'


def _deal_event_date(deal: dict) -> Optional[str]:
    for key in (
        'signDate', 'depositDate', 'ownerSaleReportDate', 'reportDate',
        'ownerSignReportDate', 'supplementDate',
    ):
        ymd = _to_ymd(deal.get(key))
        if ymd:
            return ymd
    return None


def _is_owner_deal(deal: dict) -> bool:
    extra = deal.get('extra') if isinstance(deal.get('extra'), dict) else {}
    if _truthy(extra.get('ownerUnit')) or _truthy(extra.get('isOwner')):
        return True
    blob = f"{deal.get('customerName') or ''} {deal.get('productType') or ''} {deal.get('memo') or ''}"
    return '業主' in blob


def _deal_status(deal: dict) -> str:
    rtype = str(deal.get('recordType') or '')
    if rtype == 'refund':
        return STATUS_AVAILABLE
    if _is_owner_deal(deal):
        return STATUS_OWNER
    if rtype == 'signing' or deal.get('signDate') or deal.get('ownerSignReportDate'):
        return STATUS_SIGNED
    if rtype in ('deal', 'unreported', 'purchase'):
        return STATUS_RESERVED
    return STATUS_RESERVED


def _house_total_wan(deal: dict) -> float:
    house = _num(deal.get('actualHousePrice')) or _num(deal.get('houseSalePrice'))
    if house:
        return house
    total = _num(deal.get('actualTotalPrice')) or _num(deal.get('contractTotal')) or _num(deal.get('totalPrice'))
    parking = _num(deal.get('parkingSalePrice'))
    if total and parking and total > parking:
        return total - parking
    return total


def _total_wan(deal: dict) -> float:
    total = _num(deal.get('actualTotalPrice'))
    if total:
        return total
    house = _num(deal.get('actualHousePrice')) or _num(deal.get('houseSalePrice'))
    parking = _num(deal.get('parkingSalePrice'))
    if house or parking:
        return house + parking
    return _num(deal.get('contractTotal')) or _num(deal.get('totalPrice'))


def _unit_price_wan(deal: dict, ping: float) -> float:
    house = _house_total_wan(deal)
    area = ping or _num(deal.get('areaPing'))
    if house and area:
        return round(house / area, 2)
    return 0


def infer_buildings_from_cells(cells: list[dict], ping_by_col: dict) -> list[dict]:
    by_b = {}
    for cell in cells:
        bid = cell['buildingId']
        rec = by_b.setdefault(bid, {'cols': set(), 'floors': set()})
        rec['cols'].add(cell['col'])
        rec['floors'].add(cell['floor'])
    buildings = []
    for bid, rec in by_b.items():
        floors = sorted(rec['floors'], reverse=True)
        if floors:
            lo, hi = min(floors), max(floors)
            if 1 <= lo <= hi <= 80 and (hi - lo) <= 60:
                floors = list(range(hi, lo - 1, -1))
        columns = []
        for cid in sorted(rec['cols'], key=_natural_col_key):
            columns.append({'id': cid, 'ping': ping_by_col.get((bid, cid), 0)})
        name = f'{bid}棟' if re.match(r'^[A-Z]$', bid) else (bid if bid != '主' else '主棟')
        buildings.append({
            'id': bid,
            'name': name,
            'columns': columns,
            'floors': floors,
            'ownerUnits': [],
        })
    buildings.sort(key=lambda b: (0 if re.match(r'^[A-Z]$', b['id']) else 1, b['id']))
    return buildings


def _pick_better_cell(current: Optional[dict], incoming: dict) -> dict:
    if not current:
        return incoming
    cr = STATUS_RANK.get(current.get('status'), 0)
    ir = STATUS_RANK.get(incoming.get('status'), 0)
    if ir > cr:
        return incoming
    if ir < cr:
        return current
    return incoming if (incoming.get('date') or '') >= (current.get('date') or '') else current


def build_sellthrough(conn: sqlite3.Connection, site_id: str, as_of: Optional[str] = None) -> dict:
    as_of_ymd = _to_ymd(as_of)
    rows = conn.execute(
        'SELECT * FROM sales_deals WHERE site_id = ? ORDER BY id ASC',
        (site_id,),
    ).fetchall()
    deals = [row_to_deal(r) for r in rows]
    saved_map = load_unit_map(conn, site_id)
    owner_keys = set()
    for b in saved_map.get('buildings') or []:
        owner_keys.update(b.get('ownerUnits') or [])

    parsed_cells = []
    unparsed = []
    ping_by_col = {}
    for deal in deals:
        event_date = _deal_event_date(deal)
        if as_of_ymd and event_date and event_date > as_of_ymd:
            continue
        units = parse_unit_nos(deal.get('unitNo'))
        if not units:
            raw = str(deal.get('unitNo') or '').strip()
            if raw:
                unparsed.append(raw)
            continue
        ping = _num(deal.get('areaPing'))
        status = _deal_status(deal)
        date_s = event_date or ''
        for u in units:
            key = _cell_key(u['buildingId'], u['col'], u['floor'])
            if key in owner_keys:
                status = STATUS_OWNER
            if ping:
                ping_by_col.setdefault((u['buildingId'], u['col']), ping)
            parsed_cells.append({
                'key': key,
                'buildingId': u['buildingId'],
                'col': u['col'],
                'floor': u['floor'],
                'status': status,
                'date': date_s,
                'rocYm': roc_ym(date_s),
                'unitPriceWan': _unit_price_wan(deal, ping),
                'totalWan': round(_total_wan(deal), 2),
                'houseWan': round(_house_total_wan(deal), 2),
                'areaPing': ping,
                'unitNo': deal.get('unitNo') or '',
                'customerName': deal.get('customerName') or '',
                'recordType': deal.get('recordType') or '',
                'productType': deal.get('productType') or '',
            })

    merged = {}
    for cell in parsed_cells:
        merged[cell['key']] = _pick_better_cell(merged.get(cell['key']), cell)

    for key in owner_keys:
        if key not in merged:
            parts = key.split('|')
            if len(parts) != 3:
                continue
            bid, col, floor_s = parts
            try:
                floor = int(floor_s)
            except ValueError:
                continue
            merged[key] = {
                'key': key,
                'buildingId': bid,
                'col': col,
                'floor': floor,
                'status': STATUS_OWNER,
                'date': '',
                'rocYm': '',
                'unitPriceWan': 0,
                'totalWan': 0,
                'houseWan': 0,
                'areaPing': 0,
                'unitNo': f'{col}-{floor}F',
                'customerName': '業主戶',
                'recordType': '',
                'productType': '',
            }

    buildings = saved_map.get('buildings') or []
    inferred = False
    if not buildings:
        buildings = infer_buildings_from_cells(list(merged.values()), ping_by_col)
        inferred = True
    else:
        for b in buildings:
            for col in b.get('columns') or []:
                if not col.get('ping'):
                    col['ping'] = ping_by_col.get((b['id'], col['id']), 0) or 0

    ping_lookup = {}
    for b in buildings:
        for col in b.get('columns') or []:
            if col.get('ping'):
                ping_lookup[(b['id'], col['id'])] = _num(col.get('ping'))
    for cell in merged.values():
        ping = _num(cell.get('areaPing')) or ping_lookup.get((cell['buildingId'], cell['col']), 0)
        if ping and not cell.get('areaPing'):
            cell['areaPing'] = ping
        if ping and not cell.get('unitPriceWan') and cell.get('houseWan'):
            cell['unitPriceWan'] = round(_num(cell.get('houseWan')) / ping, 2)

    stats = {
        'total': 0,
        'sold': 0,
        'reserved': 0,
        'signed': 0,
        'owner': 0,
        'available': 0,
    }
    for b in buildings:
        for col in b.get('columns') or []:
            for floor in b.get('floors') or []:
                stats['total'] += 1
                cell = merged.get(_cell_key(b['id'], col['id'], floor))
                st = (cell or {}).get('status') or STATUS_AVAILABLE
                if st == STATUS_RESERVED:
                    stats['reserved'] += 1
                    stats['sold'] += 1
                elif st == STATUS_SIGNED:
                    stats['signed'] += 1
                    stats['sold'] += 1
                elif st == STATUS_OWNER:
                    stats['owner'] += 1
                else:
                    stats['available'] += 1
    denom = max(stats['total'] - stats['owner'], 0)
    stats['rate'] = round(stats['sold'] / denom * 100, 2) if denom else 0

    unique_unparsed = list(dict.fromkeys(unparsed))[:40]
    return {
        'siteId': site_id,
        'asOf': as_of_ymd or '',
        'inferred': inferred,
        'buildings': buildings,
        'cells': merged,
        'stats': stats,
        'unparsed': unique_unparsed,
        'unitMap': saved_map,
    }
