import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

/**
 * Loads `server/.env` regardless of the working directory the process was
 * started from, then the current directory's `.env` as a fallback.
 *
 * Importing `dotenv/config` alone resolves against `process.cwd()`, so a script
 * run from the repo root (`npm run seed`) silently missed `server/.env` and
 * failed with "DATABASE_URL not found". Anything that reads env must import
 * this module first — it is imported for its side effect.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, '../..');

for (const candidate of [path.join(serverRoot, '.env'), path.resolve(process.cwd(), '.env')]) {
  if (fs.existsSync(candidate)) dotenv.config({ path: candidate });
}

export {};
