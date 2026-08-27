import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/requireAuth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { withTenant } from '../db/pool.js';

export const occurrencesRouter = Router();
occurrencesRouter.use(requireAuth);

const createSchema = z.object({
  clientId: z.string().uuid(),
  pdvId: z.string().uuid(),
  visitId: z.string().uuid().optional(),
  tipo: z.enum(['ruptura', 'falta_espaco', 'material_danificado', 'problema_operacional', 'concorrente', 'problema_atendimento', 'outro']),
  descricao: z.string().min(1),
  prioridade: z.enum(['baixa', 'media', 'alta']).optional(),
});

// Promotor registra durante (ou fora de) uma visita — idempotente por clientId,
// mesmo padrão de visits/photos/price_collections (ver docs/RISKS.md).
occurrencesRouter.post('/occurrences', asyncHandler(async (req, res) => {
  const { tenantId, userId } = req.auth!;
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body', details: parsed.error.flatten() });
  const d = parsed.data;

  const occurrence = await withTenant(tenantId, async (client) => {
    const inserted = await client.query(
      `INSERT INTO app.occurrences (tenant_id, client_id, pdv_id, promotor_id, visit_id, tipo, descricao, prioridade)
       VALUES ($1,$2,$3,$4,$5,$6,$7, COALESCE($8::app.occurrence_prioridade, 'media'))
       ON CONFLICT (client_id) DO NOTHING
       RETURNING id, status`,
      [tenantId, d.clientId, d.pdvId, userId, d.visitId, d.tipo, d.descricao, d.prioridade],
    );
    if (inserted.rows[0]) return inserted.rows[0];

    const existing = await client.query('SELECT id, status FROM app.occurrences WHERE client_id = $1', [d.clientId]);
    return existing.rows[0];
  });

  res.status(201).json(occurrence);
}));

// Central de ocorrências (Seção 13) — visão para quem gerencia, com filtro por status.
occurrencesRouter.get('/occurrences', requireRole('admin', 'gerente', 'supervisor'), asyncHandler(async (req, res) => {
  const { tenantId } = req.auth!;
  const { status } = req.query;
  const conditions: string[] = [];
  const params: unknown[] = [tenantId];
  if (status) { params.push(status); conditions.push(`o.status = $${params.length}`); }
  const where = conditions.length ? `AND ${conditions.join(' AND ')}` : '';

  const rows = await withTenant(tenantId, async (client) => {
    const result = await client.query(
      `SELECT o.id, o.tipo, o.descricao, o.prioridade, o.status, o.criado_em,
              p.nome AS pdv, u.nome AS promotor
       FROM app.occurrences o
       JOIN app.pdvs p ON p.id = o.pdv_id
       JOIN app.users u ON u.id = o.promotor_id
       WHERE o.tenant_id = $1 ${where}
       ORDER BY
         CASE o.status WHEN 'aberta' THEN 0 WHEN 'em_acompanhamento' THEN 1 ELSE 2 END,
         CASE o.prioridade WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END,
         o.criado_em DESC`,
      params,
    );
    return result.rows;
  });
  res.json(rows);
}));

const statusSchema = z.object({ status: z.enum(['aberta', 'em_acompanhamento', 'resolvida']) });

occurrencesRouter.patch('/occurrences/:id/status', requireRole('admin', 'gerente', 'supervisor'), asyncHandler(async (req, res) => {
  const { tenantId } = req.auth!;
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body' });

  const updated = await withTenant(tenantId, async (client) => {
    const result = await client.query(
      `UPDATE app.occurrences SET status = $2, atualizado_em = now() WHERE id = $1 RETURNING id, status`,
      [req.params.id, parsed.data.status],
    );
    return result.rows[0];
  });
  if (!updated) return res.status(404).json({ error: 'occurrence_not_found' });
  res.json(updated);
}));
