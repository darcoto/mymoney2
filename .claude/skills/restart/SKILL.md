---
name: restart
description: Спира и рестартира Node.js сървъра на приложението (порт от .env, по подразбиране 3456)
disable-model-invocation: true
allowed-tools: Bash(netstat:*), Bash(taskkill:*), Bash(npm *), Bash(grep:*), Bash(curl:*)
---

Рестартирай сървъра:

1. Определи порта: `PORT` от `.env`, ако липсва — 3456.
2. Намери процеса, който слуша на порта: `netstat -ano | grep ":<порт> .*LISTEN"` (PID е последната колона).
3. Спри **само този** процес: `taskkill //PID <pid> //F`. Не спирай всички `node.exe` — така падат и други Node процеси (напр. MCP сървърите на Claude Code). Ако няма процес на порта, продължи.
4. Стартирай сървъра във фонов режим: `npm start` (с `run_in_background`).
5. Провери, че отговаря: `curl -s -o /dev/null -w "%{http_code}" http://localhost:<порт>/` трябва да върне 200.
