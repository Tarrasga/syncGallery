@echo off
chcp 65001 >nul
title syncGallery - Central de Fotos e Vídeos
cls

echo ===================================================================
echo             📸 syncGallery - CENTRAL DE FOTOS E VÍDEOS
echo      Google Drive, Microsoft OneDrive, Pen Drives e Discos
echo ===================================================================
echo.
echo  A verificar dependências do sistema...

where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERRO] O Node.js não foi encontrado no sistema.
    echo Por favor instale o Node.js através de: https://nodejs.org
    echo.
    pause
    exit /b 1
)

echo  [OK] Node.js detectado com sucesso!
echo.
echo  A iniciar o servidor syncGallery na porta 3344...
echo  O painel web irá abrir automaticamente no seu navegador.
echo.
echo ===================================================================
echo  Endereço da aplicação: http://localhost:3344
echo  (Para parar a aplicação, basta fechar esta janela)
echo ===================================================================
echo.

start "" "http://localhost:3344"
node server\server.js

pause
