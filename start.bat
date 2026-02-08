@echo off
chcp 65001 >nul
title MyMoney2

echo Стартиране на сървъра...
echo Браузърът ще се отвори автоматично след няколко секунди.
echo Натиснете Ctrl+C за спиране.
echo.

start /b cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:3000"
node backend/server.js
