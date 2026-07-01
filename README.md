# Анкета сервісних робіт

Локальний редактор анкети працює як статичний frontend плюс локальний CRM proxy.

## Локальний запуск

Запускайте `open-editor.cmd`.

CRM proxy анкети використовує порт `8788`, щоб не конфліктувати з іншими локальними проєктами на `8787`.

Перевірка proxy:

```text
http://127.0.0.1:8788/health
```

Очікувана відповідь:

```json
{"ok":true,"service":"anketa-crm-proxy","port":8788}
```

CRM import endpoint:

```text
POST http://127.0.0.1:8788/api/crm-import
```

Тіло запиту:

```json
{"url":"https://roapp.link/Wr9Evy"}
```

## Config

Frontend бере адресу backend з `config.js`.

Для локальної роботи використовується:

```js
API_BASE_URL = "http://127.0.0.1:8788"
```

Для Vercel або іншого хостингу, де frontend і backend будуть на одному домені, `PRODUCTION_API_BASE_URL` може залишатися порожнім:

```js
API_BASE_URL = ""
```

Тоді production-запити підуть на `/api/health` і `/api/crm-import`.

Якщо backend буде на іншому домені, змініть `PRODUCTION_API_BASE_URL` в `config.js`, наприклад:

```js
const PRODUCTION_API_BASE_URL = "https://your-backend-domain.com";
```

## Hosting

GitHub Pages може хостити тільки frontend. Він не може запускати CRM proxy або backend.

Для CRM-імпорту після хостингу потрібен окремий backend, наприклад Render, Railway, VPS, Vercel serverless, Netlify Functions або інший hosting для backend/API.

У проєкті вже є Vercel-ready serverless backend:

```text
api/health.js
api/crm-import.js
vercel.json
```

Якщо завантажити весь проєкт на Vercel, CRM-імпорт буде працювати через `/api/crm-import` без `localhost`.

Після хостингу frontend не повинен звертатися до `localhost`; якщо backend окремий, потрібно вказати production API URL у `config.js`.

## Security

CRM proxy не є відкритим proxy для будь-яких сайтів. Він дозволяє тільки потрібні CRM-домени: `roapp.link`, `roapp.page` і `*.roapp.page`.

Не зберігайте токени, паролі або секрети у frontend. Якщо для CRM знадобляться секрети, вони мають бути тільки в backend або environment variables.
