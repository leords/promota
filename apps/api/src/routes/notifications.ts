import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/requireAuth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { withTenant } from '../db/pool.js';

export const notificationsRouter = Router();

// Histórico de notificações (Seção 14 — "notificações dentro do sistema"): toda
// notificação decidida pelo sistema fica aqui, tenha o e-mail saído ou não.
notificationsRouter.get('/notifications', requireAuth, requireRole('admin', 'gerente'), asyncHandler(async (req, res) => {
  const { tenantId } = req.auth!;
  const rows = await withTenant(tenantId, async (client) => {
    const result = await client.query(
      `SELECT n.id, n.tipo, n.assunto, n.canal, n.status, n.erro, n.criado_em,
              COALESCE(n.destinatario_email, u.email) AS destinatario
       FROM app.notifications n
       LEFT JOIN app.users u ON u.id = n.destinatario_user_id
       WHERE n.tenant_id = $1
       ORDER BY n.criado_em DESC
       LIMIT 100`,
      [tenantId],
    );
    return result.rows;
  });
  res.json(rows);
}));
