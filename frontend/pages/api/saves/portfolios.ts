/**
 * pages/api/saves/portfolios.ts
 * ──────────────────────────────
 * GET    → list saved portfolios for authenticated user
 * POST   → save a portfolio  { name, tickers, params, summary }
 * DELETE → delete by id  ?id=123
 *
 * All routes require a valid NextAuth session.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import pool from '../../../lib/db';

export interface SavedPortfolio {
  id:         number;
  user_id:    string;
  name:       string;
  tickers:    string[];
  params:     Record<string, unknown>;
  summary:    Record<string, unknown>;
  created_at: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const userId = session.userId;

  // ── GET — list user's portfolios ────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const { rows } = await pool.query<SavedPortfolio>(
        `SELECT id, name, tickers, params, summary, created_at
         FROM saved_portfolios
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT 100`,
        [userId],
      );
      return res.status(200).json({ items: rows });
    } catch (err) {
      console.error('[portfolios GET]', err);
      return res.status(500).json({ error: 'Database error' });
    }
  }

  // ── POST — save portfolio ───────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { name = '', tickers, params = {}, summary = {} } = req.body ?? {};
    if (!tickers || !Array.isArray(tickers) || tickers.length === 0) {
      return res.status(400).json({ error: 'tickers array is required' });
    }
    const tickerList = (tickers as string[]).map(t => t.trim().toUpperCase());
    try {
      const { rows } = await pool.query<{ id: number }>(
        `INSERT INTO saved_portfolios (user_id, name, tickers, params, summary)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [userId,
         name || `${tickerList.join(' · ')} · ${new Date().toISOString().slice(0, 10)}`,
         tickerList,
         JSON.stringify(params),
         JSON.stringify(summary)],
      );
      return res.status(200).json({ ok: true, id: rows[0].id });
    } catch (err) {
      console.error('[portfolios POST]', err);
      return res.status(500).json({ error: 'Database error' });
    }
  }

  // ── DELETE — delete by id ───────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    const id = req.query.id ? Number(req.query.id) : NaN;
    if (!id || isNaN(id)) {
      return res.status(400).json({ error: 'id query param is required' });
    }
    try {
      await pool.query(
        `DELETE FROM saved_portfolios WHERE id = $1 AND user_id = $2`,
        [id, userId],
      );
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error('[portfolios DELETE]', err);
      return res.status(500).json({ error: 'Database error' });
    }
  }

  res.setHeader('Allow', 'GET, POST, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
}
