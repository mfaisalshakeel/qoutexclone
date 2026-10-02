import crypto from 'node:crypto';

export interface SetupDbInput {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export interface SetupAdminInput {
  email: string;
  password: string;
}

/** Builds a `mysql://` connection string, percent-encoding whatever a real
 *  password or database name might contain (`@`, `:`, `/`, ...) so the URL
 *  stays valid however the user typed it. */
export function buildDatabaseUrl(db: SetupDbInput): string {
  const user = encodeURIComponent(db.user);
  const password = encodeURIComponent(db.password);
  const host = db.host.trim();
  const database = encodeURIComponent(db.database.trim());
  return `mysql://${user}:${password}@${host}:${db.port}/${database}`;
}

export function randomSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * The same `server/.env` shape `install.sh` writes, built here instead so the
 * web wizard produces byte-for-byte the same bootstrap file the CLI
 * installer does — one template, two front doors.
 */
export function buildEnvFile(params: {
  databaseUrl: string;
  jwtSecret: string;
  jwtRefreshSecret: string;
  admin: SetupAdminInput;
  port: number;
}): string {
  const { databaseUrl, jwtSecret, jwtRefreshSecret, admin, port } = params;
  return `NODE_ENV=production
PORT=${port}
DATABASE_URL="${databaseUrl}"
JWT_SECRET=${jwtSecret}
JWT_REFRESH_SECRET=${jwtRefreshSecret}
ACCESS_TOKEN_TTL=30m
REFRESH_TOKEN_DAYS=30
CORS_ORIGINS=*

FEED_PROVIDER=simulated
FEED_TICK_MS=250
SETTLEMENT_INTERVAL_MS=200

MIN_DEPOSIT_USD=10
MIN_WITHDRAW_USD=20
WITHDRAW_FEE_PCT=1
WITHDRAW_FLAT_FEE_USD=1
# Credits a pending deposit on a timer, with a made-up transaction hash and no
# chain behind it. That is a demo of the flow, not a payment: leave it off
# unless you are showing the product to someone. The wizard installs a real
# deployment, so it writes it off.
MOCK_CHAIN_WATCHER=false
AUTO_APPROVE_WITHDRAWALS=false

ADMIN_EMAIL=${admin.email}
ADMIN_PASSWORD=${admin.password}
`;
}
