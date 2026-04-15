@echo off
setlocal
set "ROOT_DIR=%~dp0"
cd /d "%ROOT_DIR%"

echo [*] Stopping nginx...
if exist "nginx-bin\nginx.exe" (
    pushd "nginx-bin"
    nginx.exe -s stop >nul 2>&1
    popd
)

echo [*] Stopping backend (uvicorn) on port 8080...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":8080 .*LISTENING"') do taskkill /F /PID %%P >nul 2>&1

echo [*] Stopping frontend (next) on port 3000...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":3000 .*LISTENING"') do taskkill /F /PID %%P >nul 2>&1

echo [OK] All services stopped.
endlocal
