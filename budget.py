# -*- coding: utf-8 -*-
"""廣告預算執行花費：業主版預算、執行總覽、週花費與媒體執行。"""
from __future__ import annotations

import json
import sqlite3
from typing import Optional

from weekly_reports import default_week_number, roc_year, week_bounds


WAN_TO_YUAN = 10000.0


def _num(val, default=0.0) -> float:
    try:
        if val in (None, ''):
            return float(default)
        return float(val)
    except (TypeError, ValueError):
        return float(default)


def _text(val, default='') -> str:
    s = str(val if val is not None else default).strip()
    return s or default


MEDIA_PRESETS = [
    'POP', 'GOOGLE Video', 'GOOGLE Display', 'GOOGLE 關鍵字',
    'FB 貼文／粉絲團', 'LINE', 'Youtube', 'AI 串客', '591',
    '廣播 RD', 'CF', '雜誌', 'EDM／電子報', '戶外看板', '廁廣',
    '電視新聞', '公車／車體', '介紹費', '講座', '社區看板', '定點派報',
]


def default_owner_categories() -> list[dict]:
    return [
        {'key': 'onsite', 'label': '現場部分', 'kind': 'manual', 'inPie': False},
        {'key': 'tools', 'label': '銷售工具部分', 'kind': 'manual', 'inPie': False},
        {'key': 'signboard', 'label': '招牌部分', 'kind': 'manual', 'inPie': False},
        {'key': 'planning', 'label': '企劃媒體部分', 'kind': 'manual', 'inPie': False},
        {'key': 'other', 'label': '其他部分', 'kind': 'manual', 'inPie': False},
        {'key': 'fee', 'label': '預算 2.375%', 'kind': 'rate', 'ratePct': 2.375, 'inPie': False},
    ]


def default_exec_categories(*, include_referral=False) -> list[dict]:
    cats = [
        {'key': 'onsite', 'label': '現場部分', 'kind': 'manual', 'inPie': True},
        {'key': 'tools', 'label': '銷售工具部分', 'kind': 'manual', 'inPie': True},
        {'key': 'signboard', 'label': '招牌部分', 'kind': 'manual', 'inPie': True},
        {'key': 'planning', 'label': '企劃媒體部分', 'kind': 'manual', 'inPie': True},
        {'key': 'other', 'label': '其他部分', 'kind': 'manual', 'inPie': True},
        {'key': 'salesFee', 'label': '媒體 2.375%', 'kind': 'rate', 'ratePct': 2.375, 'inPie': False},
        {'key': 'reward', 'label': '人事預算 1%', 'kind': 'rate', 'ratePct': 1.0, 'inPie': True},
        {'key': 'total', 'label': '總預算 3.375%', 'kind': 'rate_sum', 'ratePct': 3.375, 'inPie': False},
    ]
    if include_referral:
        cats.append({'key': 'referral', 'label': '介紹費', 'kind': 'manual', 'inPie': False})
    return cats


def default_week_extra_fields() -> list[dict]:
    return [
        {'key': 'hr', 'label': '人事'},
        {'key': 'rent', 'label': '地租'},
        {'key': 'utilities', 'label': '水電'},
        {'key': 'misc', 'label': '雜支'},
        {'key': 'phone', 'label': '電話費'},
        {'key': 'car', 'label': '租賃車租金'},
        {'key': 'parking', 'label': '停車格租金'},
        {'key': 'gold', 'label': '抽黃金活動'},
    ]


def default_media_items() -> list[dict]:
    return []


def site_wants_referral(site_name: str, saved: Optional[dict]) -> bool:
    """是否顯示介紹費欄：有存檔設定則依存檔，否則世界都心預設開啟。"""
    data = saved if isinstance(saved, dict) else {}
    if 'showReferralFee' in data:
        return bool(data.get('showReferralFee'))
    return '世界都心' in _text(site_name)


def site_wants_owner_budget(site_name: str, saved: Optional[dict]) -> bool:
    data = saved if isinstance(saved, dict) else {}
    if 'showOwnerBudget' in data:
        return bool(data.get('showOwnerBudget'))
    return '世界都心' in _text(site_name)


