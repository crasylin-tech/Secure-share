# SecureShare — Инструкция по развёртыванию

## Структура проекта
```
secureshare/
├── backend/          ← Node.js + Express API
│   ├── server.js
│   ├── db.js
│   ├── schema.sql
│   ├── routes/
│   │   ├── auth.js
│   │   ├── org.js
│   │   ├── chats.js
│   │   └── orgFiles.js
│   ├── middleware/
│   │   └── auth.js
│   ├── uploads/      ← создаётся автоматически
│   ├── .env.example
│   └── package.json
└── frontend/
    └── index.html    ← GitHub Pages
```

---

## Шаг 1 — Развернуть бэкенд на Railway

1. Зарегистрируйтесь на [railway.app](https://railway.app)
2. Создайте новый проект → **Deploy from GitHub repo**
3. Укажите папку `backend/` как корень сервиса (или загрузите только её содержимое)
4. Добавьте сервис **PostgreSQL**: New → Database → PostgreSQL
5. Railway автоматически добавит переменную `DATABASE_URL` в окружение

### Переменные окружения (Settings → Variables)
```
JWT_SECRET=ваш_длинный_случайный_секрет_минимум_32_символа
FRONTEND_URL=https://ваш-логин.github.io
NODE_ENV=production
PORT=3000
```

6. После деплоя скопируйте URL вашего сервиса, например:
   `https://secureshare-production.up.railway.app`

---

## Шаг 2 — Инициализировать базу данных

Railway предоставляет доступ к PostgreSQL через веб-консоль или внешний клиент.

### Через Railway Query Console:
1. Откройте сервис PostgreSQL → вкладка **Query**
2. Скопируйте и выполните содержимое файла `backend/schema.sql`

### Через psql (локально):
```bash
psql "postgresql://..." -f backend/schema.sql
```
*(строку подключения найдёте в Railway: PostgreSQL → Connect)*

---

## Шаг 3 — Настроить фронтенд

Откройте `frontend/index.html` и замените строку:
```javascript
const API_BASE = 'https://your-backend.railway.app';
```
на ваш реальный URL с Railway:
```javascript
const API_BASE = 'https://secureshare-production.up.railway.app';
```

---

## Шаг 4 — Опубликовать фронтенд на GitHub Pages

1. Создайте репозиторий на GitHub, например `secureshare`
2. Поместите `frontend/index.html` в корень репозитория, **переименуйте в `index.html`**
3. Откройте Settings → Pages → Source: `main` branch → `/` (root)
4. Через 1–2 минуты сайт будет доступен по адресу:
   `https://ваш-логин.github.io/secureshare`

---

## Локальная разработка

### Бэкенд
```bash
# Установите PostgreSQL локально или используйте Docker:
# docker run -e POSTGRES_PASSWORD=pass -p 5432:5432 postgres

cd backend
cp .env.example .env
# Отредактируйте .env: укажите DATABASE_URL, JWT_SECRET, FRONTEND_URL

npm install
# Выполните schema.sql один раз:
psql -U postgres -c "CREATE DATABASE secureshare;"
psql -U postgres -d secureshare -f schema.sql

npm start
# API доступен на http://localhost:3000
```

### Фронтенд
```bash
# Используйте любой статический сервер, например VS Code Live Server
# или:
npx serve frontend/
# Откройте http://localhost:5500
```

В `frontend/index.html` для локальной разработки установите:
```javascript
const API_BASE = 'http://localhost:3000';
```

---

## Альтернатива Railway — Render.com

1. Зарегистрируйтесь на [render.com](https://render.com)
2. New → Web Service → подключите GitHub репо, укажите папку `backend/`
3. Build Command: `npm install`
4. Start Command: `node server.js`
5. New → PostgreSQL → получите `DATABASE_URL`
6. Добавьте переменные окружения аналогично Railway

---

## Ограничения бесплатного тарифа

| Сервис | Ограничение |
|--------|-------------|
| Railway | $5 бесплатного кредита в месяц (~500 часов) |
| Render  | Сервис засыпает после 15 мин неактивности (первый запрос ~30 сек) |
| Supabase | 500 МБ БД, 1 ГБ хранилища — альтернатива встроенному PostgreSQL |

Для студенческого проекта и демонстрации любой вариант подходит.
