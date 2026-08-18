@echo off
chcp 65001 >nul
title Visor 360 - Servidor Local
color 0A

echo =========================================================================
echo             INICIANDO SERVIDOR LOCAL PARA VISOR 360
echo =========================================================================
echo.

where python >nul 2>nul
if %errorlevel% equ 0 (
    echo [*] Iniciando servidor con Python en http://localhost:8080 ...
    start http://localhost:8080
    python -m http.server 8080
    goto end
)

where npx >nul 2>nul
if %errorlevel% equ 0 (
    echo [*] Iniciando servidor con Node.js / serve ...
    start http://localhost:3000
    npx serve . -l 3000
    goto end
)

echo [AVISO] Ni Python ni Node.js estan instalados. Abriendo index.html directamente...
start index.html

:end
pause
