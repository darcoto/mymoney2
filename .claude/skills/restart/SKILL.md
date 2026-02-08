---
name: restart
description: Спира и рестартира Node.js сървъра на порт 3000
disable-model-invocation: true
allowed-tools: Bash(taskkill:*), Bash(npm *), Bash(timeout:*), Bash(cmd:*)
---

Рестартирай сървъра:

1. Спри всички Node.js процеси: `taskkill /F /IM node.exe 2>nul`
2. Изчакай 2 секунди: `timeout /t 2 /nobreak >nul`
3. Стартирай сървъра: `npm start`

Изпълни стъпките последователно. Ако taskkill не намери процеси, това е нормално - продължи напред.