def default_project_payload(*, include_referral=False) -> dict:
    def empty_amounts(categories):
        return {
            c['key']: {'budgetWan': 0, 'sent': 0, 'invoiced': 0, 'contracted': 0}
            for c in categories
        }

    exec_cats = default_exec_categories(include_referral=include_referral)
    return {
        'salesBaseWan': 0,
        'ownerBudgetPct': 2.375,
        'salesFeePct': 2.375,
        'rewardPct': 1.0,
        'showReferralFee': include_referral,
        'showOwnerBudget': include_referral,
        'ownerCategories': default_owner_categories(),
        'execCategories': exec_cats,
        'weekExtraFields': default_week_extra_fields(),
        'owner': empty_amounts(default_owner_categories()),
        'exec': empty_amounts(exec_cats),
        'mediaCatalog': default_media_items(),
    }


def default_week_payload() -> dict:
    extras = {f['key']: 0 for f in default_week_extra_fields()}
    extra_items = [
        {'key': f['key'], 'label': f['label'], 'amount': 0}
        for f in default_week_extra_fields()
    ]
    return {
        'extras': extras,
        'extraItems': extra_items,
        'mediaItems': [],
    }


def _normalize_photos(src) -> list[dict]:
    raw = src.get('photos') if isinstance(src, dict) else src
    if not isinstance(raw, list):
        return []
    out = []
    seen = set()
    for item in raw:
        if not isinstance(item, dict):
            continue
        pid = _text(item.get('id'))
        rel = _text(item.get('path') or item.get('filename'))
        if not pid or not rel or pid in seen:
            continue
        seen.add(pid)
        kind = _text(item.get('kind'), 'media')
        if kind not in ('media', 'map'):
            kind = 'media'
        out.append({
            'id': pid,
            'filename': _text(item.get('filename'), rel),
            'path': rel,
            'url': f'/uploads/budget/{rel}',
            'caption': _text(item.get('caption')),
            'kind': kind,
        })
    return out


def _dump_project(project: dict) -> dict:
    return {
        'salesBaseWan': project['salesBaseWan'],
        'ownerBudgetPct': project['ownerBudgetPct'],
        'salesFeePct': project['salesFeePct'],
        'rewardPct': project['rewardPct'],
        'showReferralFee': bool(project.get('showReferralFee')),
        'showOwnerBudget': bool(project.get('showOwnerBudget')),
        'ownerCategories': project['ownerCategories'],
        'execCategories': project['execCategories'],
        'weekExtraFields': project['weekExtraFields'],
        'owner': project['owner'],
        'exec': project['exec'],
        'mediaCatalog': [
            {
                'name': c.get('name'),
                'status': c.get('status') or '',
                'openingCumulative': _num(c.get('openingCumulative')),
                'photos': _normalize_photos(c),
            }
            for c in project.get('mediaCatalog') or []
        ],
    }


def init_budget_tables(conn: sqlite3.Connection):
    conn.executescript('''
        CREATE TABLE IF NOT EXISTS budget_projects (
            site_id TEXT PRIMARY KEY,
            data TEXT NOT NULL DEFAULT '{}',
            updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        );
        CREATE TABLE IF NOT EXISTS budget_weeks (
            site_id TEXT NOT NULL,
            week_start TEXT NOT NULL,
            data TEXT NOT NULL DEFAULT '{}',
            updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
            PRIMARY KEY (site_id, week_start)
        );
        CREATE INDEX IF NOT EXISTS idx_budget_weeks_site ON budget_weeks(site_id);
    ''')


def _parse_json(raw, fallback):
    if isinstance(raw, dict):
        return raw
    try:
        data = json.loads(raw or '{}')
        return data if isinstance(data, dict) else fallback
    except (TypeError, json.JSONDecodeError):
        return fallback


def _merge_categories(defaults, saved) -> list[dict]:
    if not isinstance(saved, list) or not saved:
        return [dict(x) for x in defaults]
    out = []
    seen = set()
    for item in saved:
        if not isinstance(item, dict):
            continue
        key = _text(item.get('key'))
        if not key or key in seen:
            continue
        seen.add(key)
        base = next((dict(d) for d in defaults if d['key'] == key), {
            'key': key, 'label': key, 'kind': 'manual', 'inPie': False,
        })
        merged = {**base, **item, 'key': key}
        merged['label'] = _text(item.get('label'), base.get('label') or key)
        kind = _text(item.get('kind'), base.get('kind') or 'manual')
        if kind not in ('manual', 'rate', 'rate_sum'):
            kind = 'manual'
        merged['kind'] = kind
        if kind in ('rate', 'rate_sum'):
            merged['ratePct'] = _num(item.get('ratePct'), base.get('ratePct') or 0)
        merged['inPie'] = bool(item.get('inPie', base.get('inPie')))
        out.append(merged)
    return out or [dict(x) for x in defaults]


