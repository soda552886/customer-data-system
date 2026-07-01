import csv
import io
import json
import os
import re
import sqlite3
from datetime import datetime
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory, Response

from config.sites import SITES

BASE_DIR = Path(__file__).parent

_fields_path = BASE_DIR / 'config' / 'fields_data.json'
with open(_fields_path, encoding='utf-8') as _f:
    _field_data = json.load(_f)
FIELD_SECTIONS = _field_data['sections']
SALES_STAFF = _field_data['salesStaff']

app = Flask(__name__, static_folder='public', static_url_path='')

DATA_DIR = Path(os.environ.get('DATA_DIR', str(BASE_DIR / 'data')))
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / 'customers.db'


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    conn.executescript('''
        CREATE TABLE IF NOT EXISTS customers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            site_id TEXT NOT NULL,
            site_name TEXT NOT NULL,
            visit_type TEXT NOT NULL,
            is_deal INTEGER NOT NULL DEFAULT 0,
            visit_date TEXT,
            first_visit_date TEXT,
            return_visit_date TEXT,
            data TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_customers_site ON customers(site_id);
        CREATE INDEX IF NOT EXISTS idx_customers_visit_type ON customers(visit_type);
        CREATE INDEX IF NOT EXISTS idx_customers_visit_date ON customers(visit_date);
    ''')
    conn.commit()
    conn.close()


def normalize_phone(phone):
    return re.sub(r'\D', '', str(phone or ''))


SITE_BY_NAME = {s['name']: s for s in SITES}
SITE_BY_ID = {s['id']: s for s in SITES}

MULTISELECT_KEYS = {
    'roomType', 'floorNeed', 'areaNeed', 'unitType', 'unitNeed',
    'notPurchasedReason', 'purchasedReason',
}

LABEL_TO_KEY = {
    '日期': '_visit_date', '案場': '_site_name', '客戶類型': '_visit_type',
    '是否成交': '_is_deal', '建檔時間': '_created_at',
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
    '已購/成交因素': 'purchasedReason', '洽談內容': 'discussion',
    '客戶來源': 'customerSource', '客戶誠意度': 'sincerity',
    '銷售人員1': 'salesperson1', '銷售人員2': 'salesperson2',
}

ALL_FIELD_KEYS = set(LABEL_TO_KEY.values()) | MULTISELECT_KEYS | {
    'visitDate', 'firstVisitDate', 'returnVisitDate', 'customerName', 'phone',
    'discussion', 'salesperson1', 'region',
}


def map_header_to_key(header):
    h = str(header).strip().lstrip('\ufeff')
    if h in LABEL_TO_KEY:
        return LABEL_TO_KEY[h]
    if h in ALL_FIELD_KEYS:
        return h
    return None

TEMPLATE_HEADERS = [
    '案場', '客戶類型', '是否成交', '日期', '客戶姓名', '主要電話', '區域',
    '年齡', '職業', '總價預算', '媒體1', '媒體2', '洽談內容', '銷售人員1',
]


def parse_bool_deal(val):
    if val is None or str(val).strip() == '':
        return 0
    s = str(val).strip().lower()
    return 1 if s in ('是', '1', 'true', 'yes', 'y', '成交') else 0


def parse_cell_value(key, val):
    if val is None or str(val).strip() == '':
        return None
    s = str(val).strip()
    if key in MULTISELECT_KEYS:
        parts = re.split(r'[、;；,，]', s)
        return [p.strip() for p in parts if p.strip()]
    return s


def resolve_site(site_name, default_site_id=None):
    if site_name:
        name = str(site_name).strip()
        if name in SITE_BY_NAME:
            return SITE_BY_NAME[name]
        for s in SITES:
            if s['name'] in name or name in s['name']:
                return s
    if default_site_id and default_site_id in SITE_BY_ID:
        return SITE_BY_ID[default_site_id]
    return None


