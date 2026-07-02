"""從遠端站台匯出客戶資料為可重新匯入的 CSV。"""
import csv
import json
import sys
import urllib.request
from pathlib import Path

BASE_URL = sys.argv[1] if len(sys.argv) > 1 else 'https://customer-data-system-1.onrender.com'
OUT_DIR = Path(__file__).resolve().parent.parent / 'migration'
CHUNK_SIZE = 2000

LABEL_TO_KEY = {
    '日期': '_visit_date', '案場': '_site_name', '客戶類型': '_visit_type',
    '是否成交': '_is_deal',
    '參觀日期': 'visitDate', '首次參觀日期': 'firstVisitDate',
    '回訪日期': 'returnVisitDate', '前次來訪日期': 'prevVisitDate',
    '回訪次數': 'visitCount', '回籠次數': 'returnCount',
    '客戶姓名': 'customerName', '主要電話': 'phone', '次要電話': 'phoneSecondary',
    '居住地址': 'address', '街道路名或社區': 'streetCommunity', '區域': 'region',
    '年齡': 'age', '職業': 'occupation', '購屋用途': 'purchasePurpose',
    '購屋動機': 'purchaseMotive', '購屋需求': 'purchaseNeed',
    '總價預算': 'budget', '自備款': 'downPayment',
    '媒體1': 'media1', '媒體2': 'media2', '媒體3': 'media3', '媒體': 'media',
    '介紹建案': 'commercialProject', '需求房型': 'roomType', '需求樓層': 'floorNeed',
    '需求坪數': 'areaNeed', '需求戶型': 'unitType', '需求戶別': 'unitNeed',
    '房間需求': 'roomNeed', '車位需求': 'parkingNeed',
    '產品需求-住宅': 'productResidential', '產品需求-事務所': 'productOffice',
    '介紹戶別樓層': 'introUnit', '當日來人': 'visitorCount', '來人關係': 'visitorRelation',
    '未購因素': 'notPurchasedReason', '成交因素': 'purchasedReason',
    '洽談內容': 'discussion', '客戶來源': 'customerSource', '客戶誠意度': 'sincerity',
    '銷售人員1': 'salesperson1', '銷售人員2': 'salesperson2',
    '備註': 'remark', '客戶狀態': 'customerStatus',
}

HEADERS = list(LABEL_TO_KEY.keys())


def fetch_json(url):
    with urllib.request.urlopen(url, timeout=120) as resp:
        return json.loads(resp.read().decode('utf-8'))


def cell_value(record, key):
    if key == '_visit_date':
        return record.get('visit_date') or ''
    if key == '_site_name':
        return record.get('site_name') or ''
    if key == '_visit_type':
        return record.get('visit_type') or ''
    if key == '_is_deal':
        return '是' if record.get('is_deal') else '否'
    data = record.get('data') or {}
    val = data.get(key)
    if val is None:
        return ''
    if isinstance(val, list):
        return '、'.join(str(x) for x in val)
    return str(val)


def fetch_all_records():
    page = 1
    limit = 200
    all_records = []
    while True:
        url = f'{BASE_URL}/api/customers?page={page}&limit={limit}'
        print(f'Fetching page {page}...', flush=True)
        payload = fetch_json(url)
        records = payload.get('records') or []
        all_records.extend(records)
        total = payload.get('total', 0)
        if len(all_records) >= total or not records:
            break
        page += 1
    return all_records


def write_csv(path, records):
    with path.open('w', encoding='utf-8-sig', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(HEADERS)
        for record in records:
            writer.writerow([cell_value(record, LABEL_TO_KEY[h]) for h in HEADERS])


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    records = fetch_all_records()
    print(f'Total records: {len(records)}')

    full_path = OUT_DIR / '得意佳_全資料匯出.csv'
    write_csv(full_path, records)
    print(f'Wrote {full_path}')

    for i in range(0, len(records), CHUNK_SIZE):
        chunk = records[i:i + CHUNK_SIZE]
        part = i // CHUNK_SIZE + 1
        chunk_path = OUT_DIR / f'得意佳_匯入用_part{part:02d}.csv'
        write_csv(chunk_path, chunk)
        print(f'Wrote {chunk_path} ({len(chunk)} rows)')


if __name__ == '__main__':
    main()
