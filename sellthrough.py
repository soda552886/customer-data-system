# -*- coding: utf-8 -*-
"""案場去化分析：依銷售總表戶別對應樓層／戶別，供週報單價、總價、狀況圖。"""
from __future__ import annotations

import json
import re
import sqlite3
from collections import defaultdict
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


def _to_halfwidth(s: str) -> str:
    out = []
    for ch in s:
        o = ord(ch)
        if o == 0x3000:
            out.append(' ')
        elif 0xFF01 <= o <= 0xFF5E:
            out.append(chr(o - 0xFEE0))
        else:
            out.append(ch)
    return ''.join(out)


def _clean_unit_text(raw) -> str:
    s = _to_halfwidth(str(raw or '')).strip().upper()
    s = s.replace('　', ' ')
    s = s.replace('樓', 'F').replace('層', 'F')
    s = s.replace('號', '').replace('戶', '')
    s = s.replace('－', '-').replace('–', '-').replace('—', '-')
    s = s.replace('之', '-')
    s = s.replace('（', '(').replace('）', ')')
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

    m = re.match(r'^([A-Z])(\d{1,2})\((\d{1,2})F?\)$', t)
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

    m = re.match(r'^(\d{1,2})F-(\d{1,2})$', t)
    if m:
        return {'buildingId': '主', 'col': str(int(m.group(2))), 'floor': int(m.group(1)), 'raw': token}

    m = re.match(r'^(\d{1,2})F$', t)
    if m:
        return {'buildingId': '主', 'col': '主', 'floor': int(m.group(1)), 'raw': token}

    digits = re.match(r'^(\d{1,2})-(\d{1,2})$', t)
    if digits:
        a, b = int(digits.group(1)), int(digits.group(2))
        if 1 <= a <= 50 and 1 <= b <= 30:
            return {'buildingId': '主', 'col': str(b), 'floor': a, 'raw': token}

    return None


def _apply_default_building(parsed: Optional[dict], default_building: Optional[str]) -> Optional[dict]:
    if not parsed or not default_building:
        return parsed
    bid = str(parsed.get('buildingId') or '')
    if bid not in ('主', ''):
        return parsed
    out = dict(parsed)
    out['buildingId'] = default_building
    col = str(out.get('col') or '')
    if col.isdigit():
        out['col'] = _col_id(default_building, col)
    elif col in ('主', ''):
        return parsed
    return out


def parse_unit_nos(raw, default_building: Optional[str] = None) -> list[dict]:
    text = str(raw or '').strip()
    if not text:
        return []
    parts = [p for p in _SPLIT_UNITS.split(text) if p.strip()]
    if not parts:
        parts = [text]
    out = []
    seen = set()
    for part in parts:
        parsed = _apply_default_building(parse_one_unit(part), default_building)
        if not parsed or parsed.get('floor') in (None, 0):
            continue
        if str(parsed.get('col') or '') in ('主', ''):
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


def _normalize_manual_cell(item) -> Optional[dict]:
    if not isinstance(item, dict):
        return None
    bid = str(item.get('buildingId') or '').strip().upper()
    col = re.sub(r'[^A-Z0-9]', '', _clean_unit_text(item.get('col') or ''))
    try:
        floor = int(item.get('floor'))
    except (TypeError, ValueError):
        floor = 0
    if not bid or not col or not (1 <= floor <= 80):
        return None
    status = str(item.get('status') or STATUS_RESERVED)
    if status not in (STATUS_RESERVED, STATUS_SIGNED, STATUS_OWNER, STATUS_AVAILABLE):
        status = STATUS_RESERVED
    date_s = _to_ymd(item.get('date')) or ''
    unit_price = round(_num(item.get('unitPriceWan')), 2)
    total = round(_num(item.get('totalWan') or item.get('houseWan')), 2)
    house = round(_num(item.get('houseWan') or total), 2)
    ping = _num(item.get('areaPing'))
    if not unit_price and house and ping:
        unit_price = round(house / ping, 2)
    return {
        'key': _cell_key(bid, col, floor),
        'buildingId': bid,
        'col': col,
        'floor': floor,
        'status': status,
        'date': date_s,
        'rocYm': roc_ym(date_s),
        'unitPriceWan': unit_price,
        'totalWan': total,
        'houseWan': house,
        'areaPing': ping,
        'unitNo': str(item.get('unitNo') or f'{col}-{floor}F').strip(),
        'customerName': str(item.get('customerName') or '手動補登').strip() or '手動補登',
        'recordType': 'manual',
        'productType': '',
        'source': 'manual',
        'override': bool(item.get('override')),
    }


