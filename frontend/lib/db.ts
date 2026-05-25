/**
 * lib/db.ts — PostgreSQL connection pool (singleton)
 *
 * Used by Next.js API routes only (server-side).
 * SSL enabled for Railway (rejectUnauthorized: false for self-signed certs).
 *
 * DATABASE_URL format:
 *   postgresql://user:password@host:port/dbname
 *
 * Set in:
 *   - .env.local         (local dev)
 *   - Vercel env vars    (production)
 */

import { Pool } from 'pg';

// Singleton: reuse the pool across hot-reloads in dev
declare global {
  // eslint-disable-next-line no-var
  var _pgPool: Pool | undefined;
}

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('[db] DATABASE_URL is not set');
  }
  return new Pool({
    connectionString,
    ssl: process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }  // Railway uses self-signed cert
      : false,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

const pool: Pool =
  process.env.NODE_ENV === 'production'
    ? createPool()
    : (global._pgPool ??= createPool());

export default pool;
