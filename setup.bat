@echo off
setlocal enabledelayedexpansion

echo ==========================================
echo   Authentic Vintage Warehouse - SETUP
echo ==========================================

set "ROOT_DIR=%~dp0"
cd /d "%ROOT_DIR%"

:: ---------- Prerequisite checks ----------
echo [*] Checking prerequisites on PATH...

where python >nul 2>&1
if errorlevel 1 (
    echo [X] Python is not installed or not on PATH.
    echo     Install Python 3.12+ from https://www.python.org/ then rerun this script.
    pause & exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
    echo [X] Node.js is not installed or not on PATH.
    echo     Install Node.js 20 LTS from https://nodejs.org/ then rerun this script.
    pause & exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
    echo [X] npm is not installed or not on PATH.
    pause & exit /b 1
)

ffmpeg -version >nul 2>&1
if errorlevel 1 (
    echo [*] FFmpeg not found. Attempting auto-install via winget...
    where winget >nul 2>&1
    if errorlevel 1 (
        echo [X] winget is not available on this system.
        echo     Either upgrade to Windows 10 1809+ / Windows 11, or install
        echo     FFmpeg manually from https://www.gyan.dev/ffmpeg/builds/
        pause & exit /b 1
    )
    winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements
    if errorlevel 1 (
        echo [X] winget install failed.
        pause & exit /b 1
    )
    :: winget updates the system PATH but the current cmd.exe session has a
    :: stale copy. Re-check by calling the command; if still missing, ask
    :: the user to reopen the terminal.
    ffmpeg -version >nul 2>&1
    if errorlevel 1 (
        echo.
        echo [!] FFmpeg was installed but is not yet on this shell's PATH.
        echo     Close this window and run setup.bat again from a new terminal.
        pause & exit /b 1
    )
    echo [OK] FFmpeg installed.
)

ffprobe -version >nul 2>&1
if errorlevel 1 (
    echo [X] ffprobe is not on PATH. It ships alongside ffmpeg — the FFmpeg
    echo     install may be incomplete. Close this window and reopen, then retry.
    pause & exit /b 1
)

echo [OK] Prerequisites present.

:: ---------- Nginx (download if missing) ----------
echo [*] Ensuring Nginx is available...
if not exist "nginx-bin\nginx.exe" (
    :: Clean any partial state from a previous failed run before extracting.
    if exist "nginx-bin" rmdir /s /q "nginx-bin" >nul 2>&1
    if exist "nginx-1.26.2" rmdir /s /q "nginx-1.26.2" >nul 2>&1
    if exist "nginx.zip" del /q "nginx.zip" >nul 2>&1

    echo     Downloading Nginx 1.26.2...
    powershell -NoProfile -Command "& { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing 'https://nginx.org/download/nginx-1.26.2.zip' -OutFile 'nginx.zip' }"
    if errorlevel 1 (
        echo [X] Nginx download failed. Check internet connection.
        pause & exit /b 1
    )
    :: Extract, then move to nginx-bin with a retry loop. Windows Defender
    :: often briefly locks the freshly extracted nginx.exe for on-access
    :: scanning, which makes an immediate Move-Item fail.
    powershell -NoProfile -Command "Expand-Archive -Force 'nginx.zip' -DestinationPath '.'"
    if not exist "nginx-1.26.2\nginx.exe" (
        echo [X] Nginx archive did not extract as expected.
        pause & exit /b 1
    )

    :: Robocopy is far more resilient than ren/Move-Item against Defender
    :: briefly locking the freshly-extracted nginx.exe. /MOVE deletes the
    :: source folder on success. Exit codes 0-7 are success variants.
    robocopy "nginx-1.26.2" "nginx-bin" /E /MOVE /R:10 /W:2 /NFL /NDL /NJH /NJS >nul
    if errorlevel 8 (
        echo [X] robocopy failed to move nginx-1.26.2 to nginx-bin.
        pause & exit /b 1
    )
    if not exist "nginx-bin\nginx.exe" (
        echo [X] Nginx did not land in nginx-bin\.
        pause & exit /b 1
    )
    del "nginx.zip" >nul 2>&1
    echo [OK] Nginx installed to nginx-bin\
) else (
    echo [OK] Nginx already present in nginx-bin\
)

if not exist "nginx-bin\logs" mkdir "nginx-bin\logs"
if not exist "nginx-bin\temp" mkdir "nginx-bin\temp"

:: ---------- Backend (Python venv) ----------
echo [*] Setting up backend virtualenv...
cd /d "%ROOT_DIR%backend"
if not exist ".venv\Scripts\python.exe" (
    python -m venv .venv
    if errorlevel 1 (
        echo [X] Failed to create Python venv.
        pause & exit /b 1
    )
)

echo [*] Installing Python dependencies (this can take a minute)...
call ".venv\Scripts\activate.bat"
python -m pip install --upgrade pip >nul
pip install -r requirements.txt
if errorlevel 1 (
    echo [X] pip install failed.
    pause & exit /b 1
)

if not exist "uploads" mkdir "uploads"
if not exist "data" mkdir "data"

cd /d "%ROOT_DIR%"
echo [OK] Backend ready.

:: ---------- Frontend (build for production) ----------
echo [*] Installing frontend dependencies...
cd /d "%ROOT_DIR%frontend"

if exist "package-lock.json" (
    call npm ci
) else (
    call npm install
)
if errorlevel 1 (
    echo [X] npm install failed.
    pause & exit /b 1
)

echo [*] Building frontend for production (optimized for low-memory server)...
call npm run build
if errorlevel 1 (
    echo [X] npm run build failed.
    pause & exit /b 1
)

:: The Next.js standalone output needs the static + public folders copied
:: alongside the server.js to be fully self-contained.
echo [*] Staging standalone server...
if exist ".next\standalone" (
    if not exist ".next\standalone\.next\static" mkdir ".next\standalone\.next\static" >nul 2>&1
    xcopy /E /Y /I /Q ".next\static" ".next\standalone\.next\static" >nul
    if exist "public" xcopy /E /Y /I /Q "public" ".next\standalone\public" >nul
) else (
    echo [X] .next\standalone was not produced. Check next.config.mjs has output: "standalone".
    pause & exit /b 1
)

cd /d "%ROOT_DIR%"

echo.
echo ==========================================
echo   Setup completed successfully.
echo ==========================================
echo.
echo   Next step:  run.bat
echo   App URL:    http://localhost:8082
echo.
echo   To rebuild after code changes, just re-run setup.bat.
echo.
pause
endlocal
