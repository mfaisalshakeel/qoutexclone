import { describe, expect, it } from 'vitest';
import { buildDatabaseUrl, buildEnvFile, randomSecret } from './env-template.js';

describe('buildDatabaseUrl', () => {
  it('builds a plain mysql:// url from simple credentials', () => {
    expect(buildDatabaseUrl({ host: '127.0.0.1', port: 3306, database: 'quotex', user: 'quotex', password: 'quotex' })).toBe(
      'mysql://quotex:quotex@127.0.0.1:3306/quotex',
    );
  });

  it('percent-encodes a password containing url-special characters', () => {
    const url = buildDatabaseUrl({
      host: '127.0.0.1',
      port: 3306,
      database: 'quotex',
      user: 'quotex',
      password: 'p@ss:word/with?special&chars',
    });
    // a literal '@' before the host would move where the credentials end
    expect(url).toBe('mysql://quotex:p%40ss%3Aword%2Fwith%3Fspecial%26chars@127.0.0.1:3306/quotex');
  });

  it('percent-encodes a database or user name with special characters too', () => {
    const url = buildDatabaseUrl({ host: 'db.example.com', port: 3307, database: 'my db', user: 'a/b', password: '' });
    expect(url).toBe('mysql://a%2Fb:@db.example.com:3307/my%20db');
  });

  it('trims whitespace from the host', () => {
    const url = buildDatabaseUrl({ host: '  127.0.0.1  ', port: 3306, database: 'quotex', user: 'quotex', password: '' });
    expect(url).toContain('@127.0.0.1:3306');
  });
});

describe('randomSecret', () => {
  it('generates a long, hex-encoded secret', () => {
    const secret = randomSecret();
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never repeats between calls', () => {
    expect(randomSecret()).not.toBe(randomSecret());
  });
});

describe('buildEnvFile', () => {
  const params = {
    databaseUrl: 'mysql://quotex:quotex@127.0.0.1:3306/quotex',
    jwtSecret: 'a'.repeat(64),
    jwtRefreshSecret: 'b'.repeat(64),
    admin: { email: 'admin@quotexclone.dev', password: 'Admin123!' },
    port: 4000,
  };

  it('carries the database url, secrets and admin credentials through unchanged', () => {
    const env = buildEnvFile(params);
    expect(env).toContain('DATABASE_URL="mysql://quotex:quotex@127.0.0.1:3306/quotex"');
    expect(env).toContain(`JWT_SECRET=${params.jwtSecret}`);
    expect(env).toContain(`JWT_REFRESH_SECRET=${params.jwtRefreshSecret}`);
    expect(env).toContain('ADMIN_EMAIL=admin@quotexclone.dev');
    expect(env).toContain('ADMIN_PASSWORD=Admin123!');
    expect(env).toContain('PORT=4000');
  });

  it('matches the CLI installer\'s own bootstrap defaults — one template, two front doors', () => {
    const env = buildEnvFile(params);
    expect(env).toContain('NODE_ENV=production');
    expect(env).toContain('FEED_PROVIDER=simulated');
    expect(env).toContain('MOCK_CHAIN_WATCHER=true');
    expect(env).toContain('AUTO_APPROVE_WITHDRAWALS=false');
  });
});