def save_unit_map(conn: sqlite3.Connection, site_id: str, payload) -> dict:
    ensure_unit_map_column(conn)
    existing = load_unit_map(conn, site_id)
    payload = payload if isinstance(payload, dict) else {}
    if payload.get('upsertCell') is not None:
        data = existing
        cell = _normalize_manual_cell(payload.get('upsertCell'))
        manuals = [c for c in (data.get('manualCells') or []) if c.get('key') != (cell or {}).get('key')]
        if cell and cell.get('status') != STATUS_AVAILABLE:
            manuals.append(cell)
        data['manualCells'] = manuals
    else:
        data = normalize_unit_map(payload)
        if 'manualCells' not in payload:
            data['manualCells'] = existing.get('manualCells') or []
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
    manuals = []
    seen_m = set()
    for item in data.get('manualCells') or []:
        cell = _normalize_manual_cell(item)
        if not cell or cell['key'] in seen_m:
            continue
        seen_m.add(cell['key'])
        manuals.append(cell)
    return {'buildings': out, 'manualCells': manuals}


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


def _contract_house_wan(deal: dict) -> float:
    """合約房價（房售價），供實登單價＝合約房價／坪數。"""
    house = _num(deal.get('houseSalePrice'))
    if house:
        return house
    contract = _num(deal.get('contractTotal')) or _num(deal.get('totalPrice'))
    parking = _num(deal.get('parkingSalePrice'))
    if contract and parking and contract > parking:
        return contract - parking
    return contract


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
    house = _contract_house_wan(deal)
    area = ping or _num(deal.get('areaPing'))
    if house and area:
        return round(house / area, 2)
    return 0


def _fill_sequential_cols(cols) -> list[str]:
    groups = {}
    leftover = []
    for cid in cols:
        m = re.match(r'^([A-Z]+)(\d+)$', str(cid))
        if not m:
            leftover.append(str(cid))
            continue
        groups.setdefault(m.group(1), []).append(int(m.group(2)))
    out = []
    for letter, nums in sorted(groups.items()):
        lo, hi = min(nums), max(nums)
        if 0 <= hi - lo <= 15:
            out.extend(f'{letter}{n}' for n in range(lo, hi + 1))
        else:
            out.extend(f'{letter}{n}' for n in sorted(set(nums)))
    out.extend(leftover)
    return list(dict.fromkeys(out))


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
            # 未售樓層也要出空格：至少從 2F 畫到已售最高樓
            if lo > 2:
                lo = 2
            if 1 <= lo <= hi <= 80 and (hi - lo) <= 60:
                floors = list(range(hi, lo - 1, -1))
        columns = []
        for cid in _fill_sequential_cols(rec['cols']):
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


def _looks_parking(deal: dict) -> bool:
    blob = f"{deal.get('unitNo') or ''} {deal.get('productType') or ''}"
    if '車位' in blob or blob.strip().endswith('車'):
        if _num(deal.get('areaPing')) <= 0:
            return True
    return False


def _expand_buildings_with_cells(buildings: list[dict], cells: list[dict]) -> tuple[list[dict], bool]:
    if not buildings:
        return buildings, False
    by_id = {b['id']: b for b in buildings}
    changed = False
    for cell in cells:
        if cell.get('status') not in (STATUS_RESERVED, STATUS_SIGNED, STATUS_OWNER):
            continue
        bid = cell['buildingId']
        b = by_id.get(bid)
        if not b:
            name = f'{bid}棟' if re.match(r'^[A-Z]$', str(bid)) else (bid if bid != '主' else '主棟')
            b = {'id': bid, 'name': name, 'columns': [], 'floors': [], 'ownerUnits': []}
            buildings.append(b)
            by_id[bid] = b
            changed = True
        col_ids = {c['id'] for c in (b.get('columns') or [])}
        if cell['col'] not in col_ids:
            b['columns'].append({'id': cell['col'], 'ping': _num(cell.get('areaPing'))})
            b['columns'].sort(key=lambda c: _natural_col_key(c['id']))
            changed = True
        floors = list(b.get('floors') or [])
        if cell['floor'] not in floors:
            floors.append(int(cell['floor']))
            lo, hi = min(floors), max(floors)
            b['floors'] = list(range(hi, lo - 1, -1))
            changed = True
    buildings.sort(key=lambda b: (0 if re.match(r'^[A-Z]$', str(b['id'])) else 1, str(b['id'])))
    return buildings, changed


