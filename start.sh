#!/bin/bash

echo "Стартиране на сървъра..."
echo "Браузърът ще се отвори автоматично след няколко секунди."
echo "Натиснете Ctrl+C за спиране."
echo

# Open browser after 3 seconds in background
(sleep 3 && xdg-open http://localhost:3000 2>/dev/null || open http://localhost:3000 2>/dev/null) &

node backend/server.js
