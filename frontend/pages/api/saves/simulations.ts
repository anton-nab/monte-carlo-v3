/**
 * pages/api/saves/simulations.ts
 * ───────────────────────────────
 * GET    → list saved simulations for authenticated user
 * POST   → save a simulation  { name, ticker, model, params, summary }
 * DELETE → delete by id  ?id=123
 *
 * All routes require a valid NextAuth session.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import pool from '../../../lib/db';

export interface SavedSimulation {
  id:         number;
  user_id:    string;
  name:       string;
  ticker:     string;
  model:      string;
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

  // ── GET — list user's simulations ───────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const { rows } = await pool.query<SavedSimulation>(
        `SELECT id, name, ticker, model, params, summary, created_at
         FROM saved_simulations
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT 100`,
        [userId],
      );
      return res.status(200).json({ items: rows });
    } catch (err) {
      console.error('[simulations GET]', err);
      return res.status(500).json({ error: 'Database error' });
    }
  }

  // ── POST — save simulation ──────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { name = '', ticker, model, params = {}, summary = {} } = req.body ?? {};
    if (!ticker || !model) {
      return res.status(400).json({ error: 'ticker and model are required' });
    }
    try {
      const { rows } = await pool.query<{ id: number }>(
        `INSERT INTO saved_simulations (user_id, name, ticker, model, params, summary)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [userId, name || `${ticker} · ${model.toUpperCase()} · ${new Date().toISOString().slice(0, 10)}`,
         ticker.toUpperCase(), model, JSON.stringify(params), JSON.stringify(summary)],
      );
      return res.status(200).json({ ok: true, id: rows[0].id });
    } catch (err) {
      console.error('[simulations POST]', err);
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
      // user_id check prevents deleting another user's data
      await pool.query(
        `DELETE FROM saved_simulations WHERE id = $1 AND user_id = $2`,
        [id, userId],
      );
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error('[simulations DELETE]', err);
      return res.status(500).json({ error: 'Database error' });
    }
  }

  res.setHeader('Allow', 'GET, POST, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
}
