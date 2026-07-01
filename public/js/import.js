let selectedFile = null;
let sites = [];

function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast ${type}`;
  setTimeout(() => toast.classList.add('hidden'), 4000);
}

async function loadSites() {
  const res = await fetch('/api/sites');
  sites = await res.json();
  const sel = document.getElementById('defaultSite');
  sites.forEach((s) => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.name;
    sel.appendChild(opt);
  });
}

function setFile(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.csv') && !file.name.toLowerCase().endsWith('.txt')) {
    showToast('請上傳 CSV 檔案', 'error');
    return;
  }
  selectedFile = file;
  document.getElementById('fileName').textContent = `已選擇：${file.name}（${(file.size / 1024).toFixed(1)} KB）`;
  document.getElementById('previewBtn').disabled = false;
  document.getElementById('importBtn').disabled = false;
  document.getElementById('resultSection').classList.add('hidden');
}

function parseCSV(text) {
  const lines = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (c === '"' && next === '"') { cell += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else cell += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(cell); cell = '';
    } else if (c === '\r' && next === '\n') {
      row.push(cell); lines.push(row); row = []; cell = ''; i++;
    } else if (c === '\n') {
      row.push(cell); lines.push(row); row = []; cell = '';
    } else {
      cell += c;
    }
  }
  if (cell || row.length) { row.push(cell); lines.push(row); }
  return lines.filter((r) => r.some((c) => c.trim()));
}

async function readFileText(file) {
  const buffer = await file.arrayBuffer();
  const encodings = ['utf-8', 'big5'];
  for (const enc of encodings) {
    try {
      const decoder = new TextDecoder(enc, { fatal: true });
      let text = decoder.decode(buffer);
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
      return text;
    } catch { /* try next */ }
  }
  return new TextDecoder().decode(buffer);
}

async function getParsedRows() {
  if (!selectedFile) return null;
  const text = await readFileText(selectedFile);
  const lines = parseCSV(text);
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = lines[0].map((h) => h.trim());
  const rows = lines.slice(1).map((cells) => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = cells[i] || ''; });
    return obj;
  });
  return { headers, rows };
}

async function previewData() {
  const parsed = await getParsedRows();
  if (!parsed || parsed.rows.length === 0) {
    showToast('檔案沒有資料列', 'error');
    return;
  }

  const section = document.getElementById('previewSection');
  const head = document.getElementById('previewHead');
  const body = document.getElementById('previewBody');
  const showCols = parsed.headers.slice(0, 10);

  head.innerHTML = `<tr>${showCols.map((h) => `<th>${h}</th>`).join('')}</tr>`;
  body.innerHTML = parsed.rows.slice(0, 5).map((row) =>
    `<tr>${showCols.map((h) => `<td>${(row[h] || '').slice(0, 30)}</td>`).join('')}</tr>`,
  ).join('');

  section.classList.remove('hidden');
  showToast(`共 ${parsed.rows.length} 筆資料，預覽前 5 筆`);
}

async function doImport() {
  if (!selectedFile) return;

  const btn = document.getElementById('importBtn');
  btn.disabled = true;
  btn.textContent = '匯入中…';

  const formData = new FormData();
  formData.append('file', selectedFile);
  const defaultSite = document.getElementById('defaultSite').value;
  if (defaultSite) formData.append('defaultSiteId', defaultSite);

  try {
    const res = await fetch('/api/customers/import', { method: 'POST', body: formData });
    const json = await res.json();

    const section = document.getElementById('resultSection');
    const summary = document.getElementById('resultSummary');
    const errorsEl = document.getElementById('resultErrors');

    section.classList.remove('hidden');

    if (!res.ok) {
      summary.innerHTML = `<p class="result-fail">匯入失敗：${json.error || '未知錯誤'}</p>`;
      errorsEl.classList.add('hidden');
      showToast(json.error || '匯入失敗', 'error');
    } else {
      summary.innerHTML = `
        <div class="result-stats">
          <div class="stat-card result-ok">
            <div class="stat-value">${json.imported}</div>
            <div class="stat-label">成功匯入</div>
          </div>
          <div class="stat-card ${json.failed ? 'result-warn' : ''}">
            <div class="stat-value">${json.failed}</div>
            <div class="stat-label">失敗筆數</div>
          </div>
        </div>`;

      if (json.errors && json.errors.length > 0) {
        errorsEl.classList.remove('hidden');
        errorsEl.innerHTML = `<h3>失敗明細</h3><ul>${
          json.errors.map((e) => `<li>第 ${e.row} 列：${e.message}</li>`).join('')
        }</ul>`;
      } else {
        errorsEl.classList.add('hidden');
      }
      showToast(`成功匯入 ${json.imported} 筆資料`);
    }
  } catch {
    showToast('匯入失敗，請稍後再試', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '開始匯入';
  }
}

const uploadZone = document.getElementById('uploadZone');
const fileInput = document.getElementById('fileInput');

document.getElementById('pickFileBtn').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => setFile(fileInput.files[0]));

uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
uploadZone.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadZone.classList.remove('drag-over');
  if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]);
});

document.getElementById('previewBtn').addEventListener('click', previewData);
document.getElementById('importBtn').addEventListener('click', doImport);

loadSites();
