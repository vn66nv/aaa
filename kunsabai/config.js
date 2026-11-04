// Бэкенд: бесплатный проект Supabase (см. README.md). Пока пусто — работает локальный демо-режим.
window.KUNSABAI = {
  SUPABASE_URL: "",       // https://xxxx.supabase.co
  SUPABASE_ANON_KEY: "",  // публичный anon key
  TTL_HOURS: 3,           // через сколько часов без подтверждений отметка считается устаревшей
  HIDE_AFTER_HOURS: 12,   // и скрывается совсем
  ALERT_RADIUS_M: 500,    // предупреждать о метке ближе этого расстояния
  CLUSTER_BELOW_ZOOM: 11  // при отдалении метки группируются в кружки с числом
};
