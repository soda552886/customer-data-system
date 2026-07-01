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

### 資料持久化

**免費方案**：資料存在容器內，重新部署後可能清空。適合測試使用。

**正式使用（建議）**：升級為付費方案後，在 Render 控制台加入 Persistent Disk：
- 掛載路徑：`/var/data`
- 環境變數：`DATA_DIR` = `/var/data`

資料庫會保存在雲端，重新部署不會遺失。

## 資料儲存

- 本機：`data/customers.db`
- Render 雲端：`/var/data/customers.db`