def _migrate_exec_keys(categories: list[dict], amounts) -> tuple[list[dict], dict]:
    """舊版「媒體部分」改為 PPT 的「招牌部分」。"""
    data = dict(amounts) if isinstance(amounts, dict) else {}
    keys = [c.get('key') for c in categories]
    if 'signboard' not in keys:
        for cat in categories:
            if cat.get('key') == 'media':
                cat['key'] = 'signboard'
                if _text(cat.get('label')) in ('媒體部分', '媒體', 'media'):
                    cat['label'] = '招牌部分'
                cat['inPie'] = True
                break
        if 'media' in data and 'signboard' not in data:
            data['signboard'] = data.pop('media')
        elif 'media' in data:
            data.pop('media', None)
    else:
        categories = [c for c in categories if c.get('key') != 'media']
        if 'media' in data and 'signboard' in data:
            data.pop('media', None)
    # 舊「介案費」標籤改為介紹費
    for cat in categories:
        if cat.get('key') == 'referral' and _text(cat.get('label')) in ('介案費',):
            cat['label'] = '介紹費'
    return categories, data


def _apply_referral_column(categories: list[dict], amounts: dict, show: bool) -> tuple[list[dict], dict]:
    cats = [c for c in categories if c.get('key') != 'referral']
    data = dict(amounts) if isinstance(amounts, dict) else {}
    if show:
        referral = next(
            (c for c in categories if c.get('key') == 'referral'),
            {'key': 'referral', 'label': '介紹費', 'kind': 'manual', 'inPie': False},
        )
        referral['label'] = _text(referral.get('label'), '介紹費') or '介紹費'
        cats.append(referral)
        data.setdefault('referral', {'budgetWan': 0, 'sent': 0, 'invoiced': 0, 'contracted': 0})
    return cats, data


def _merge_amounts(categories, saved) -> dict:
    data = saved if isinstance(saved, dict) else {}
    out = {}
    for cat in categories:
        src = data.get(cat['key']) if isinstance(data.get(cat['key']), dict) else {}
        contracted = _num(src.get('contracted'))
        if not contracted:
            contracted = _num(src.get('sent'))
        out[cat['key']] = {
            'budgetWan': _num(src.get('budgetWan')),
            'sent': _num(src.get('sent')),
            'invoiced': _num(src.get('invoiced')),
            'contracted': contracted,
        }
    return out


def _load_project_raw(conn, site_id) -> dict:
    row = conn.execute('SELECT data FROM budget_projects WHERE site_id=?', (site_id,)).fetchone()
    return _parse_json(row['data'] if row else None, {})


