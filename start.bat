@echo off
chcp 65001 >nul
cd /d "%~dp0"
python -m pip install Flask -q 2>nul
echo 正在啟動客戶資料系統...
start http://localhost:3000
python server.py
pause
