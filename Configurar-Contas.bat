@echo off
chcp 65001 >nul
title Assistente de Configuracao de Contas - Cloud Photo Backup
cls

:MENU
echo ===================================================================
echo       ASSISTENTE DE CONFIGURACAO DE CONTAS NA NUVEM
echo ===================================================================
echo.
echo  1. Conectar ou autorizar Google Drive
echo  2. Conectar ou verificar Microsoft OneDrive
echo  3. Testar ligacao as nuvens configuradas
echo  4. Abrir pasta de configuracoes
echo  5. Sair
echo.
set /p opt="Escolha uma opcao (1-5): "

if "%opt%"=="1" goto GDRIVE
if "%opt%"=="2" goto ONEDRIVE
if "%opt%"=="3" goto TESTAR
if "%opt%"=="4" goto PASTA
if "%opt%"=="5" goto FIM
goto MENU

:GDRIVE
echo.
echo -------------------------------------------------------------------
echo  A AUTORIZAR GOOGLE DRIVE...
echo -------------------------------------------------------------------
echo  O seu navegador ira abrir com a pagina de login da Google.
echo  Inicie sessao na sua conta e confirme a permissao de leitura.
echo.
bin\rclone.exe config create gdrive drive scope drive.readonly --config data\rclone.conf
echo.
echo Operacao concluida!
pause
goto MENU

:ONEDRIVE
echo.
echo -------------------------------------------------------------------
echo  A VERIFICAR / CONFIGURAR MICROSOFT ONEDRIVE...
echo -------------------------------------------------------------------
node server\setup-onedrive.js
echo.
pause
goto MENU

:TESTAR
echo.
echo -------------------------------------------------------------------
echo  A TESTAR NUVENS CONFIGURADAS...
echo -------------------------------------------------------------------
echo  Remotos detetados:
bin\rclone.exe listremotes --config data\rclone.conf
echo.
echo  [1/2] A listar fotos no Google Drive...
bin\rclone.exe lsf gdrive: --max-depth 1 --config data\rclone.conf
echo.
echo  [2/2] A listar pastas no Microsoft OneDrive...
bin\rclone.exe lsf onedrive: --max-depth 1 --exclude "/Personal Vault/**" --config data\rclone.conf
echo.
pause
goto MENU

:PASTA
start "" "data"
goto MENU

:FIM
exit
