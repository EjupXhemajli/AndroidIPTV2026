@echo off
setlocal enabledelayedexpansion
title EX-IPTV Desktop - Installation
color 0B

echo ================================================
echo   EX-IPTV Desktop - Installation
echo ================================================
echo.

REM ---------------------------------------------------------------
REM Schritt 1: Pruefen ob .NET 8 SDK installiert ist
REM ---------------------------------------------------------------
where dotnet >nul 2>nul
if %errorlevel% neq 0 goto :need_dotnet

for /f "tokens=1 delims=." %%v in ('dotnet --version 2^>nul') do set DOTNET_MAJOR=%%v
if "%DOTNET_MAJOR%"=="" goto :need_dotnet
if %DOTNET_MAJOR% lss 8 goto :need_dotnet

echo [OK] .NET SDK gefunden.
goto :build

:need_dotnet
echo [FEHLT] .NET 8 SDK ist nicht installiert.
echo.
echo Ich oeffne jetzt die offizielle Microsoft-Downloadseite.
echo Bitte lade dort den "SDK x64 Installer" fuer Windows herunter,
echo installiere ihn ganz normal (Weiter, Weiter, Fertig), und starte
echo diese Datei danach einfach noch einmal per Doppelklick.
echo.
pause
start https://dotnet.microsoft.com/download/dotnet/8.0
exit /b 1

REM ---------------------------------------------------------------
REM Schritt 2: App bauen (self-contained, eine einzelne exe-Datei)
REM ---------------------------------------------------------------
:build
echo.
echo [1/3] Pakete werden heruntergeladen (kann beim ersten Mal einige Minuten dauern)...
dotnet restore "%~dp0src\ExIptvDesktop.csproj"
if %errorlevel% neq 0 goto :build_failed

echo.
echo [2/3] Anwendung wird gebaut...
dotnet publish "%~dp0src\ExIptvDesktop.csproj" ^
    -c Release -r win-x64 --self-contained true ^
    -p:PublishSingleFile=true ^
    -p:IncludeNativeLibrariesForSelfExtract=true ^
    -o "%~dp0publish"

if %errorlevel% neq 0 goto :build_failed

REM ---------------------------------------------------------------
REM Schritt 3: Desktop-Verknuepfung anlegen
REM ---------------------------------------------------------------
echo.
echo [3/3] Verknuepfung wird auf dem Desktop angelegt...

powershell -NoProfile -Command ^
    "$WshShell = New-Object -ComObject WScript.Shell; " ^
    "$Shortcut = $WshShell.CreateShortcut([System.IO.Path]::Combine([Environment]::GetFolderPath('Desktop'), 'EX-IPTV Desktop.lnk')); " ^
    "$Shortcut.TargetPath = '%~dp0publish\ExIptvDesktop.exe'; " ^
    "$Shortcut.WorkingDirectory = '%~dp0publish'; " ^
    "$Shortcut.IconLocation = '%~dp0publish\ExIptvDesktop.exe'; " ^
    "$Shortcut.Save()"

echo.
echo ================================================
echo   Fertig! Auf deinem Desktop liegt jetzt
echo   die Verknuepfung "EX-IPTV Desktop".
echo   Einfach doppelklicken zum Starten.
echo ================================================
echo.
pause
exit /b 0

:build_failed
echo.
echo ================================================
echo   Beim Bauen ist ein Fehler aufgetreten.
echo   Bitte den Text oben durchlesen oder mir
echo   einen Screenshot davon schicken.
echo ================================================
echo.
pause
exit /b 1
