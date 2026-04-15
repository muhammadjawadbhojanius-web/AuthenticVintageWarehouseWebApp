@echo off
setlocal enabledelayedexpansion

echo ==========================================
echo   Authentic Vintage Warehouse - RUN
echo ==========================================

set "ROOT_DIR=%~dp0"
cd /d "%ROOT_DIR%"

:: ---------- Pre-flight checks ----------
if not exist "backend\.venv\Scripts\python.exe" (
    echo [X] Backend venv missing. Run setup.bat first.
    pause & exit /b 1
)
if not exist "frontend\.next\standalone\server.js" (
    echo [X] Frontend build missing. Run setup.bat first.
    pause & exit /b 1
)
if not exist "nginx-bin\nginx.exe" (
    echo [X] Nginx missing. Run setup.bat first.
    pause & exit /b 1
)
if not exist "nginx\windows.conf" (
    echo [X] nginx\windows.conf missing. The nginx reverse-proxy config isn't in the repo.
    pause & exit /b 1
)

:: ---------- Copy nginx config ----------
echo [*] Staging nginx config...
copy /Y "nginx\windows.conf" "nginx-bin\conf\nginx.conf" >nul
if errorlevel 1 (
    echo [X] Failed to copy nginx config.
    pause & exit /b 1
)

:: ---------- Stop any previous nginx instance ----------
:: Only nginx.exe running from nginx-bin\ — avoid killing unrelated installs.
echo [*] Stopping any previous nginx instance from this project...
pushd "nginx-bin"
nginx.exe -s stop >nul 2>&1
popd
timeout /t 1 /nobreak >nul

:: ---------- Start Backend ----------
echo [*] Starting Backend (FastAPI) on port 8080...
start "Authentic Backend" cmd /k "cd /d %ROOT_DIR%backend && call .venv\Scripts\activate.bat && uvicorn app.main:app --host 0.0.0.0 --port 8080"

:: ---------- Start Frontend (Next.js standalone) ----------
echo [*] Starting Frontend (Next.js) on port 3000...
start "Authentic Frontend" cmd /k "cd /d %ROOT_DIR%frontend\.next\standalone && set HOSTNAME=0.0.0.0&& set PORT=3000&& set NODE_ENV=production&& node server.js"

:: Give both services a moment before nginx probes them.
timeout /t 3 /nobreak >nul

:: ---------- Start Nginx ----------
echo [*] Starting Nginx on port 8082...
pushd "nginx-bin"
start "" nginx.exe
popd

:: Verify nginx is actually listening.
timeout /t 2 /nobreak >nul
netstat -an | findstr /R /C:":8082 .*LISTENING" >nul
if errorlevel 1 (
    echo [!] WARNING: nginx does not appear to be listening on 8082.
    echo     Check nginx-bin\logs\error.log for details.
) else (
    echo [OK] Nginx is listening on 8082.
)

:: ---------- Print access info ----------
echo.
echo ==========================================
echo   SERVER STARTED
echo ==========================================
echo.
echo   Local:    http://localhost:8082
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /C:"IPv4 Address"') do (
    set "IP=%%a"
    set "IP=!IP:~1!"
    echo   Network:  http://!IP!:8082
)
echo.
echo   API docs: http://localhost:8082/api/docs
echo.
echo   Windows Firewall must allow inbound TCP 8082 for LAN access.
echo   To stop: run stop.bat (or close the two spawned windows and
echo   run "nginx-bin\nginx.exe -s stop").
echo.
pause
endlocal
