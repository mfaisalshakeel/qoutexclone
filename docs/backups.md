# Backups and restore

Two things need backing up, separately: the **MySQL database** (everything —
balances, trades, the ledger, KYC records, settings) and the **KYC document
store** (`STORAGE_DIR`, default `server/storage/`), since a submitted document
lives on disk as a file, not as a database blob (see
[`server/src/services/storage.ts`](../server/src/services/storage.ts)). A
database restore without the matching file store leaves `KycSubmission` rows
pointing at documents that no longer exist; back both up on the same schedule
and restore them together.

`.env` (secrets, JWT keys) is not a backup target — it is never committed and
should be kept in your own secrets manager, not in a dump.

## Database

### Docker Compose deployment

```bash
# backup — dumps from the running db service, no separate mysqldump install needed
docker compose exec -T db mysqldump \
  -u root -p"${MYSQL_ROOT_PASSWORD:-rootpassword}" \
  --single-transaction --routines --triggers \
  "${MYSQL_DATABASE:-quotex}" | gzip > "backup-$(date +%Y%m%d-%H%M%S).sql.gz"
```

`--single-transaction` takes a consistent snapshot on InnoDB (every table here
is InnoDB) without locking the tables, so it's safe to run against a live
platform — settlement and trading keep running during the dump.

Restore into a fresh or existing database:

```bash
gunzip < backup-20260927-170000.sql.gz | docker compose exec -T db mysql \
  -u root -p"${MYSQL_ROOT_PASSWORD:-rootpassword}" "${MYSQL_DATABASE:-quotex}"
```

Restoring overwrites tables in place; if you're restoring into a database that
already has data, drop and recreate it first (`docker compose exec db mysql -u root -p... -e "DROP DATABASE quotex; CREATE DATABASE quotex CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"`).

### Manual / VPS / shared hosting deployment

Same idea, run directly against whatever MySQL/MariaDB host `DATABASE_URL`
points at:

```bash
mysqldump -h "$DB_HOST" -u "$DB_USER" -p --single-transaction --routines --triggers \
  "$DB_NAME" | gzip > "backup-$(date +%Y%m%d-%H%M%S).sql.gz"

# restore
gunzip < backup-20260927-170000.sql.gz | mysql -h "$DB_HOST" -u "$DB_USER" -p "$DB_NAME"
```

On shared hosting without shell access, use cPanel's own "Backup Wizard" /
phpMyAdmin export, which does the same `mysqldump` under the hood.

### Railway

Railway's managed MySQL takes its own automatic daily snapshots (see the
database service's **Backups** tab) — nothing in this repo to configure. For
an out-of-Railway copy, run the manual command above against the connection
string in the MySQL service's **Connect** tab.

## KYC document store

The store is a plain directory of files named by opaque, randomly-generated
refs (see `LocalDiskStorageProvider` in `storage.ts`) — back it up like any
other directory:

```bash
# Docker Compose: the app container's /app/storage, or bind-mount STORAGE_DIR
# to the host and back that path up directly instead.
tar czf "kyc-storage-$(date +%Y%m%d-%H%M%S).tar.gz" -C server storage

# restore
tar xzf kyc-storage-20260927-170000.tar.gz -C server
```

If `docker-compose.yml` is changed to mount `STORAGE_DIR` as a named volume
(it isn't, by default — the directory lives inside the app container and does
not currently survive a container recreate), back up that volume the same way
as `db-data`:

```bash
docker run --rm -v qoutexclone_storage-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/kyc-storage-$(date +%Y%m%d-%H%M%S).tar.gz -C /data .
```

## Schedule and retention

Run both backups together, on a cron job on whatever host runs Docker Compose
or the API:

```cron
# 03:00 daily — database and KYC store, kept 14 days
0 3 * * * cd /path/to/qoutexclone && ./scripts/backup.sh
```

There's no `scripts/backup.sh` checked in — wire the two commands above into
one script for your actual host and prune anything older than your retention
window (`find . -name 'backup-*.sql.gz' -mtime +14 -delete`). How long to keep
backups is a business/compliance decision (this repo defaults nothing here),
not a technical one — pick a window that satisfies your jurisdiction's
financial recordkeeping requirements, generally longer than the 180-day
`security.loginHistoryRetentionDays` application-level retention described in
[`server/src/services/retention.ts`](../server/src/services/retention.ts),
which prunes stale login history and expired sessions from the live database
and is unrelated to backup retention.

## Verify restores

A backup nobody has restored is a hope, not a backup. Periodically (monthly is
reasonable) restore the latest dump into a throwaway database and run:

```bash
DATABASE_URL="mysql://quotex:quotex@127.0.0.1:3306/quotex_restore_test" \
  npx --workspace=server prisma migrate deploy
```

If that fails, the backup or the restore procedure is broken — better to find
out on a Tuesday than during an incident.
