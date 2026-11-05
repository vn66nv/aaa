#!/usr/bin/env bash
# Проверка kunsabai/schema.sql на чистом PostgreSQL. Использование: PGHOST=... PGPORT=... PGUSER=postgres tests/schema.sh
set -euo pipefail
cd "$(dirname "$0")/.."
psql -q -v ON_ERROR_STOP=1 -c "drop database if exists kunsabai_test" -c "create database kunsabai_test" postgres
psql -q -v ON_ERROR_STOP=1 -d kunsabai_test -f tests/supabase-stub.sql -f kunsabai/schema.sql -f kunsabai/schema.sql >/dev/null 2>&1   # дважды: схема должна запускаться повторно
psql -q -v ON_ERROR_STOP=1 -d kunsabai_test -f tests/schema-test.sql 2>&1 >/dev/null | grep -E "✔|✘|ERROR" | sed 's/^.*NOTICE:  //; s/^.*ERROR:  //'
psql -tAq -d kunsabai_test -c "select 'Все проверки схемы прошли'"
