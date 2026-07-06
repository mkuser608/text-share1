@echo off
REM Launches the PowerShell installer with Administrator rights (UAC prompt).
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -Verb RunAs -FilePath powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','\"%~dp0setup-windows.ps1\"'"