def normalize_project(saved: Optional[dict], site_name='') -> dict:
    data = saved if isinstance(saved, dict) else {}
    # 直接內聯判斷，避免再出現 NameError（舊版曾只呼叫未定義的 site_wants_referral）
    if 'showReferralFee' in data:
        show_referral = bool(data.get('showReferralFee'))
    else:
        show_referral = '世界都心' in _text(site_name)
    if 'showOwnerBudget' in data:
        show_owner = bool(data.get('showOwnerBudget'))
    else:
        show_owner = '世界都心' in _text(site_name)
    base = default_project_payload(include_referral=show_referral)
    saved_exec_cats = data.get('execCategories')
    saved_exec_amt = data.get('exec')
    if isinstance(saved_exec_cats, list):
        saved_exec_cats, saved_exec_amt = _migrate_exec_keys(
            [dict(x) for x in saved_exec_cats if isinstance(x, dict)],
            saved_exec_amt,
        )
    owner_cats = _merge_categories(base['ownerCategories'], data.get('ownerCategories'))
    exec_cats = _merge_categories(base['execCategories'], saved_exec_cats)
    exec_cats, saved_exec_amt = _apply_referral_column(exec_cats, saved_exec_amt, show_referral)
    extra_fields = data.get('weekExtraFields')
    if not isinstance(extra_fields, list) or not extra_fields:
        extra_fields = base['weekExtraFields']
    else:
        cleaned = []
        seen = set()
        for item in extra_fields:
            if not isinstance(item, dict):
                continue
            key = _text(item.get('key'))
            if not key or key in seen:
                continue
            seen.add(key)
            cleaned.append({'key': key, 'label': _text(item.get('label'), key)})
        extra_fields = cleaned or base['weekExtraFields']

    catalog = data.get('mediaCatalog')
    if not isinstance(catalog, list) or not catalog:
        catalog = base['mediaCatalog']
    else:
        names = set()
        cleaned_cat = []
        for item in catalog:
            if isinstance(item, str):
                name = item.strip()
                item = {'name': name}
            if not isinstance(item, dict):
                continue
            name = _text(item.get('name'))
            if not name or name in names:
                continue
            names.add(name)
            cleaned_cat.append({
                'name': name,
                'status': _text(item.get('status')),
                'weekCost': 0,
                'openingCumulative': _num(item.get('openingCumulative')),
                'photos': _normalize_photos(item),
            })
        catalog = cleaned_cat or base['mediaCatalog']

    project = {
        'salesBaseWan': _num(data.get('salesBaseWan')),
        'ownerBudgetPct': _num(data.get('ownerBudgetPct'), 2.375),
        'salesFeePct': _num(data.get('salesFeePct'), 2.375),
        'rewardPct': _num(data.get('rewardPct'), 1.0),
        'showReferralFee': show_referral,
        'showOwnerBudget': show_owner,
        'ownerCategories': owner_cats,
        'execCategories': exec_cats,
        'weekExtraFields': extra_fields,
        'owner': _merge_amounts(owner_cats, data.get('owner')),
        'exec': _merge_amounts(exec_cats, saved_exec_amt),
        'mediaCatalog': catalog,
    }
    # 將表單上的 % 同步到對應欄
    for cat in project['ownerCategories']:
        if cat['key'] == 'fee' and cat.get('kind') == 'rate':
            cat['ratePct'] = project['ownerBudgetPct']
            cat['label'] = f'預算 {project["ownerBudgetPct"]:g}%'
    for cat in project['execCategories']:
        if cat['key'] == 'salesFee':
            cat['ratePct'] = project['salesFeePct']
            cat['label'] = f'廣告預算 {project["salesFeePct"]:g}%'
            cat['inPie'] = False
        elif cat['key'] == 'reward':
            cat['ratePct'] = project['rewardPct']
            cat['label'] = f'人事預算 {project["rewardPct"]:g}%'
            cat['inPie'] = True
        elif cat['key'] == 'total':
            total_pct = project['salesFeePct'] + project['rewardPct']
            cat['ratePct'] = total_pct
            cat['label'] = f'總預算 {total_pct:g}%'
            cat['inPie'] = False
        elif cat['key'] == 'referral':
            cat['inPie'] = False
    return project


def _budget_wan_for(cat: dict, amounts: dict, sales_base: float) -> float:
    kind = cat.get('kind') or 'manual'
    if kind == 'rate':
        return round(sales_base * _num(cat.get('ratePct')) / 100.0, 4)
    if kind == 'rate_sum':
        return round(sales_base * _num(cat.get('ratePct')) / 100.0, 4)
    return _num(amounts.get('budgetWan'))


def enrich_amount_rows(categories: list[dict], amounts: dict, sales_base: float, *, contracted=False) -> dict:
    out = {}
    for cat in categories:
        src = amounts.get(cat['key']) or {}
        budget_wan = _budget_wan_for(cat, src, sales_base)
        budget_yuan = round(budget_wan * WAN_TO_YUAN, 2)
        contracted_yuan = _num(src.get('contracted'))
        sent = _num(src.get('sent'))
        invoiced = _num(src.get('invoiced'))
        row = {
            'budgetWan': budget_wan,
            'budgetYuan': budget_yuan,
            'sent': sent,
            'invoiced': invoiced,
            'unpaid': round(invoiced - sent, 2),
            'contracted': contracted_yuan,
            'remainContract': round(budget_yuan - contracted_yuan, 2),
            'kind': cat.get('kind') or 'manual',
        }
        out[cat['key']] = row
    return out


def _media_item_from(src: dict, fallback: Optional[dict] = None) -> dict:
    src = src if isinstance(src, dict) else {}
    fb = fallback if isinstance(fallback, dict) else {}
    return {
        'name': _text(src.get('name'), fb.get('name') or ''),
        'status': _text(src.get('status'), fb.get('status') or ''),
        'weekCost': _num(src.get('weekCost')),
        'openingCumulative': _num(
            src.get('openingCumulative'),
            fb.get('openingCumulative') or 0,
        ),
        'photos': _normalize_photos(src if src.get('photos') is not None else fb),
    }


