import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { withTenant } from '../db/pool.js';

export const meRouter = Router();

// Rota protegida de exemplo — prova que o isolamento por tenant funciona de ponta a
// ponta (JWT -> withTenant -> RLS), sem exigir que o código da rota filtre por tenant_id.
meRouter.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const { userId, tenantId, role } = req.auth!;
  const user = await withTenant(tenantId, async (client) => {
    const result = await client.query<{ id: string; nome: string; email: string }>(
      'SELECT id, nome, email FROM app.users WHERE id = $1',
      [userId],
    );
    return result.rows[0];
  });

  if (!user) {
    return res.status(404).json({ error: 'user_not_found' });
  }

  res.json({ ...user, role, tenantId });
}));
