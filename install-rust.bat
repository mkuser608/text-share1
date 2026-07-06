@echo off
title Installing Rust for ShareHub Desktop
echo Downloading and installing Rust (no admin needed)...
echo This takes a couple of minutes. Please wait.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $r=\"$env:TEMP\rustup-init.exe\"; Invoke-WebRequest 'https://win.rustup.rs/x86_64' -OutFile $r; Start-Process -Wait $r -ArgumentList '-y','--default-toolchain','stable-msvc','--profile','default'"
echo.
echo ============================================
echo  Rust installed. Verifying...
echo ============================================
"%USERPROFILE%\.cargo\bin\cargo.exe" --version
echo.
echo Done. You can close this window.
pause
