import json
import os
import re
import sqlite3
from datetime import datetime
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory

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


@app.route('/')
def index():
    return send_from_directory('public', 'index.html')


@app.route('/search.html')
def search_page():
    return send_from_directory('public', 'search.html')


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

    conn = get_db()
    cur = conn.execute('''
        INSERT INTO customers (site_id, site_name, visit_type, is_deal, visit_date,
                               first_visit_date, return_visit_date, data)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        site_id,
        body.get('siteName', site_id),
        visit_type,
        1 if body.get('isDeal') else 0,
        visit_date,
        data.get('firstVisitDate'),
        data.get('returnVisitDate'),
        json.dumps(data, ensure_ascii=False),
    ))
    conn.commit()
    new_id = cur.lastrowid
    conn.close()
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
