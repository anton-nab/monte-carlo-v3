/**
 * pages/api/saves/watchlist.ts
 * ─────────────────────────────
 * GET    → list tickers for authenticated user
 * POST   → add a ticker  { ticker, name? }
 * DELETE → remove a ticker  ?ticker=AAPL
 *
 * All routes require a valid NextAuth session (JWT cookie).
 * Returns 401 if unauthenticated.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import pool from '../../../lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const userId = session.userId;

  // ── GET — return watchlist ──────────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const { rows } = await pool.query<{ ticker: string; name: string }>(
        `SELECT ticker, name FROM user_watchlist WHERE user_id = $1 ORDER BY added_at DESC`,
        [userId],
      );
      return res.status(200).json({ items: rows });
    } catch (err) {
      console.error('[watchlist GET]', err);
      return res.status(500).json({ error: 'Database error' });
    }
  }

  // ── POST — add ticker ───────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { ticker, name = '' } = req.body ?? {};
    if (!ticker || typeof ticker !== 'string') {
      return res.status(400).json({ error: 'ticker is required' });
    }
    const t = ticker.trim().toUpperCase();
    const n = (name as string).trim() || t;
    try {
      await pool.query(
        `INSERT INTO user_watchlist (user_id, ticker, name)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, ticker) DO UPDATE SET name = EXCLUDED.name`,
        [userId, t, n],
      );
      return res.status(200).json({ ok: true, ticker: t });
    } catch (err) {
      console.error('[watchlist POST]', err);
      return res.status(500).json({ error: 'Database error' });
    }
  }

  // ── DELETE — remove ticker ──────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    const ticker = req.query.ticker as string | undefined;
    if (!ticker) {
      return res.status(400).json({ error: 'ticker query param is required' });
    }
    const t = ticker.trim().toUpperCase();
    try {
      await pool.query(
        `DELETE FROM user_watchlist WHERE user_id = $1 AND ticker = $2`,
        [userId, t],
      );
      return res.status(200).json({ ok: true, ticker: t });
    } catch (err) {
      console.error('[watchlist DELETE]', err);
      return res.status(500).json({ error: 'Database error' });
    }
  }

  res.setHeader('Allow', 'GET, POST, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
}
