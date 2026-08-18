@echo off
setlocal enabledelayedexpansion
title Publicar Visor 360 en GitHub Pages
color 0B

echo =========================================================================
echo       SUBIDOR AUTOMATICO A GITHUB Y GITHUB PAGES - VISOR 360
echo =========================================================================
echo.

:: Detectar y agregar Git al PATH si no esta cargado en Explorer
where git >nul 2>nul
if %errorlevel% neq 0 (
    if exist "C:\PROGRAMAS C\Git\cmd" set "PATH=%PATH%;C:\PROGRAMAS C\Git\cmd"
    if exist "C:\Program Files\Git\cmd" set "PATH=%PATH%;C:\Program Files\Git\cmd"
    if exist "C:\Program Files (x86)\Git\cmd" set "PATH=%PATH%;C:\Program Files (x86)\Git\cmd"
    if exist "%LOCALAPPDATA%\Programs\Git\cmd" set "PATH=%PATH%;%LOCALAPPDATA%\Programs\Git\cmd"
)

:: 1. Verificar si Git esta instalado
where git >nul 2>nul
if %errorlevel% neq 0 (
    color 0C
    echo [ERROR] Git no esta instalado o no se encuentra en el PATH.
    echo Por favor instala Git desde https://git-scm.com/ e intentalo de nuevo.
    echo.
    pause
    exit /b 1
)

:: 2. Configurar directorio seguro
git config --global --add safe.directory "%~dp0" >nul 2>nul
git config --global --add safe.directory "%CD%" >nul 2>nul

:: 3. Inicializar repositorio Git si no existe
if not exist ".git" (
    echo [*] Inicializando repositorio Git local...
    git init
    git branch -M main
) else (
    echo [*] Repositorio Git local detectado.
)

:: 4. Verificar o pedir la URL remota de GitHub
set REMOTE_URL=
for /f "tokens=2" %%i in ('git remote get-url origin 2^>nul') do set REMOTE_URL=%%i

if "%REMOTE_URL%"=="" (
    echo.
    echo -------------------------------------------------------------------------
    echo INSTRUCCIONES:
    echo 1. Crea un repositorio publico nuevo y vacio en: https://github.com/new
    echo 2. Copia la URL de tu repositorio (HTTPS o SSH)
    echo    Ejemplo: https://github.com/TU-USUARIO/visor-experiencia-360.git
    echo -------------------------------------------------------------------------
    echo.
    set /p REPO_URL="Pega aqui la URL de tu repositorio de GitHub: "
    
    if "%REPO_URL%"=="" (
        color 0C
        echo [ERROR] No ingresaste ninguna URL. Abortando.
        pause
        exit /b 1
    )
    
    git remote remove origin 2>nul
    git remote add origin %REPO_URL%
) else (
    echo [*] Remoto configurado actualmente: %REMOTE_URL%
    echo.
    set /p RESP="Quieres cambiar de repositorio? (S/N) [N]: "
    if /i "!RESP!"=="S" (
        set /p REPO_URL="Pega la nueva URL de tu repositorio de GitHub: "
        git remote remove origin 2>nul
        git remote add origin !REPO_URL!
    )
)

echo.
echo [*] Agregando archivos al commit...
git add .

echo [*] Creando commit...
git commit -m "Publicacion Visor 360 con video Paisajes andinos, Elian" 2>nul

echo [*] Subiendo a la rama main en GitHub...
git push -u origin main

if %errorlevel% neq 0 (
    echo.
    color 0C
    echo [AVISO] Si es la primera vez que subes o hubo rechazo, forzando actualizacion...
    git push -u origin main --force
)

if %errorlevel% neq 0 (
    echo.
    color 0C
    echo [ERROR] No se pudo subir el repositorio a GitHub.
    echo Revisa tus permisos o conexion y vuelve a intentarlo.
    echo.
    pause
    exit /b 1
)

color 0A
echo.
echo =========================================================================
echo       SUBIDA EXITOSA A GITHUB! AHORA ACTIVEMOS GITHUB PAGES
echo =========================================================================
echo.
echo Para que tu pagina sea PUBLICA y VISITABLE en internet:
echo.
echo 1. Abre tu repositorio en GitHub desde el navegador.
echo 2. Ve a: Settings (Pestana superior de Configuracion) ^> Pages (menu izquierdo).
echo 3. En "Build and deployment":
echo      - Source: Deploy from a branch
echo      - Branch: Selecciona 'main' y carpeta '/ (root)'
echo      - Clic en el boton "Save" (Guardar)
echo.
echo 4. En 1-2 minutos tu visor estara disponible en:
echo    https://TU-USUARIO.github.io/NOMBRE-REPOSITORIO/
echo.
echo =========================================================================
pause
