@echo off
title Package ShareHub Desktop (installer)
setlocal
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
cargo --version || (echo Rust not found. Run install-rust.bat first. & pause & exit /b 1)
cd /d "%~dp0desktop"

echo === Ensuring deps + icons ===
call npm install
call npx --yes @tauri-apps/cli icon "%~dp0desktop\icon-source.png"

echo === Writing config from .env ===
call node "%~dp0desktop\gen-config.mjs"

echo.
echo === Building RELEASE installer (this takes several minutes) ===
call npm run tauri build || (echo build failed & pause & exit /b 1)

echo.
echo === Copying installer to desktop\installers so the web app can serve it ===
if not exist "%~dp0desktop\installers" mkdir "%~dp0desktop\installers"
for /r "%~dp0desktop\src-tauri\target\release\bundle" %%f in (*.exe *.msi) do copy /y "%%f" "%~dp0desktop\installers\" >nul
echo.
echo Done. Installer(s):
dir /b "%~dp0desktop\installers"
echo.
echo Run the .exe to install ShareHub Desktop.
pause