def _normalize_extra_items(data: dict, extra_fields: list[dict]) -> tuple[dict, list[dict]]:
    extras_src = data.get('extras') if isinstance(data.get('extras'), dict) else {}
    saved = data.get('extraItems')
    items = []
    seen = set()
    if 'extraItems' in data and isinstance(saved, list):
        for item in saved:
            if not isinstance(item, dict):
                continue
            key = _text(item.get('key'))
            if not key or key in seen:
                continue
            seen.add(key)
            items.append({
                'key': key,
                'label': _text(item.get('label'), key),
                'amount': _num(item.get('amount'), extras_src.get(key)),
            })
        extras = {i['key']: i['amount'] for i in items}
        return extras, items
    for field in extra_fields:
        items.append({
            'key': field['key'],
            'label': field['label'],
            'amount': _num(extras_src.get(field['key'])),
        })
    extras = {i['key']: i['amount'] for i in items}
    return extras, items


def normalize_week(saved: Optional[dict], extra_fields: list[dict], catalog: list[dict]) -> dict:
    data = saved if isinstance(saved, dict) else {}
    extras, extra_items = _normalize_extra_items(data, extra_fields)
    saved_items = data.get('mediaItems')
    by_name = {}
    if isinstance(saved_items, list):
        for item in saved_items:
            if not isinstance(item, dict):
                continue
            name = _text(item.get('name'))
            if not name:
                continue
            by_name[name] = item
    items = []
    names = []
    for cat in catalog:
        name = cat['name']
        names.append(name)
        src = by_name.get(name) or {}
        items.append(_media_item_from({**src, 'name': name}, cat))
    for name, src in by_name.items():
        if name in names:
            continue
        items.append(_media_item_from({**src, 'name': name}))
    return {
        'extras': extras,
        'extraItems': extra_items,
        'mediaItems': items,
    }


def _week_rows(conn, site_id: str) -> list[dict]:
    rows = conn.execute(
        '''
        SELECT week_start, data FROM budget_weeks
        WHERE site_id=?
        ORDER BY week_start ASC
        ''',
        (site_id,),
    ).fetchall()
    out = []
    for row in rows:
        out.append({
            'weekStart': row['week_start'],
            'data': _parse_json(row['data'], {}),
        })
    return out


def _catalog_opening_map(catalog: list[dict]) -> dict:
    return {_text(c.get('name')): _num(c.get('openingCumulative')) for c in catalog if _text(c.get('name'))}


def _week_media_items(rec: dict) -> list[dict]:
    data = rec.get('data') if isinstance(rec, dict) else None
    items = data.get('mediaItems') if isinstance(data, dict) else None
    return items if isinstance(items, list) else []


def _advance_media_balance(
    running: float,
    *,
    catalog_opening: float,
    stored_opening,
    week_cost: float,
) -> float:
    """
    一週結束後的媒體累計：
    正常＝期初＋週執行；若期初誤存成「總累計」則不再加週執行；
    若期初卡在 catalog 種子而 running 已前進，則忽略種子、只加本週執行。
    """
    start = _num(running, catalog_opening)
    wc = _num(week_cost)
    if stored_opening in (None, ''):
        return round(start + wc, 2)
    oc = _num(stored_opening, start)
    cat = _num(catalog_opening)
    # 期初欄位其實存的是本週總累計 → 不可再加週執行
    if wc and abs(oc - (start + wc)) <= 0.005:
        return round(oc, 2)
    # 與鏈上預期期初一致
    if abs(oc - start) <= 0.005:
        return round(start + wc, 2)
    # 舊資料期初一直停在種子
    if abs(oc - cat) <= 0.005 and start > cat + 0.005:
        return round(start + wc, 2)
    # 手動改過期初
    return round(oc + wc, 2)