def _remap_main_building(cells: list[dict], default_building: Optional[str]) -> None:
    if default_building:
        only = default_building
    else:
        letters = {c['buildingId'] for c in cells if re.match(r'^[A-Z]$', str(c.get('buildingId') or ''))}
        if len(letters) != 1:
            return
        only = next(iter(letters))
    for cell in cells:
        if cell.get('buildingId') != '主':
            continue
        cell['buildingId'] = only
        if str(cell.get('col') or '').isdigit():
            cell['col'] = _col_id(only, cell['col'])
        cell['key'] = _cell_key(cell['buildingId'], cell['col'], cell['floor'])


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

    default_building = None
    saved_buildings = saved_map.get('buildings') or []
    if len(saved_buildings) == 1:
        default_building = saved_buildings[0].get('id')

    parsed_cells = []
    missing = []
    ping_by_col = {}
    ledger_keys = set()
    after_as_of_count = 0
    signing_rows = 0
    deal_rows = 0
    for deal in deals:
        rtype = str(deal.get('recordType') or '')
        event_date = _deal_event_date(deal)
        raw_unit = str(deal.get('unitNo') or '').strip()
        if rtype == 'refund':
            continue
        has_ping = _num(deal.get('areaPing')) > 0
        if rtype == 'signing' and has_ping:
            signing_rows += 1
        if rtype == 'deal' and has_ping:
            deal_rows += 1
        if _looks_parking(deal):
            continue
        if as_of_ymd and event_date and event_date > as_of_ymd:
            after_as_of_count += 1
            missing.append({
                'reason': 'afterAsOf',
                'unitNo': raw_unit,
                'customerName': deal.get('customerName') or '',
                'dealId': deal.get('id'),
                'date': event_date,
                'hint': f'成交日 {event_date} 晚於本週日 {as_of_ymd}，未列入此週去化圖',
            })
            continue
        units = parse_unit_nos(raw_unit, default_building)
        if not units:
            one = _apply_default_building(parse_one_unit(raw_unit), default_building)
            if one and one.get('floor') in (None, 0):
                missing.append({
                    'reason': 'noFloor',
                    'unitNo': raw_unit,
                    'customerName': deal.get('customerName') or '',
                    'dealId': deal.get('id'),
                    'date': event_date or '',
                    'hint': '有戶別但缺樓層，請改成 A1-10F，或點格子手動補登',
                })
                ledger_keys.add(f'raw:{raw_unit or deal.get("id")}')
            elif raw_unit:
                missing.append({
                    'reason': 'unparsed',
                    'unitNo': raw_unit,
                    'customerName': deal.get('customerName') or '',
                    'dealId': deal.get('id'),
                    'date': event_date or '',
                    'hint': '戶號無法對應樓層，請到銷售總表改成 A1-10F，或點空格手動補登',
                })
                ledger_keys.add(f'raw:{raw_unit}')
            elif rtype in ('deal', 'unreported', 'signing', 'purchase'):
                missing.append({
                    'reason': 'unparsed',
                    'unitNo': '',
                    'customerName': deal.get('customerName') or '',
                    'dealId': deal.get('id'),
                    'date': event_date or '',
                    'hint': '此筆沒有戶別，請到銷售總表補戶號',
                })
                ledger_keys.add(f'id:{deal.get("id")}')
            continue
        ping = _num(deal.get('areaPing'))
        status = _deal_status(deal)
        date_s = event_date or ''
        for u in units:
            key = _cell_key(u['buildingId'], u['col'], u['floor'])
            ledger_keys.add(key)
            cell_status = STATUS_OWNER if key in owner_keys else status
            if ping:
                ping_by_col.setdefault((u['buildingId'], u['col']), ping)
            parsed_cells.append({
                'key': key,
                'buildingId': u['buildingId'],
                'col': u['col'],
                'floor': u['floor'],
                'status': cell_status,
                'date': date_s,
                'rocYm': roc_ym(date_s),
                'unitPriceWan': _unit_price_wan(deal, ping),
                'totalWan': round(_total_wan(deal), 2),
                'houseWan': round(_house_total_wan(deal), 2),
                'contractHouseWan': round(_contract_house_wan(deal), 2),
                'areaPing': ping,
                'unitNo': deal.get('unitNo') or '',
                'customerName': deal.get('customerName') or '',
                'recordType': deal.get('recordType') or '',
                'productType': deal.get('productType') or '',
                'source': 'sales',
                'dealId': deal.get('id'),
            })

    _remap_main_building(parsed_cells, default_building)

    merged = {}
    for cell in parsed_cells:
        merged[cell['key']] = _pick_better_cell(merged.get(cell['key']), cell)

    by_key_recs = defaultdict(list)
    for cell in parsed_cells:
        did = cell.get('dealId')
        if did and any(x.get('dealId') == did for x in by_key_recs[cell['key']]):
            continue
        by_key_recs[cell['key']].append(cell)
    duplicates = []
    for key, recs in by_key_recs.items():
        if len(recs) < 2:
            continue
        duplicates.append({
            'key': key,
            'unitNo': recs[0].get('unitNo') or f"{recs[0].get('col')}-{recs[0].get('floor')}F",
            'col': recs[0].get('col'),
            'floor': recs[0].get('floor'),
            'count': len(recs),
            'names': '、'.join(dict.fromkeys(r.get('customerName') or '' for r in recs if r.get('customerName'))),
            'types': '、'.join(dict.fromkeys(r.get('recordTypeLabel') or r.get('recordType') or '' for r in recs)),
            'hint': f'同一戶 {len(recs)} 筆，去化圖只算 1 格，不必手動補登',
        })

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
                'source': 'owner',
            }

    for mc in saved_map.get('manualCells') or []:
        if mc.get('status') == STATUS_AVAILABLE:
            continue
        current = merged.get(mc['key'])
        if not current or current.get('status') == STATUS_AVAILABLE or mc.get('override'):
            merged[mc['key']] = dict(mc)
            ledger_keys.add(mc['key'])

    buildings = saved_map.get('buildings') or []
    inferred = False
    expanded = False
    if not buildings:
        buildings = infer_buildings_from_cells(list(merged.values()), ping_by_col)
        inferred = True
    else:
        for b in buildings:
            for col in b.get('columns') or []:
                if not col.get('ping'):
                    col['ping'] = ping_by_col.get((b['id'], col['id']), 0) or 0
        buildings, expanded = _expand_buildings_with_cells(buildings, list(merged.values()))

    ping_lookup = {}
    for b in buildings:
        for col in b.get('columns') or []:
            if col.get('ping'):
                ping_lookup[(b['id'], col['id'])] = _num(col.get('ping'))
    for cell in merged.values():
        ping = _num(cell.get('areaPing')) or ping_lookup.get((cell['buildingId'], cell['col']), 0)
        if ping and not cell.get('areaPing'):
            cell['areaPing'] = ping
        contract_house = _num(cell.get('contractHouseWan'))
        if ping and not cell.get('unitPriceWan') and contract_house:
            cell['unitPriceWan'] = round(contract_house / ping, 2)

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
    stats['ledgerUnits'] = len(ledger_keys)
    stats['afterAsOf'] = after_as_of_count
    stats['expanded'] = expanded
    stats['signingRows'] = signing_rows
    stats['dealRows'] = deal_rows
    stats['duplicateUnits'] = len(duplicates)

    layout_keys = set()
    for b in buildings:
        for col in b.get('columns') or []:
            for floor in b.get('floors') or []:
                layout_keys.add(_cell_key(b['id'], col['id'], floor))
    for cell in merged.values():
        if cell.get('status') not in (STATUS_RESERVED, STATUS_SIGNED, STATUS_OWNER):
            continue
        if cell.get('key') not in layout_keys:
            missing.append({
                'reason': 'outOfLayout',
                'unitNo': cell.get('unitNo') or f"{cell.get('col')}-{cell.get('floor')}F",
                'customerName': cell.get('customerName') or '',
                'dealId': cell.get('dealId'),
                'date': cell.get('date') or '',
                'hint': '此戶不在目前格局範圍，已嘗試自動補欄；若仍不見請展開格局加入該戶別／樓層',
            })

    unparsed = [m['unitNo'] for m in missing if m.get('reason') == 'unparsed' and m.get('unitNo')]
    return {
        'siteId': site_id,
        'asOf': as_of_ymd or '',
        'inferred': inferred,
        'expanded': expanded,
        'buildings': buildings,
        'cells': merged,
        'stats': stats,
        'unparsed': list(dict.fromkeys(unparsed))[:40],
        'missing': missing,
        'duplicates': duplicates[:40],
        'unitMap': saved_map,
    }
