# 🤖 NFTG Channel Bot - Быстрый старт

## 📦 ФАЙЛЫ В ЭТОЙ ПАПКЕ:

```
✅ server-FIXED.js      → переименуй в server.js
✅ interactive-bot.js   → готов
✅ start.js             → готов
✅ package.json         → готов
✅ .env.example         → скопируй в .env
✅ .gitignore          → готов
```

## 🚀 БЫСТРЫЙ СТАРТ:

### 1. Переименуй файл:
```bash
mv server-FIXED.js server.js
```

### 2. Создай .env:
```bash
cp .env.example .env
```

Отредактируй `.env`:
```env
BOT_TOKEN=твой_токен_от_BotFather
BOT_API_KEY=random_key_123
```

### 3. Создай бота:
```
Telegram → @BotFather → /newbot
Скопируй токен в .env
```

### 4. Залей на GitHub:
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/username/nftg-channel-bot.git
git push -u origin main
```

### 5. Разверни на Railway:
```
1. railway.app → Deploy from GitHub
2. + New → Add PostgreSQL
3. Postgres → Connect → твой-сервис
4. Variables: BOT_TOKEN, BOT_API_KEY, API_URL=http://localhost:3000/api
5. Start Command: node start.js
```

## 📖 Полная инструкция:
Смотри `COMPLETE_GUIDE_FROM_SCRATCH.md`

🚀 Готов к запуску!
