import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/requireAuth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { withTenant } from '../db/pool.js';

export const usersRouter = Router();
usersRouter.use(requireAuth);

// Lista usuários da empresa — usado principalmente para escolher o promotor ao criar
// uma rota (Seção 7). Somente quem gerencia gente (admin/gerente/supervisor) precisa
// disso; promotor não tem motivo para ver a lista de outros usuários.
usersRouter.get('/users', requireRole('admin', 'gerente', 'supervisor'), asyncHandler(async (req, res) => {
  const { tenantId } = req.auth!;
  const role = typeof req.query.role === 'string' ? req.query.role : undefined;

  const rows = await withTenant(tenantId, async (client) => {
    const result = await client.query(
      `SELECT id, nome, email, role, ativo FROM app.users
       WHERE tenant_id = $1 AND ($2::app.user_role IS NULL OR role = $2::app.user_role)
       ORDER BY nome`,
      [tenantId, role ?? null],
    );
    return result.rows;
  });

  res.json(rows);
}));
