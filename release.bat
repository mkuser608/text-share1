@echo off
title Push + release ShareHub
cd /d "%~dp0"
del .git\index.lock 2>nul

echo === Pushing code to a fresh branch: deploy ===
git push origin revamp:deploy || (echo Push failed. & pause & exit /b 1)

echo.
echo === Tagging + pushing v1.0.0 (this triggers the installer build) ===
git tag -f v1.0.0
git push -f origin v1.0.0

echo.
echo Done!
echo   Build progress:  https://github.com/mkuser608/text-share1/actions
echo   Installers:      https://github.com/mkuser608/text-share1/releases
pause
