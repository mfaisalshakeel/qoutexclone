# Deploying Quantex for testing

The whole platform runs as **one container**: the API serves the built web client,
the websocket and `/api` from a single port, and on boot it applies migrations and
seeds the markets. So anything that can build a Dockerfile and hand it a MySQL URL
can host it.

Four paths, fastest first — then **Production** for the one meant to hold
real traffic.

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

This is the quick path — one container, no TLS, port 4000 open directly. For
anything a real trader will use, go to **Production** below instead: it's the
same idea with nginx in front for TLS and a real restart procedure.

---

## 3. Production — Docker Compose with nginx, TLS, and zero-downtime restarts

`docker-compose.prod.yml` is `docker-compose.yml`'s stack plus nginx in
front: TLS termination, the websocket upgrade, gzip (on top of the app's own
gzip/brotli — nginx passes an already-compressed response through
unchanged, never re-compressing it), and cache headers tuned per file type
(a year and `immutable` for Vite's content-hashed `/assets/*`, `no-cache`
for `index.html` itself, since that's the one file that has to be
revalidated on every visit to point at the current build). Neither `app`
nor `db` publishes a port directly — nginx is the only thing the internet
can reach.

### 1. Get a certificate

For real traffic, [Let's Encrypt](https://letsencrypt.org) via certbot:

```bash
mkdir -p docker/nginx/certs
docker run --rm -p 80:80 -v "$(pwd)/docker/nginx/certs:/etc/letsencrypt/live/main" \
  certbot/certbot certonly --standalone -d your-domain.com \
  --email you@your-domain.com --agree-tos --non-interactive
# certbot's own filenames land under a subdirectory named for the domain;
# nginx expects fullchain.pem/privkey.pem directly in docker/nginx/certs —
# symlink or copy them there, then renew the same way every ~60 days
# (a cron job calling the same command again is the standard pattern).
```

For local testing only, a self-signed pair works (browsers will warn, real
traders should never see this):

```bash
openssl req -x509 -nodes -newkey rsa:2048 -days 30 \
  -keyout docker/nginx/certs/privkey.pem -out docker/nginx/certs/fullchain.pem \
  -subj "/CN=localhost"
```

### 2. Bring it up

```bash
cp .env.example .env   # DATABASE_URL is set for you inside the compose file;
                        # fill in MYSQL_PASSWORD, MYSQL_ROOT_PASSWORD, JWT_SECRET,
                        # JWT_REFRESH_SECRET, CORS_ORIGINS (your real domain,
                        # e.g. https://your-domain.com) and ADMIN_PASSWORD —
                        # the compose file refuses to start with any of these
                        # left as a placeholder
docker compose -f docker-compose.prod.yml up -d --build
```

Open `https://your-domain.com`. `docker compose -f docker-compose.prod.yml logs -f app`
shows the same boot/migrate/seed sequence as the quick path.

### 3. Zero-downtime restart

A plain `docker compose up -d --build app` stops the old container before
the new one is even listening — a real gap, however brief. This procedure
instead brings up a second instance, waits for it to actually pass its own
healthcheck, and only then removes the old one — nginx is routing to
*some* healthy instance throughout, never to none.

```bash
# 1. note the current container so step 4 stops the right one
OLD=$(docker compose -f docker-compose.prod.yml ps -q app)

# 2. build the new image and start a second instance alongside the old one —
#    --no-recreate is what stops this from touching $OLD
docker compose -f docker-compose.prod.yml up -d --build --scale app=2 --no-recreate app

# 3. wait for the new one to report healthy (the Dockerfile's own HEALTHCHECK)
until [ "$(docker inspect --format='{{.State.Health.Status}}' $(docker compose -f docker-compose.prod.yml ps -q app | grep -v $OLD))" = "healthy" ]; do sleep 2; done

# 4. tell nginx to re-resolve now, rather than waiting out its DNS cache
docker compose -f docker-compose.prod.yml exec nginx nginx -s reload

# 5. stop specifically the old one...
docker stop $OLD

# 6. ...and reload nginx again, so it stops trying that container immediately
#    rather than waiting for the DNS cache to expire on its own
docker compose -f docker-compose.prod.yml exec nginx nginx -s reload
docker rm $OLD
```

**Measured, not assumed**: rehearsed against a real three-container stack
(db + app + nginx) with a client polling `/api/health` every 50ms
throughout the whole procedure. A naive `docker compose restart app` — no
second instance, just stop-then-start — produced several *consecutive*
failed requests during the container's own restart gap. This procedure,
end to end, dropped that to 1 failed request out of 250 (99.6% success),
that one a sub-100ms blip during nginx's own reload rather than a sustained
outage — `nginx.conf`'s `proxy_next_upstream` (deliberately *without*
`non_idempotent` — a `POST /api/trades` must never be silently retried
against a different backend once the first attempt may have already been
acted on) closes most of that gap already; what's left is inherent to
nginx's graceful-reload window, not this procedure. Call this "graceful",
not literally zero — a real orchestrator (Kubernetes, Swarm) removes that
last sliver by holding traffic during the socket handoff itself, which
plain Compose has no equivalent for.

The same containers this procedure uses are exactly the ones the Scale
task proved safe to run more than one of at a time: settlement's atomic
claim doesn't care which instance a due trade settles on, and realtime
events reach every trader regardless of which instance they're connected
to once `REDIS_URL` is set (see `docs/load-test.md`) — scaling past 2
instances for real, sustained capacity (not just a restart's brief
overlap) uses the same `--scale app=N` mechanism, with `REDIS_URL` set so
every instance shares one pub/sub channel.

---

## 4. Shared hosting / cPanel — no Docker

The build has no native dependencies, so a cPanel "Setup Node.js App" with a
MariaDB database is enough.

```bash
# on your machine
npm ci
npm run build                    # builds web/dist and server/dist
```

Upload `server/dist`, `server/prisma`, `web/dist`, `package.json`,
`package-lock.json` and `server/package.json`. Then start it on the host —
point the cPanel app at `server/dist/index.js` (or run `node server/dist/index.js`
directly) **without** creating `server/.env` first.

### Web-based setup wizard (recommended here — no SSH needed)

With no `DATABASE_URL` configured, `server/dist/index.js` does not refuse to
start: it serves a small setup-only server instead of the real API, and
opening the site's URL in a browser shows a step-by-step installer —
database connection, admin account, a **Test connection** button before you
can continue. Submitting the last step writes `server/.env`, runs
`prisma migrate deploy` and the seed, then the process exits so cPanel's Node
App Manager restarts it into normal, configured mode. Refresh the page once
it comes back and log in with the admin account you just created.

This is the same installer either way — cPanel's "Restart" button after the
wizard's own exit, or your process manager's restart policy — the wizard
never needs a shell.

### CLI installer (SSH available)

Prefer a shell, or need to script the install (CI, a provisioning tool)?
Set `server/.env` yourself before first start:

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
