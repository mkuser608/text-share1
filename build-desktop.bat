@echo off
title Build ShareHub Desktop
setlocal
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"

echo === Checking Rust ===
cargo --version || (echo. & echo Rust not found. Run install-rust.bat first, then reopen this. & pause & exit /b 1)

cd /d "%~dp0desktop"

echo.
echo === Installing app dependencies (npm) ===
call npm install || (echo npm install failed & pause & exit /b 1)

echo.
echo === Generating app icons ===
call npx --yes @tauri-apps/cli icon "%~dp0desktop\icon-source.png"

echo === Writing config from .env ===
call node "%~dp0desktop\gen-config.mjs"

echo.
echo === Launching ShareHub Desktop (first build compiles Rust, be patient) ===
call npm run tauri dev

pause
