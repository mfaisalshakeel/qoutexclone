# Deploying Quantex for testing

The whole platform runs as **one container**: the API serves the built web client,
the websocket and `/api` from a single port, and on boot it applies migrations and
seeds the markets. So anything that can build a Dockerfile and hand it a MySQL URL
can host it.

Three paths, fastest first.

---

## 1. Railway — a public URL in about five minutes

Railway is the easiest because it offers managed **MySQL** (Render and Vercel do not,
and this schema is MySQL).

1. Push the branch (already done) and open <https://railway.com/new>.
2. **Deploy from GitHub repo** → pick `qoutexclone` → branch `claude/gallant-heisenberg-y38t6b`.
   Railway sees the `Dockerfile` and builds it; no buildpack configuration needed.
3. In the same project: **New → Database → MySQL**.
4. Open the app service → **Variables** and set:

   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | `${{MySQL.MYSQL_URL}}` (Railway substitutes the real URL) |
   | `JWT_SECRET` | any long random string |
   | `JWT_REFRESH_SECRET` | a different long random string |
   | `ADMIN_EMAIL` | your email — this becomes the back-office login |
   | `ADMIN_PASSWORD` | a password you choose (do not leave the seeded one on a public URL) |
   | `CORS_ORIGINS` | `*` while testing |
   | `FEED_PROVIDER` | `simulated` (or `binance` for live crypto prices) |
   | `MOCK_CHAIN_WATCHER` | `true` — deposits auto-confirm, which is what you want for testing |
   | `AUTO_APPROVE_WITHDRAWALS` | `false` |

5. **Settings → Networking → Generate Domain**. That URL is the platform.
   Websockets work on it as-is.

The first boot runs `prisma migrate deploy` and the seed, so the markets, the
tournament and the admin account exist immediately. Set `SEED_ON_START=false`
later if you do not want the seed re-checked on each deploy.

**Free MySQL elsewhere**: if you would rather keep the database off Railway, any
MySQL 8 / MariaDB 10.4+ works — Aiven and Clever Cloud both have free tiers. Paste
its connection string into `DATABASE_URL` and skip step 3.

---

## 2. Your own machine or any VPS — one command

Needs Docker with the Compose plugin. Nothing else, not even Node.

```bash
cp .env.example .env             # edit the secrets
docker compose up -d --build     # first build takes a few minutes
```

Then open <http://localhost:4000>. MySQL runs beside it in the same project with a
named volume, so the data survives restarts.

```bash
docker compose logs -f app       # boot, migrations, seed
docker compose down              # stop; add -v to wipe the database too
```

On a VPS, put nginx or Caddy in front of port 4000 for TLS. Websockets need the
usual `Upgrade` headers passed through:

```nginx
location / {
  proxy_pass http://127.0.0.1:4000;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
}
```

---

## 3. Shared hosting / cPanel — no Docker

The build has no native dependencies, so a cPanel "Setup Node.js App" with a
MariaDB database is enough.

```bash
# on your machine
npm ci
npm run build                    # builds web/dist and server/dist
```

Upload `server/dist`, `server/prisma`, `web/dist`, `package.json`,
`package-lock.json` and `server/package.json`. Then on the host:

```bash
npm ci --omit=dev --workspace=server
npx prisma migrate deploy --schema server/prisma/schema.prisma
node server/dist/seed.js         # once
node server/dist/index.js        # or point the cPanel app at this file
```

Set the same environment variables as the table above. `migrate deploy` needs no
shadow database, which is why it works on hosting where you only get one schema.

---

## Before you put the URL in front of anyone

- **Change `ADMIN_PASSWORD`** (and the seeded trader's password, from the back
  office). The seeded logins are in the README and are meant for local work.
- Keep `MOCK_CHAIN_WATCHER=true` and `AUTO_APPROVE_WITHDRAWALS=false` until real
  custody credentials exist: with the mock watcher, deposits are simulated and no
  chain is ever touched.
- The legal pages carry placeholder text, clearly marked. Real money needs the
  licensing, KYC/AML and legal copy listed under "Blocked on owner" in
  `docs/PROGRESS.md`.

## Why I cannot deploy it from here

This session runs in a sealed, temporary container: its ports are not reachable
from the internet, outbound traffic is restricted to an allow-list (the deploy APIs
are blocked), and the container is reclaimed when the session ends. Claude Code on
the web has no preview-URL feature that would expose it. Deploying from GitHub, as
in option 1, needs nothing from this container — the platform pulls the branch
itself.