def _media_balances_before(
    history: list[dict],
    week_start: str,
    catalog_opening: dict,
) -> tuple[dict, dict]:
    """回傳 week_start 之前各媒體結束餘額，以及最後見到的照片。"""
    bal = dict(catalog_opening)
    photos = {}
    for rec in history:
        if rec.get('weekStart', '') >= week_start:
            break
        for item in _week_media_items(rec):
            if not isinstance(item, dict):
                continue
            name = _text(item.get('name'))
            if not name:
                continue
            cat = _num(catalog_opening.get(name), 0)
            bal[name] = _advance_media_balance(
                _num(bal.get(name), cat),
                catalog_opening=cat,
                stored_opening=item.get('openingCumulative'),
                week_cost=item.get('weekCost'),
            )
            ph = _normalize_photos(item)
            if ph:
                photos[name] = ph
    return bal, photos


def _display_week_opening(
    *,
    week_saved: bool,
    stored_opening,
    start_of_week: float,
    catalog_opening: float,
    week_cost: float,
) -> float:
    """未存檔新週：期初＝上週總累計。已存檔：保留手改，但修正「種子／誤存總累計」。"""
    start = _num(start_of_week, catalog_opening)
    cat = _num(catalog_opening)
    wc = _num(week_cost)
    if not week_saved:
        return round(start, 2)
    if stored_opening in (None, ''):
        return round(start, 2)
    oc = _num(stored_opening, start)
    # 誤把總累計寫進期初
    if wc and abs(oc - (start + wc)) <= 0.005:
        return round(start, 2)
    # 期初仍是 catalog 種子，但上週已有累計 → 改顯示正確期初（仍可再手改後存檔）
    if abs(oc - cat) <= 0.005 and start > cat + 0.005:
        return round(start, 2)
    return round(oc, 2)


def assemble_week_view(project: dict, week: dict, history: list[dict], week_start: str, *, week_saved=False) -> dict:
    media = []
    week_media_total = 0.0
    catalog = [
        c for c in (project.get('mediaCatalog') or [])
        if isinstance(c, dict) and _text(c.get('name'))
    ]
    opening = _catalog_opening_map(catalog)
    prior_end, prior_photos = _media_balances_before(history, week_start, opening)
    for c in catalog:
        name = _text(c.get('name'))
        if name and name not in prior_photos:
            ph = _normalize_photos(c)
            if ph:
                prior_photos[name] = ph
    for item in (week.get('mediaItems') or []):
        if not isinstance(item, dict):
            continue
        name = _text(item.get('name'))
        if not name:
            continue
        week_cost = _num(item.get('weekCost'))
        cat_open = _num(opening.get(name), 0)
        start_of_week = _num(prior_end.get(name), cat_open)
        open_val = _display_week_opening(
            week_saved=week_saved,
            stored_opening=item.get('openingCumulative'),
            start_of_week=start_of_week,
            catalog_opening=cat_open,
            week_cost=week_cost,
        )
        week_media_total += week_cost
        if week_saved and isinstance(item.get('photos'), list):
            photos = _normalize_photos(item)
        else:
            photos = _normalize_photos(item) or prior_photos.get(name) or []
        media.append({
            **item,
            'weekCost': week_cost,
            'openingCumulative': open_val,
            'cumulative': round(open_val + week_cost, 2),
            'photos': photos,
        })
    extras = dict(week.get('extras') or {})
    extra_lines = []
    extra_sum = week_media_total
    extra_lines.append({'key': 'media', 'label': '媒體', 'amount': round(week_media_total, 2), 'fromTable': True})
    extra_items = week.get('extraItems')
    if not isinstance(extra_items, list):
        extra_items = [
            {'key': f['key'], 'label': f['label'], 'amount': _num(extras.get(f['key']))}
            for f in (project.get('weekExtraFields') or [])
        ]
    for field in extra_items:
        amt = _num(field.get('amount'))
        extra_sum += amt
        extra_lines.append({
            'key': field.get('key'),
            'label': field.get('label') or field.get('key'),
            'amount': amt,
            'fromTable': False,
        })
    return {
        **week,
        'mediaItems': media,
        'extraLines': extra_lines,
        'extraItems': extra_items,
        'weekMediaTotal': round(week_media_total, 2),
        'weekGrandTotalYuan': round(extra_sum, 2),
        'weekGrandTotalWan': round(extra_sum / WAN_TO_YUAN, 4),
        'mediaCumulativeTotal': round(sum(_num(i.get('cumulative')) for i in media), 2),
    }


def _extras_effectively_empty(extra_items: list[dict]) -> bool:
    if not extra_items:
        return True
    return all(_num(i.get('amount')) == 0 for i in extra_items if isinstance(i, dict))


