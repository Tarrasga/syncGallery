@echo off
title syncGallery - Central de Fotos e Videos
cls

echo ===================================================================
echo             syncGallery - CENTRAL DE FOTOS E VIDEOS
echo      Google Drive, Microsoft OneDrive, Pen Drives e Discos
echo ===================================================================
echo.
echo  A verificar dependencias do sistema...

where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERRO] O Node.js nao foi encontrado no sistema.
    echo Por favor instale o Node.js atraves de: https://nodejs.org
    echo.
    pause
    exit /b 1
)

echo  [OK] Node.js detectado com sucesso!
echo.
echo  A iniciar o servidor syncGallery na porta 3344...
echo  O painel web ira abrir automaticamente no seu navegador.
echo.
echo ===================================================================
echo  Endereco da aplicacao: http://localhost:3344
echo  (Para parar a aplicacao, basta fechar esta janela)
echo ===================================================================
echo.

start "" "http://localhost:3344"
node server\server.js

pause
