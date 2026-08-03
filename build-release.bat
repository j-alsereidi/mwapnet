@echo off
setlocal
cd /d "%~dp0"

set DESKTOP_OK=1

echo ==========================================
echo  Building desktop app (Tauri)
echo ==========================================
call npx tauri build
if errorlevel 1 (
  echo.
  echo [WARNING] Desktop build failed - continuing to the Android build anyway.
  set DESKTOP_OK=0
)

echo.
echo ==========================================
echo  Building web assets for Capacitor
echo ==========================================
cd client
call npm run build:capacitor
if errorlevel 1 goto :fail
cd ..

echo.
echo ==========================================
echo  Syncing Capacitor Android project
echo ==========================================
cd capacitor
call npx cap sync android
if errorlevel 1 goto :fail

echo.
echo ==========================================
echo  Building Android APK
echo ==========================================
cd android
call .\gradlew.bat assembleDebug
if errorlevel 1 goto :fail
cd ..\..

echo.
echo ==========================================
if "%DESKTOP_OK%"=="1" (
  echo  BUILD SUCCESSFUL
  echo  Desktop exe:  src-tauri\target\release\app.exe
) else (
  echo  ANDROID BUILD SUCCESSFUL - desktop build FAILED, see warning above
)
echo  Android APK:  capacitor\android\app\build\outputs\apk\debug\app-debug.apk
echo ==========================================
goto :end

:fail
echo.
echo ==========================================
echo  BUILD FAILED - scroll up for the error
echo ==========================================

:end
cmd /k
