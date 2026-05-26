@echo off
setlocal
cd /d "%~dp0"

echo.
echo  duo - dev launcher
echo  ------------------
echo.

:: ── Prerequisites ────────────────────────────────────────────────────────────

where node  >nul 2>&1 || (echo [ERROR] Node.js not found  ^(https://nodejs.org^)        & pause & exit /b 1)
where ngrok >nul 2>&1 || (echo [ERROR] ngrok not found    ^(https://ngrok.com/download^) & pause & exit /b 1)

:: ── Secrets ──────────────────────────────────────────────────────────────────
:: .env.bat contains "@set KEY=VALUE" lines — generated once, reused every run.

if not exist .env.bat (
    echo [duo] First run - generating pair secrets...
    node -e "const c=require('crypto'),fs=require('fs');const kv=(k,v)=>[k,v];const pairs=[kv('PAIR_SECRET_A',c.randomBytes(32).toString('base64url')),kv('PAIR_SECRET_B',c.randomBytes(32).toString('base64url')),kv('TURN_STATIC_AUTH_SECRET',c.randomBytes(32).toString('base64url')),kv('PUBLIC_TURN_HOST','localhost'),kv('PUBLIC_TURN_PORT','3478'),kv('TURNS_TLS_PORT','5349'),kv('PORT','8080')];fs.writeFileSync('.env.bat',pairs.map(([k,v])=>'@set '+k+'='+v).join('\r\n'));fs.writeFileSync('.env',pairs.map(([k,v])=>k+'='+v).join('\r\n'));console.log('[duo] secrets written.');"
    if %errorlevel% neq 0 (echo [ERROR] Secret generation failed & pause & exit /b 1)
)

call .env.bat

:: ── Dependencies ─────────────────────────────────────────────────────────────

if not exist server\node_modules (
    echo [duo] Installing server dependencies...
    cd server && call npm install && cd ..
    if %errorlevel% neq 0 (echo [ERROR] npm install failed in server/ & pause & exit /b 1)
)

if not exist client\node_modules (
    echo [duo] Installing client dependencies...
    cd client && call npm install && cd ..
    if %errorlevel% neq 0 (echo [ERROR] npm install failed in client/ & pause & exit /b 1)
)

:: ── Build ────────────────────────────────────────────────────────────────────

echo [duo] Building client...
cd client
call npm run build
cd ..
if %errorlevel% neq 0 (echo [ERROR] Client build failed & pause & exit /b 1)

:: ── Launch server ────────────────────────────────────────────────────────────

start "duo - server :8080" /d "%~dp0server" cmd /k "npm run dev"
echo [duo] Server starting on :8080...
timeout /t 3 /nobreak >nul

:: ── Launch ngrok and wait for tunnel URL ─────────────────────────────────────

start "duo - ngrok" cmd /k "ngrok http 8080"
echo [duo] Waiting for ngrok tunnel...

:: Clean up any leftover temp file from a previous interrupted run
if exist .ngrok_url.tmp del .ngrok_url.tmp

:wait_ngrok
timeout /t 1 /nobreak >nul
powershell -NoProfile -NonInteractive -Command ^
    "try { $t = (Invoke-WebRequest 'http://127.0.0.1:4040/api/tunnels' -UseBasicParsing -ErrorAction Stop | ConvertFrom-Json).tunnels | Where-Object { $_.proto -eq 'https' } | Select-Object -First 1; if ($t) { [System.IO.File]::WriteAllText('.ngrok_url.tmp', $t.public_url) } } catch {}" ^
    >nul 2>&1
if not exist .ngrok_url.tmp goto wait_ngrok

set /p NGROK_URL=<.ngrok_url.tmp
del .ngrok_url.tmp

if "%NGROK_URL%"=="" goto wait_ngrok

:: ── Print ready links ────────────────────────────────────────────────────────

echo.
echo  +-----------------------------------------------------------------+
echo   Ready! Open each link on the matching device:
echo  +-----------------------------------------------------------------+
echo   This PC : %NGROK_URL%/#k=%PAIR_SECRET_A%
echo   Mobile  : %NGROK_URL%/#k=%PAIR_SECRET_B%
echo  +-----------------------------------------------------------------+
echo.
echo  Keys are saved in .env.bat and reused on every future run.
echo  Tip: http://127.0.0.1:4040 shows the ngrok dashboard.
echo.
pause
