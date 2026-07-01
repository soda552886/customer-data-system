const express = require('express');
const cors = require('cors');
const path = require('path');
const Database = require('better-sqlite3');
const sites = require('./config/sites');
const { FIELD_SECTIONS, SALES_STAFF } = require('./config/fields');

const app = express();
const PORT = process.env.PORT || 3000;
const dbPath = path.join(__dirname, 'data', 'customers.db');

const fs = require('fs');
fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
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
  CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(json_extract(data, '$.phone'));
`);

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

app.get('/api/sites', (_req, res) => {
  res.json(sites);
});

app.get('/api/fields', (_req, res) => {
  res.json({ sections: FIELD_SECTIONS, salesStaff: SALES_STAFF });
});

app.get('/api/customers/lookup', (req, res) => {
  const { phone, siteId } = req.query;
  if (!phone || !siteId) {
    return res.status(400).json({ error: '請提供電話號碼與案場' });
  }
  const normalized = normalizePhone(phone);
  const rows = db.prepare(`
    SELECT * FROM customers
    WHERE site_id = ? AND visit_type = '新客'
      AND replace(replace(replace(json_extract(data, '$.phone'), '-', ''), ' ', ''), '+', '') LIKE ?
    ORDER BY visit_date DESC, id DESC
    LIMIT 1
  `).all(siteId, `%${normalized}%`);

  if (rows.length === 0) {
    return res.json({ found: false });
  }
  const row = rows[0];
  res.json({
    found: true,
    record: { ...row, data: JSON.parse(row.data) },
  });
});

app.post('/api/customers', (req, res) => {
  const { siteId, siteName, visitType, isDeal, data } = req.body;
  if (!siteId || !visitType || !data) {
    return res.status(400).json({ error: '缺少必要欄位' });
  }

  const visitDate = visitType === '回訪'
    ? (data.returnVisitDate || new Date().toISOString().slice(0, 10))
    : (data.visitDate || new Date().toISOString().slice(0, 10));

  const result = db.prepare(`
    INSERT INTO customers (site_id, site_name, visit_type, is_deal, visit_date, first_visit_date, return_visit_date, data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    siteId,
    siteName || siteId,
    visitType,
    isDeal ? 1 : 0,
    visitDate,
    data.firstVisitDate || null,
    data.returnVisitDate || null,
    JSON.stringify(data),
  );

  res.json({ success: true, id: result.lastInsertRowid });
});

app.get('/api/customers', (req, res) => {
  const {
    year, startDate, endDate, region, siteId, visitType, isDeal,
    phone, name, page = '1', limit = '50',
  } = req.query;

  let sql = 'SELECT * FROM customers WHERE 1=1';
  const params = [];

  if (year) {
    sql += " AND strftime('%Y', visit_date) = ?";
    params.push(year);
  }
  if (startDate) {
    sql += ' AND visit_date >= ?';
    params.push(startDate);
  }
  if (endDate) {
    sql += ' AND visit_date <= ?';
    params.push(endDate);
  }
  if (siteId) {
    sql += ' AND site_id = ?';
    params.push(siteId);
  }
  if (visitType) {
    sql += ' AND visit_type = ?';
    params.push(visitType);
  }
  if (isDeal !== undefined && isDeal !== '') {
    sql += ' AND is_deal = ?';
    params.push(isDeal === 'true' || isDeal === '1' ? 1 : 0);
  }
  if (region) {
    sql += " AND json_extract(data, '$.region') LIKE ?";
    params.push(`%${region}%`);
  }
  if (phone) {
    const normalized = normalizePhone(phone);
    sql += " AND replace(replace(replace(json_extract(data, '$.phone'), '-', ''), ' ', ''), '+', '') LIKE ?";
    params.push(`%${normalized}%`);
  }
  if (name) {
    sql += " AND json_extract(data, '$.customerName') LIKE ?";
    params.push(`%${name}%`);
  }

  const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as total');
  const total = db.prepare(countSql).get(...params).total;

  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  sql += ' ORDER BY visit_date DESC, id DESC LIMIT ? OFFSET ?';
  params.push(limitNum, offset);

  const rows = db.prepare(sql).all(...params).map((row) => ({
    ...row,
    data: JSON.parse(row.data),
  }));

  res.json({ total, page: pageNum, limit: limitNum, records: rows });
});

app.get('/api/customers/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '找不到資料' });
  res.json({ ...row, data: JSON.parse(row.data) });
});

app.delete('/api/customers/:id', (req, res) => {
  const result = db.prepare('DELETE FROM customers WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: '找不到資料' });
  res.json({ success: true });
});

app.get('/api/stats', (req, res) => {
  const { year, siteId } = req.query;
  let sql = `
    SELECT site_name, visit_type, is_deal, COUNT(*) as count
    FROM customers WHERE 1=1
  `;
  const params = [];
  if (year) {
    sql += " AND strftime('%Y', visit_date) = ?";
    params.push(year);
  }
  if (siteId) {
    sql += ' AND site_id = ?';
    params.push(siteId);
  }
  sql += ' GROUP BY site_name, visit_type, is_deal ORDER BY site_name';
  res.json(db.prepare(sql).all(...params));
});

app.listen(PORT, () => {
  console.log(`客戶資料系統已啟動: http://localhost:${PORT}`);
});