def row_to_record(row_dict, default_site_id=None):
    system = {
        'site_id': None, 'site_name': None, 'visit_type': '新客',
        'is_deal': 0, 'visit_date': None,
        'first_visit_date': None, 'return_visit_date': None,
    }
    data = {}

    for header, raw_val in row_dict.items():
        if raw_val is None or str(raw_val).strip() == '':
            continue
        key = map_header_to_key(header)
        if not key:
            continue

        if key == '_site_name':
            system['site_name'] = str(raw_val).strip()
            continue
        if key == '_visit_type':
            system['visit_type'] = str(raw_val).strip() or '新客'
            continue
        if key == '_is_deal':
            system['is_deal'] = parse_bool_deal(raw_val)
            continue
        if key == '_visit_date':
            system['visit_date'] = str(raw_val).strip()
            continue
        if key == '_created_at':
            continue

        parsed = parse_cell_value(key, raw_val)
        if parsed is not None:
            data[key] = parsed

    site = resolve_site(system['site_name'], default_site_id)
    if not site:
        return None, '找不到案場（請填寫正確案場名稱或於匯入頁選擇預設案場）'

    system['site_id'] = site['id']
    system['site_name'] = site['name']

    if not data.get('customerName'):
        return None, '缺少客戶姓名'
    if not data.get('phone'):
        return None, '缺少主要電話'

    visit_type = system['visit_type']
    if not system['visit_date']:
        system['visit_date'] = (
            data.get('returnVisitDate') if visit_type == '回訪'
            else data.get('visitDate')
        ) or datetime.now().strftime('%Y-%m-%d')

    system['first_visit_date'] = data.get('firstVisitDate')
    system['return_visit_date'] = data.get('returnVisitDate')

    return {'system': system, 'data': data}, None