def apply_previous_budget_week_carry(
    week: dict,
    project: dict,
    history: list[dict],
    week_start: str,
    *,
    week_saved: bool,
) -> dict:
    """
    未存檔新週：週花費雜項金額延續上週；媒體期初由 assemble_week_view 處理。
    已存檔不覆蓋。
    """
    if week_saved or not isinstance(week, dict):
        return week
    prev = None
    for rec in history:
        if rec['weekStart'] < week_start:
            prev = rec
        else:
            break
    if not prev or not isinstance(prev.get('data'), dict):
        return week
    prev_data = prev['data']
    prev_items = prev_data.get('extraItems')
    used_saved_list = isinstance(prev_items, list) and bool(prev_items)
    if not used_saved_list:
        prev_extras = prev_data.get('extras') if isinstance(prev_data.get('extras'), dict) else {}
        if not prev_extras:
            return week
        prev_items = [
            {'key': f['key'], 'label': f['label'], 'amount': _num(prev_extras.get(f['key']))}
            for f in (project.get('weekExtraFields') or [])
        ]
    if _extras_effectively_empty(week.get('extraItems') or []):
        if used_saved_list:
            carried = []
            extras_map = {}
            for item in prev_items:
                if not isinstance(item, dict):
                    continue
                key = _text(item.get('key'))
                if not key or key == 'media':
                    continue
                label = _text(item.get('label'), key)
                amount = _num(item.get('amount'))
                carried.append({'key': key, 'label': label, 'amount': amount})
                extras_map[key] = amount
        else:
            carried = []
            extras_map = {}
            for item in prev_items:
                if not isinstance(item, dict):
                    continue
                key = _text(item.get('key'))
                if not key:
                    continue
                label = _text(item.get('label'), key)
                amount = _num(item.get('amount'))
                carried.append({'key': key, 'label': label, 'amount': amount})
                extras_map[key] = amount
        if carried:
            week = {**week, 'extraItems': carried, 'extras': extras_map}
    return week


def pie_items(categories: list[dict], rows: dict) -> list[dict]:
    """依已請款金額繪製圓餅（與週報 PPT 一致）。"""
    items = []
    for cat in categories:
        if not cat.get('inPie'):
            continue
        yuan = _num((rows.get(cat['key']) or {}).get('invoiced'))
        wan = round(yuan / WAN_TO_YUAN, 4)
        if wan <= 0:
            continue
        items.append({'key': cat['key'], 'label': cat['label'], 'budgetWan': wan, 'invoiced': yuan})
    total = sum(i['budgetWan'] for i in items) or 0
    for item in items:
        item['pct'] = round(item['budgetWan'] / total * 100, 1) if total else 0
    return items


def load_budget(conn: sqlite3.Connection, site_id: str, week_start: str, *, site_name='', origin=None) -> dict:
    start, end = week_bounds(week_start)
    week_start = start.isoformat()
    project = normalize_project(_load_project_raw(conn, site_id), site_name=site_name)
    week_row = conn.execute(
        'SELECT data FROM budget_weeks WHERE site_id=? AND week_start=?',
        (site_id, week_start),
    ).fetchone()
    week = normalize_week(
        _parse_json(week_row['data'] if week_row else None, {}),
        project['weekExtraFields'],
        project['mediaCatalog'],
    )
    history = _week_rows(conn, site_id)
    week_saved = bool(week_row)
    week = apply_previous_budget_week_carry(
        week, project, history, week_start, week_saved=week_saved,
    )
    week_view = assemble_week_view(project, week, history, week_start, week_saved=week_saved)
    owner_rows = enrich_amount_rows(
        project['ownerCategories'], project['owner'], project['salesBaseWan'], contracted=True,
    )
    exec_rows = enrich_amount_rows(
        project['execCategories'], project['exec'], project['salesBaseWan'],
    )
    week_no = default_week_number(start, origin)
    return {
        'siteId': site_id,
        'siteName': site_name,
        'weekStart': week_start,
        'weekEnd': end.isoformat(),
        'weekNumber': week_no,
        'rocLabel': f'{roc_year(start)}/{start.month:02d}/{start.day:02d}-{roc_year(end)}/{end.month:02d}/{end.day:02d}',
        'project': {
            **project,
            'ownerRows': owner_rows,
            'execRows': exec_rows,
            'pie': pie_items(project['execCategories'], exec_rows),
        },
        'week': week_view,
        'mediaPresets': list(MEDIA_PRESETS),
        'saved': bool(week_row),
        'projectSaved': bool(conn.execute(
            'SELECT 1 FROM budget_projects WHERE site_id=?', (site_id,)
        ).fetchone()),
    }


