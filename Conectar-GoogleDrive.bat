@echo off
chcp 65001 >nul
title Conectar Google Drive
echo ====================================================
echo    A AUTORIZAR GOOGLE DRIVE NO SEU NAVEGADOR...
echo ====================================================
echo O seu navegador ira abrir a pagina de login da Google.
echo Inicie sessao e clique em "Permitir / Continuar".
echo.
"C:\Users\cac_7\OneDrive\Área de Trabalho\gravi\bin\rclone.exe" config create gdrive drive scope drive.readonly --config "C:\Users\cac_7\OneDrive\Área de Trabalho\gravi\data\rclone.conf"
echo.
echo Concluido com sucesso! Pode fechar esta janela.
pause