def insert_customer_record(system, data):
    conn = get_db()
    cur = conn.execute('''
        INSERT INTO customers (site_id, site_name, visit_type, is_deal, visit_date,
                               first_visit_date, return_visit_date, data)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        system['site_id'], system['site_name'], system['visit_type'],
        system['is_deal'], system['visit_date'],
        system.get('first_visit_date'), system.get('return_visit_date'),
        json.dumps(data, ensure_ascii=False),
    ))
    conn.commit()
    new_id = cur.lastrowid
    conn.close()
    return new_id


@app.route('/')
def index():
    return send_from_directory('public', 'index.html')


@app.route('/search.html')
def search_page():
    return send_from_directory('public', 'search.html')


@app.route('/import.html')
def import_page():
    return send_from_directory('public', 'import.html')


@app.route('/api/import/template')
def import_template():
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(TEMPLATE_HEADERS)
    writer.writerow([
        '首學杭州', '新客', '否', '2026-07-01', '王小明', '0912345678', '大安區',
        '31-40歲', '上班族', '2000萬以下', 'FB', '介紹', '客戶對產品有興趣，需回去討論', '簡婉如',
    ])
    bom = '\ufeff'
    return Response(
        bom + output.getvalue(),
        mimetype='text/csv; charset=utf-8',
        headers={'Content-Disposition': 'attachment; filename=得意佳_客戶資料匯入範本.csv'},
    )


@app.route('/api/customers/import', methods=['POST'])
def import_customers():
    default_site_id = request.form.get('defaultSiteId', '').strip() or None

    if 'file' not in request.files:
        return jsonify({'error': '請上傳 CSV 檔案'}), 400

    file = request.files['file']
    if not file.filename:
        return jsonify({'error': '請選擇檔案'}), 400

    try:
        raw = file.read()
        for encoding in ('utf-8-sig', 'utf-8', 'big5', 'cp950'):
            try:
                text = raw.decode(encoding)
                break
            except UnicodeDecodeError:
                continue
        else:
            return jsonify({'error': '無法讀取檔案編碼，請使用 UTF-8 或 Big5 編碼的 CSV'}), 400

        reader = csv.DictReader(io.StringIO(text))
        if not reader.fieldnames:
            return jsonify({'error': 'CSV 檔案沒有欄位標題列'}), 400

        imported = 0
        errors = []

        for i, row in enumerate(reader, start=2):
            if not any(str(v).strip() for v in row.values() if v):
                continue
            record, err = row_to_record(row, default_site_id)
            if err:
                errors.append({'row': i, 'message': err})
                continue
            try:
                insert_customer_record(record['system'], record['data'])
                imported += 1
            except Exception as e:
                errors.append({'row': i, 'message': str(e)})

        return jsonify({
            'success': True,
            'imported': imported,
            'failed': len(errors),
            'errors': errors[:50],
        })
    except csv.Error as e:
        return jsonify({'error': f'CSV 格式錯誤：{e}'}), 400
    except Exception as e:
        return jsonify({'error': f'匯入失敗：{e}'}), 500


@app.route('/api/sites')
def api_sites():
    return jsonify(SITES)


@app.route('/api/fields')
def api_fields():
    return jsonify({'sections': FIELD_SECTIONS, 'salesStaff': SALES_STAFF})


@app.route('/api/customers/lookup')
def lookup_customer():
    phone = request.args.get('phone', '')
    site_id = request.args.get('siteId', '')
    if not phone or not site_id:
        return jsonify({'error': '請提供電話號碼與案場'}), 400

    normalized = normalize_phone(phone)
    conn = get_db()
    rows = conn.execute('''
        SELECT * FROM customers
        WHERE site_id = ? AND visit_type = '新客'
        ORDER BY visit_date DESC, id DESC
    ''', (site_id,)).fetchall()
    conn.close()

    for row in rows:
        data = json.loads(row['data'])
        if normalized in normalize_phone(data.get('phone', '')):
            record = dict(row)
            record['data'] = data
            return jsonify({'found': True, 'record': record})

    return jsonify({'found': False})


@app.route('/api/customers', methods=['POST'])
def create_customer():
    body = request.get_json()
    site_id = body.get('siteId')
    visit_type = body.get('visitType')
    data = body.get('data')
    if not site_id or not visit_type or not data:
        return jsonify({'error': '缺少必要欄位'}), 400

    visit_date = (
        data.get('returnVisitDate') if visit_type == '回訪'
        else data.get('visitDate')
    ) or datetime.now().strftime('%Y-%m-%d')

    new_id = insert_customer_record({
        'site_id': site_id,
        'site_name': body.get('siteName', site_id),
        'visit_type': visit_type,
        'is_deal': 1 if body.get('isDeal') else 0,
        'visit_date': visit_date,
        'first_visit_date': data.get('firstVisitDate'),
        'return_visit_date': data.get('returnVisitDate'),
    }, data)
    return jsonify({'success': True, 'id': new_id})


@app.route('/api/customers')
def list_customers():
    year = request.args.get('year', '')
    start_date = request.args.get('startDate', '')
    end_date = request.args.get('endDate', '')
    site_id = request.args.get('siteId', '')
    visit_type = request.args.get('visitType', '')
    is_deal = request.args.get('isDeal', '')
    region = request.args.get('region', '')
    phone = request.args.get('phone', '')
    name = request.args.get('name', '')
    page = max(1, int(request.args.get('page', 1)))
    limit = min(200, max(1, int(request.args.get('limit', 50))))

    sql = 'SELECT * FROM customers WHERE 1=1'
    params = []

    if year:
        sql += " AND strftime('%Y', visit_date) = ?"
        params.append(year)
    if start_date:
        sql += ' AND visit_date >= ?'
        params.append(start_date)
    if end_date:
        sql += ' AND visit_date <= ?'
        params.append(end_date)
    if site_id:
        sql += ' AND site_id = ?'
        params.append(site_id)
    if visit_type:
        sql += ' AND visit_type = ?'
        params.append(visit_type)
    if is_deal != '':
        sql += ' AND is_deal = ?'
        params.append(1 if is_deal in ('true', '1') else 0)

    conn = get_db()
    all_rows = conn.execute(sql, params).fetchall()

    filtered = []
    for row in all_rows:
        data = json.loads(row['data'])
        if region and region not in str(data.get('region', '')):
            continue
        if phone and normalize_phone(phone) not in normalize_phone(data.get('phone', '')):
            continue
        if name and name not in str(data.get('customerName', '')):
            continue
        record = dict(row)
        record['data'] = data
        filtered.append(record)

    total = len(filtered)
    start = (page - 1) * limit
    page_rows = filtered[start:start + limit]
    conn.close()

    return jsonify({'total': total, 'page': page, 'limit': limit, 'records': page_rows})


@app.route('/api/customers/<int:record_id>')
def get_customer(record_id):
    conn = get_db()
    row = conn.execute('SELECT * FROM customers WHERE id = ?', (record_id,)).fetchone()
    conn.close()
    if not row:
        return jsonify({'error': '找不到資料'}), 404
    record = dict(row)
    record['data'] = json.loads(record['data'])
    return jsonify(record)


@app.route('/api/customers/<int:record_id>', methods=['DELETE'])
def delete_customer(record_id):
    conn = get_db()
    cur = conn.execute('DELETE FROM customers WHERE id = ?', (record_id,))
    conn.commit()
    conn.close()
    if cur.rowcount == 0:
        return jsonify({'error': '找不到資料'}), 404
    return jsonify({'success': True})


@app.route('/api/stats')
def stats():
    year = request.args.get('year', '')
    site_id = request.args.get('siteId', '')
    sql = '''
        SELECT site_name, visit_type, is_deal, COUNT(*) as count
        FROM customers WHERE 1=1
    '''
    params = []
    if year:
        sql += " AND strftime('%Y', visit_date) = ?"
        params.append(year)
    if site_id:
        sql += ' AND site_id = ?'
        params.append(site_id)
    sql += ' GROUP BY site_name, visit_type, is_deal ORDER BY site_name'

    conn = get_db()
    rows = [dict(r) for r in conn.execute(sql, params).fetchall()]
    conn.close()
    return jsonify(rows)


init_db()


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 3000))
    print(f'客戶資料系統已啟動: http://localhost:{port}')
    app.run(host='0.0.0.0', port=port, debug=False)