def save_budget(conn: sqlite3.Connection, site_id: str, body: dict, *, site_name='') -> dict:
    week_start = _text(body.get('weekStart'))
    start, _end = week_bounds(week_start)
    week_start = start.isoformat()
    current = normalize_project(_load_project_raw(conn, site_id), site_name=site_name)
    incoming_project = body.get('project') if isinstance(body.get('project'), dict) else {}
    incoming_week = body.get('week') if isinstance(body.get('week'), dict) else {}
    extra_items_in = incoming_week.get('extraItems')
    if isinstance(extra_items_in, list):
        fields = []
        seen = set()
        extras_map = {}
        cleaned_extras = []
        for item in extra_items_in:
            if not isinstance(item, dict):
                continue
            key = _text(item.get('key'))
            if not key or key in seen:
                continue
            seen.add(key)
            label = _text(item.get('label'), key)
            amount = _num(item.get('amount'))
            fields.append({'key': key, 'label': label})
            extras_map[key] = amount
            cleaned_extras.append({'key': key, 'label': label, 'amount': amount})
        incoming_project['weekExtraFields'] = fields
        incoming_week['extras'] = extras_map
        incoming_week['extraItems'] = cleaned_extras
    merged_project = normalize_project({**current, **incoming_project}, site_name=site_name)
    conn.execute(
        '''
        INSERT INTO budget_projects (site_id, data, updated_at)
        VALUES (?, ?, datetime('now', 'localtime'))
        ON CONFLICT(site_id) DO UPDATE SET
          data=excluded.data,
          updated_at=datetime('now', 'localtime')
        ''',
        (site_id, json.dumps(_dump_project(merged_project), ensure_ascii=False)),
    )

    # 週媒體若改了項目清單，同步回 catalog 期初累計與名稱
    week_norm = normalize_week(
        incoming_week,
        merged_project['weekExtraFields'],
        merged_project['mediaCatalog'],
    )
    extra_items = incoming_week.get('mediaItems') if isinstance(incoming_week.get('mediaItems'), list) else []
    if extra_items:
        catalog = list(merged_project['mediaCatalog'])
        known = {c['name']: i for i, c in enumerate(catalog)}
        for item in extra_items:
            if not isinstance(item, dict):
                continue
            name = _text(item.get('name'))
            if not name:
                continue
            opening = _num(item.get('openingCumulative'))
            status = _text(item.get('status'))
            if name in known:
                # catalog 期初僅作種子；週期初累計存在 budget_weeks，勿回寫以免與歷週加總重複
                if status:
                    catalog[known[name]]['status'] = status
                photos = _normalize_photos(item)
                if photos or 'photos' in item:
                    catalog[known[name]]['photos'] = photos
            else:
                catalog.append({
                    'name': name,
                    'status': status,
                    'weekCost': 0,
                    'openingCumulative': opening,
                    'photos': _normalize_photos(item),
                })
                known[name] = len(catalog) - 1
        merged_project['mediaCatalog'] = catalog
        conn.execute(
            '''
            UPDATE budget_projects SET data=?, updated_at=datetime('now', 'localtime')
            WHERE site_id=?
            ''',
            (json.dumps(_dump_project(merged_project), ensure_ascii=False), site_id),
        )
        week_norm = normalize_week(incoming_week, merged_project['weekExtraFields'], catalog)

    conn.execute(
        '''
        INSERT INTO budget_weeks (site_id, week_start, data, updated_at)
        VALUES (?, ?, ?, datetime('now', 'localtime'))
        ON CONFLICT(site_id, week_start) DO UPDATE SET
          data=excluded.data,
          updated_at=datetime('now', 'localtime')
        ''',
        (site_id, week_start, json.dumps({
            'extras': week_norm['extras'],
            'extraItems': week_norm['extraItems'],
            'mediaItems': [
                {
                    'name': i['name'],
                    'status': i.get('status') or '',
                    'weekCost': _num(i.get('weekCost')),
                    'openingCumulative': _num(i.get('openingCumulative')),
                    'photos': _normalize_photos(i),
                }
                for i in week_norm['mediaItems']
            ],
        }, ensure_ascii=False)),
    )
    return {'weekStart': week_start}
