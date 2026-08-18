@echo off
title Visor 360 - Servidor Local (Brave)
color 0A

echo =========================================================================
echo             INICIANDO SERVIDOR LOCAL PARA VISOR 360
echo =========================================================================
echo.

:: Detectar ruta de Brave Browser
set BRAVE_EXE=
if exist "C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe" set "BRAVE_EXE=C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe"
if exist "C:\Program Files (x86)\BraveSoftware\Brave-Browser\Application\brave.exe" set "BRAVE_EXE=C:\Program Files (x86)\BraveSoftware\Brave-Browser\Application\brave.exe"
if exist "%LOCALAPPDATA%\BraveSoftware\Brave-Browser\Application\brave.exe" set "BRAVE_EXE=%LOCALAPPDATA%\BraveSoftware\Brave-Browser\Application\brave.exe"

where python >nul 2>nul
if %errorlevel% equ 0 (
    echo [*] Iniciando servidor con Python en http://localhost:8080 ...
    if defined BRAVE_EXE (
        echo [*] Abriendo en Brave Browser...
        start "" "%BRAVE_EXE%" http://localhost:8080
    ) else (
        start http://localhost:8080
    )
    python -m http.server 8080
    goto end
)

where npx >nul 2>nul
if %errorlevel% equ 0 (
    echo [*] Iniciando servidor con Node.js / serve ...
    if defined BRAVE_EXE (
        echo [*] Abriendo en Brave Browser...
        start "" "%BRAVE_EXE%" http://localhost:3000
    ) else (
        start http://localhost:3000
    )
    npx serve . -l 3000
    goto end
)

echo [AVISO] Abriendo index.html directamente...
if defined BRAVE_EXE (
    start "" "%BRAVE_EXE%" "%~dp0index.html"
) else (
    start index.html
)

:end
pause
