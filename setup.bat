@echo off
REM ============================================================
REM  Authentic Vintage Warehouse — Windows Setup (no Docker)
REM  Run this once to install all dependencies.
REM  Prerequisites: Python 3.12+, Node.js 20+, nginx, ffmpeg
REM ============================================================

echo.
echo ======================================
echo  Checking prerequisites...
echo ======================================

where python >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python not found. Install Python 3.12+ and add to PATH.
    pause
    exit /b 1
)

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found. Install Node.js 20+ and add to PATH.
    pause
    exit /b 1
)

where nginx >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] nginx not found in PATH.
    echo         Download from https://nginx.org/en/download.html
    echo         Extract and add the folder to your system PATH.
    pause
    exit /b 1
)

where ffmpeg >nul 2>&1
if %errorlevel% neq 0 (
    echo [WARNING] ffmpeg not found in PATH. Server-side video compression will not work.
    echo          Download from https://ffmpeg.org/download.html and add to PATH.
    echo.
)

echo.
echo ======================================
echo  Setting up backend...
echo ======================================

cd /d "%~dp0backend"

if not exist "venv" (
    echo Creating Python virtual environment...
    python -m venv venv
)

echo Installing Python dependencies...
call venv\Scripts\activate.bat
pip install --quiet -r requirements.txt
call deactivate

REM Create data and uploads directories
if not exist "data" mkdir data
if not exist "uploads" mkdir uploads

echo Backend setup complete.

echo.
echo ======================================
echo  Setting up frontend...
echo ======================================

cd /d "%~dp0frontend"

echo Installing Node.js dependencies...
call npm ci

echo Building frontend...
call npm run build

echo Frontend setup complete.

echo.
echo ======================================
echo  Setup complete!
echo  Run "run.bat" to start the application.
echo ======================================
pause
