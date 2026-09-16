#!/usr/bin/env bash
# One-command installer for the Quantex binary options platform.
#
#   ./install.sh                     interactive install onto this machine
#   DATABASE_URL=... ./install.sh    non-interactive (CI, provisioning scripts)
#
# It installs dependencies, writes server/.env, applies the database schema,
# seeds the markets and builds both the API and the web client.
set -euo pipefail

BOLD=$(printf '\033[1m'); DIM=$(printf '\033[2m'); RED=$(printf '\033[31m')
GREEN=$(printf '\033[32m'); YELLOW=$(printf '\033[33m'); RESET=$(printf '\033[0m')
say()  { echo "${BOLD}==>${RESET} $*"; }
warn() { echo "${YELLOW}!${RESET} $*"; }
die()  { echo "${RED}✗${RESET} $*" >&2; exit 1; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# ---------------------------------------------------------------- prerequisites
command -v node >/dev/null || die "Node.js is required — install Node 20 or newer (https://nodejs.org)"
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 20 ] || die "Node 20+ is required (found $(node -v))"
command -v npm >/dev/null || die "npm is required"
say "Node $(node -v), npm $(npm -v)"

# ------------------------------------------------------------------- database
if [ -z "${DATABASE_URL:-}" ]; then
  if [ -t 0 ]; then
    echo
    echo "${BOLD}MySQL connection${RESET} ${DIM}(MySQL 8 or MariaDB 10.4+)${RESET}"
    read -r -p "  host [127.0.0.1]: " DB_HOST; DB_HOST=${DB_HOST:-127.0.0.1}
    read -r -p "  port [3306]: " DB_PORT; DB_PORT=${DB_PORT:-3306}
    read -r -p "  database [quotex]: " DB_NAME; DB_NAME=${DB_NAME:-quotex}
    read -r -p "  user [quotex]: " DB_USER; DB_USER=${DB_USER:-quotex}
    read -r -s -p "  password: " DB_PASS; echo
    DATABASE_URL="mysql://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
  else
    die "Set DATABASE_URL when running non-interactively"
  fi
fi

# --------------------------------------------------------------------- secrets
random_secret() {
  if command -v openssl >/dev/null; then openssl rand -hex 32
  else node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))'; fi
}
JWT_SECRET=${JWT_SECRET:-$(random_secret)}
JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET:-$(random_secret)}
ADMIN_EMAIL=${ADMIN_EMAIL:-admin@quotexclone.dev}
ADMIN_PASSWORD=${ADMIN_PASSWORD:-Admin123!}
PORT=${PORT:-4000}
MOCK_CHAIN_WATCHER=${MOCK_CHAIN_WATCHER:-true}

# ------------------------------------------------------------------ write .env
if [ -f server/.env ] && [ -z "${FORCE_ENV:-}" ]; then
  warn "server/.env already exists — keeping it (set FORCE_ENV=1 to overwrite)"
  DATABASE_URL=$(grep -E '^DATABASE_URL=' server/.env | head -1 | cut -d= -f2- | tr -d '"')
else
  say "Writing server/.env"
  cat > server/.env <<ENVEOF
NODE_ENV=production
PORT=${PORT}
DATABASE_URL="${DATABASE_URL}"
JWT_SECRET=${JWT_SECRET}
JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}
ACCESS_TOKEN_TTL=30m
REFRESH_TOKEN_DAYS=30
CORS_ORIGINS=*

FEED_PROVIDER=${FEED_PROVIDER:-simulated}
FEED_TICK_MS=250
SETTLEMENT_INTERVAL_MS=200

MIN_DEPOSIT_USD=10
MIN_WITHDRAW_USD=20
WITHDRAW_FEE_PCT=1
WITHDRAW_FLAT_FEE_USD=1
MOCK_CHAIN_WATCHER=${MOCK_CHAIN_WATCHER}
AUTO_APPROVE_WITHDRAWALS=false

ADMIN_EMAIL=${ADMIN_EMAIL}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
ENVEOF
fi

# ------------------------------------------------------------------ install
say "Installing dependencies"
npm install --no-audit --no-fund

say "Generating the database client"
npm run db:generate --workspace=server

say "Applying the database schema"
npm run db:migrate --workspace=server || {
  warn "migrate deploy failed — falling back to 'prisma db push'"
  npm run db:push --workspace=server
}

say "Seeding markets and the admin account"
npm run seed --workspace=server

say "Building the API and web client"
npm run build

echo
echo "${GREEN}${BOLD}Installation complete.${RESET}"
echo
echo "  Start it with:   ${BOLD}npm start --workspace=server${RESET}"
echo "  Then open:       ${BOLD}http://localhost:${PORT}${RESET}"
echo
echo "  Admin login:     ${BOLD}${ADMIN_EMAIL}${RESET} / ${BOLD}${ADMIN_PASSWORD}${RESET}"
echo
if [ "${MOCK_CHAIN_WATCHER}" = "true" ]; then
  warn "MOCK_CHAIN_WATCHER=true auto-credits pending deposits (demo mode)."
  warn "Set it to false in server/.env before taking real money."
fi
