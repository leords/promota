import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/requireAuth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { withTenant } from '../db/pool.js';
import { refreshRouteStatus } from '../services/routeStatus.js';

export const routesRouter = Router();
routesRouter.use(requireAuth);

const createRouteSchema = z.object({
  nome: z.string().min(1),
  data: z.string().date(), // YYYY-MM-DD
  promotorId: z.string().uuid(),
  pdvIds: z.array(z.string().uuid()).min(1),
  observacoes: z.string().optional(),
});

// Gerente/admin cria uma rota e já atribui a lista ordenada de PDVs (Seção 7).
routesRouter.post('/routes', requireRole('admin', 'gerente'), asyncHandler(async (req, res) => {
  const { tenantId } = req.auth!;
  const parsed = createRouteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body', details: parsed.error.flatten() });
  const d = parsed.data;

  const route = await withTenant(tenantId, async (client) => {
    await client.query('BEGIN');
    try {
      const routeResult = await client.query(
        `INSERT INTO app.routes (tenant_id, nome, data, promotor_id, observacoes)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [tenantId, d.nome, d.data, d.promotorId, d.observacoes],
      );
      const routeId = routeResult.rows[0].id;

      for (const [index, pdvId] of d.pdvIds.entries()) {
        await client.query(
          `INSERT INTO app.route_pdvs (tenant_id, route_id, pdv_id, ordem)
           VALUES ($1, $2, $3, $4)`,
          [tenantId, routeId, pdvId, index],
        );
      }
      await client.query('COMMIT');
      return { id: routeId };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });

  res.status(201).json(route);
}));

// Gerente/admin: visão geral das rotas criadas (mais recentes primeiro).
routesRouter.get('/routes', requireRole('admin', 'gerente', 'supervisor'), asyncHandler(async (req, res) => {
  const { tenantId } = req.auth!;
  const rows = await withTenant(tenantId, async (client) => {
    const result = await client.query(
      `SELECT r.id, r.nome, to_char(r.data, 'YYYY-MM-DD') AS data, r.status, u.nome AS promotor,
              count(rp.id) AS total_pdvs,
              count(rp.id) FILTER (WHERE rp.status = 'concluido') AS concluidos
       FROM app.routes r
       JOIN app.users u ON u.id = r.promotor_id
       LEFT JOIN app.route_pdvs rp ON rp.route_id = r.id
       WHERE r.tenant_id = $1
       GROUP BY r.id, u.nome
       ORDER BY r.data DESC, r.criado_em DESC
       LIMIT 100`,
      [tenantId],
    );
    return result.rows;
  });
  res.json(rows);
}));

// Promotor: "minha rota do dia" (Seção 7) — total de PDVs, atendidos, pendentes, próximos.
routesRouter.get('/routes/today', asyncHandler(async (req, res) => {
  const { tenantId, userId } = req.auth!;
  const date = typeof req.query.data === 'string' ? req.query.data : new Date().toISOString().slice(0, 10);

  const route = await withTenant(tenantId, async (client) => {
    const routeResult = await client.query(
      `SELECT id, nome, status, observacoes FROM app.routes
       WHERE tenant_id = $1 AND promotor_id = $2 AND data = $3
       ORDER BY criado_em DESC LIMIT 1`,
      [tenantId, userId, date],
    );
    const routeRow = routeResult.rows[0];
    if (!routeRow) return null;

    const pdvsResult = await client.query(
      `SELECT rp.id AS route_pdv_id, rp.ordem, rp.status, rp.motivo_nao_atendido,
              p.id AS pdv_id, p.nome, p.logradouro, p.numero, p.bairro, p.cidade,
              ST_Y(p.geom::geometry) AS latitude, ST_X(p.geom::geometry) AS longitude
       FROM app.route_pdvs rp JOIN app.pdvs p ON p.id = rp.pdv_id
       WHERE rp.route_id = $1 ORDER BY rp.ordem`,
      [routeRow.id],
    );

    const pdvs = pdvsResult.rows;
    const concluidos = pdvs.filter((p) => p.status === 'concluido').length;
    const naoAtendidos = pdvs.filter((p) => p.status === 'nao_atendido').length;

    return {
      ...routeRow,
      totalPdvs: pdvs.length,
      concluidos,
      naoAtendidos,
      pendentes: pdvs.length - concluidos - naoAtendidos,
      pdvs,
    };
  });

  if (!route) return res.status(404).json({ error: 'no_route_today' });
  res.json(route);
}));

const routePdvStatusSchema = z.object({
  status: z.enum(['pendente', 'em_atendimento', 'concluido', 'nao_atendido']),
  motivoNaoAtendido: z.string().optional(),
});

// Atualiza o status de um PDV dentro da rota (ex.: marcar "não atendido" com motivo).
routesRouter.patch('/routes/pdvs/:routePdvId/status', asyncHandler(async (req, res) => {
  const { tenantId } = req.auth!;
  const parsed = routePdvStatusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body', details: parsed.error.flatten() });
  const { status, motivoNaoAtendido } = parsed.data;

  if (status === 'nao_atendido' && !motivoNaoAtendido) {
    return res.status(400).json({ error: 'motivo_obrigatorio' });
  }

  const updated = await withTenant(tenantId, async (client) => {
    const result = await client.query(
      `UPDATE app.route_pdvs SET status = $2, motivo_nao_atendido = $3
       WHERE id = $1 RETURNING id, status, route_id`,
      [req.params.routePdvId, status, status === 'nao_atendido' ? motivoNaoAtendido : null],
    );
    const row = result.rows[0];
    if (row) await refreshRouteStatus(client, row.route_id);
    return row;
  });

  if (!updated) return res.status(404).json({ error: 'route_pdv_not_found' });
  res.json(updated);
}));
