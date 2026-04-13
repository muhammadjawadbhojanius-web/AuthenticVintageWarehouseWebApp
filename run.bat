@echo off
REM ============================================================
REM  Authentic Vintage Warehouse — Run on Windows (no Docker)
REM  Starts the backend (port 8080) and frontend (port 3000).
REM  Access the app at: http://localhost:3000
REM ============================================================

echo.
echo ======================================
echo  Starting Authentic Vintage Warehouse
echo ======================================

REM Create uploads directory if it doesn't exist
if not exist "%~dp0backend\uploads" mkdir "%~dp0backend\uploads"

REM Create data directory for the database
if not exist "%~dp0backend\data" mkdir "%~dp0backend\data"

echo.
echo Starting backend on http://localhost:8080 ...
cd /d "%~dp0backend"
start "AVW-Backend" cmd /k "call venv\Scripts\activate.bat && set DB_DIR=data && uvicorn app.main:app --host 0.0.0.0 --port 8080 --timeout-keep-alive 75"

echo Starting frontend on http://localhost:3000 ...
cd /d "%~dp0frontend"
start "AVW-Frontend" cmd /k "set PORT=3000 && node .next\standalone\server.js"

REM Wait a moment for services to start
timeout /t 3 /nobreak >nul

echo.
echo ======================================
echo  App is running!
echo  Open: http://localhost:3000
echo ======================================
echo.
echo  Backend:  http://localhost:8080
echo  Frontend: http://localhost:3000
echo.
echo  Close the two terminal windows to stop.
echo ======================================
pause
