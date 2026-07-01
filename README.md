# 客戶資料管理系統

整合多個 Google 表單欄位的客戶資料填寫與搜尋系統。

## 功能

- 多案場客戶資料填寫（新客 / 回訪）
- 回訪電話檢索初訪客況
- 查看資料、自選報表欄位、CSV 匯出

## 本機啟動

```bash
python -m pip install Flask
python server.py
```

或雙擊 `start.bat`，瀏覽器開啟 http://localhost:3000

## 部署到 Render

1. 將此專案 push 到 GitHub
2. 登入 [Render](https://render.com) → **New** → **Blueprint**
3. 連接 GitHub 倉庫，Render 會自動讀取 `render.yaml` 建立服務
4. 部署完成後即可透過 `https://你的服務名.onrender.com` 存取

### 資料持久化（正式長期使用）

> **前提**：Persistent Disk 僅支援 **Starter（付費）** 以上方案，免費方案無法掛載磁碟。

程式已支援環境變數 `DATA_DIR`，資料庫會寫入 `{DATA_DIR}/customers.db`。

---

#### 方法一：在 Render 控制台設定（已有服務時）

**步驟 1 — 升級方案**

1. 登入 [Render Dashboard](https://dashboard.render.com)
2. 點選您的 **customer-data-system** 服務
3. 左側選 **Settings** → 找到 **Instance Type**
4. 從 **Free** 改為 **Starter**（或更高）→ **Save Changes**
5. 等待重新部署完成

**步驟 2 — 新增 Persistent Disk**

1. 在同一服務頁面，左側選 **Disks**（或 Settings 裡的 **Add Disk**）
2. 點 **Add Disk**，填寫：

| 欄位 | 填寫內容 |
|------|----------|
| Name | `customer-data`（任意名稱） |
| Mount Path | `/var/data` |
| Size | `1` GB（可依需求加大，之後只能增大不能縮小） |

3. 點 **Add disk** → 會自動觸發一次重新部署

**步驟 3 — 設定環境變數**

1. 左側選 **Environment**
2. 點 **Add Environment Variable**
3. 新增：

| Key | Value |
|-----|-------|
| `DATA_DIR` | `/var/data` |

4. 點 **Save Changes** → 再次重新部署

**步驟 4 — 確認生效**

部署完成後，在網站填一筆測試資料，然後到 Render 點 **Manual Deploy** 重新部署一次。若資料還在，代表持久化成功。

資料實際路徑：`/var/data/customers.db`

---

#### 方法二：新建服務時一次設定

建立 Web Service 時：

1. **Instance Type** 選 **Starter**（不要選 Free）
2. 展開 **Advanced** → **Add Disk**
   - Mount Path：`/var/data`
   - Size：1 GB
3. **Environment Variables** 新增 `DATA_DIR` = `/var/data`
4. 建立服務

---

#### 方法三：用 Blueprint 一鍵部署（付費版）

專案內有 `render.paid.yaml`，內含磁碟與環境變數設定：

1. 將 `render.paid.yaml` 重新命名為 `render.yaml`（或合併內容）
2. Push 到 GitHub
3. Render → **New** → **Blueprint** → 選倉庫 → **Apply**

---

#### 若已有資料在免費版（部署後會消失）

免費版資料在容器內，升級並掛載磁碟後舊資料**不會自動搬過去**。需在本機匯出 CSV 後，到雲端網站重新匯入，或手動上傳 `customers.db` 到磁碟（需透過 Render Shell，較進階）。

## 資料儲存

- 本機：`data/customers.db`
- Render 雲端（有掛磁碟）：`/var/data/customers.db`
