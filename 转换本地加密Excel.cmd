@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\convert-local-encrypted-excel-dialog.ps1"
if errorlevel 1 pause
