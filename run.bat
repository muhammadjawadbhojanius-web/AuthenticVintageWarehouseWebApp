@echo off
REM ============================================================
REM  Authentic Vintage Warehouse — Run on Windows (no Docker)
REM  Starts nginx (8082), backend (8080), and frontend (3000).
REM  Access the app at: http://localhost:8082
REM ============================================================

echo.
echo ======================================
echo  Starting Authentic Vintage Warehouse
echo ======================================

REM Ensure directories exist
if not exist "%~dp0backend\data" mkdir "%~dp0backend\data"
if not exist "%~dp0backend\uploads" mkdir "%~dp0backend\uploads"

echo.
echo Starting backend on port 8080...
cd /d "%~dp0backend"
start "AVW-Backend" cmd /k "call venv\Scripts\activate.bat && set DB_DIR=data && uvicorn app.main:app --host 0.0.0.0 --port 8080 --timeout-keep-alive 75"

echo Starting frontend on port 3000...
cd /d "%~dp0frontend"
start "AVW-Frontend" cmd /k "set PORT=3000 && set HOSTNAME=0.0.0.0 && node .next\standalone\server.js"

echo Starting nginx on port 8082...
cd /d "%~dp0"
start "AVW-Nginx" cmd /k "nginx -c "%~dp0nginx\windows.conf" -e stderr"

REM Wait a moment for services to start
timeout /t 3 /nobreak >nul

echo.
echo ======================================
echo  App is running!
echo  Open: http://localhost:8082
echo ======================================
echo.
echo  Nginx:    http://localhost:8082 (main entry)
echo  Backend:  http://localhost:8080
echo  Frontend: http://localhost:3000
echo.
echo  Close the three terminal windows to stop.
echo ======================================
pause
