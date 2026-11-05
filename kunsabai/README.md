# Kunsabai

Карта постов, патрулей и камер в Таиланде. Статический PWA: Leaflet + OpenStreetMap, бэкенд — бесплатный Supabase (опционально).

## Запуск и хостинг (бесплатно)
Сайт — статическая папка `kunsabai`, сборка не нужна. Локально: `python3 -m http.server` внутри папки.
Без настройки Supabase работает демо-режим (отметки хранятся только на устройстве).

- **GitHub Pages** (репозиторий должен быть публичным): Settings → Pages → Source: **GitHub Actions**. Публикует `.github/workflows/pages.yml`.
- **Cloudflare Pages** (подходит для приватного репозитория): dash.cloudflare.com → Workers & Pages → Create → Pages → Connect to Git → репозиторий → Build command: пусто, Build output directory: `kunsabai`.
- **Netlify** (тоже для приватного): app.netlify.com → Add new site → Import from Git → репозиторий. Настройки берутся из `netlify.toml`.

Свой домен подключается потом в настройках выбранного хостинга.

## Тесты
`npm i --no-save playwright && node tests/smoke.js && node tests/live-mock.js && node tests/offline.js` — интерфейс.
`tests/schema.sh` — правила базы на PostgreSQL (нужны переменные PGHOST/PGPORT/PGUSER). Всё запускается и в GitHub Actions.

## Общая база отметок и аккаунты (бесплатно, Supabase)
1. Зарегистрироваться на https://supabase.com → **New project** (тариф Free, регион Singapore — ближе к Таиланду).
2. **Authentication → Sign In / Providers**: включить **Allow anonymous sign-ins** и **Email** (вход по коду).
3. **Authentication → Email Templates → Magic Link**: добавить в письмо код `{{ .Token }}`, чтобы приходил 6-значный код. То же для **Change Email Address**.
4. **SQL Editor** → вставить весь `schema.sql` → **Run**.
5. **Project Settings → API**: скопировать **Project URL** и **anon public key** в `config.js`.

Что получается:
- каждый посетитель сразу получает гостевой аккаунт «Пользователь 12345» и может ставить метки;
- голосовать ✔/✖ можно только после входа по e-mail коду (гостевой аккаунт превращается в постоянный, метки остаются);
- на сервере: не больше 5 меток за 10 минут на пользователя, один голос на метку, удалить можно только свою метку;
- «звёздочка» проверенного пользователя: Table Editor → profiles → `verified = true`;
- новые метки появляются у всех сразу (Realtime), плюс проверка раз в минуту.

## Мобильное приложение
- iPhone: Safari → «Поделиться» → «На экран “Домой”».
- Android: кнопка «Установить приложение» или меню браузера. После установки Kunsabai появится в меню «Поделиться» — ссылку на точку из карт можно отправить в приложение.

## Функции
Типы отметок, фильтры, подтверждение «Стоят» / «Уже нет», старение отметок (3 ч — полупрозрачные, 12 ч — скрываются), поиск по Таиланду, геолокация, офлайн-оболочка.
