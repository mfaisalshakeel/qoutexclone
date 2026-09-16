#!/bin/sh
# Applies pending migrations, seeds the markets once, then starts the API.
set -e

echo "[entrypoint] waiting for the database…"
for i in $(seq 1 60); do
  if npx --no-install prisma migrate deploy --schema server/prisma/schema.prisma >/tmp/migrate.log 2>&1; then
    echo "[entrypoint] database is up to date"
    break
  fi
  if [ "$i" = "60" ]; then
    echo "[entrypoint] database never became reachable:"
    cat /tmp/migrate.log
    exit 1
  fi
  sleep 2
done

if [ "${SEED_ON_START:-true}" = "true" ]; then
  node server/dist/seed.js || echo "[entrypoint] seed skipped"
fi

exec node server/dist/index.js
