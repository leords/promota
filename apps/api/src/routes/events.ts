import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/requireAuth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { withTenant } from '../db/pool.js';

export const eventsRouter = Router();
eventsRouter.use(requireAuth);

const createEventSchema = z.object({
  nome: z.string().min(1),
  descricao: z.string().optional(),
  pdvId: z.string().uuid(),
  data: z.string().date(),
  meta: z.string().optional(),
  surveyId: z.string().uuid().optional(),
  observacoes: z.string().optional(),
  promotorIds: z.array(z.string().uuid()).min(1),
  productIds: z.array(z.string().uuid()).optional(),
});

eventsRouter.post('/events', requireRole('admin', 'gerente'), asyncHandler(async (req, res) => {
  const { tenantId } = req.auth!;
  const parsed = createEventSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body', details: parsed.error.flatten() });
  const d = parsed.data;

  const event = await withTenant(tenantId, async (client) => {
    await client.query('BEGIN');
    try {
      const inserted = await client.query(
        `INSERT INTO app.events (tenant_id, nome, descricao, pdv_id, data, meta, survey_id, observacoes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [tenantId, d.nome, d.descricao, d.pdvId, d.data, d.meta, d.surveyId, d.observacoes],
      );
      const eventId = inserted.rows[0].id;

      for (const promotorId of d.promotorIds) {
        await client.query(
          'INSERT INTO app.event_promoters (event_id, promotor_id, tenant_id) VALUES ($1,$2,$3)',
          [eventId, promotorId, tenantId],
        );
      }
      for (const productId of d.productIds ?? []) {
        await client.query(
          'INSERT INTO app.event_products (event_id, product_id, tenant_id) VALUES ($1,$2,$3)',
          [eventId, productId, tenantId],
        );
      }
      await client.query('COMMIT');
      return { id: eventId };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });

  res.status(201).json(event);
}));

eventsRouter.get('/events', requireRole('admin', 'gerente', 'supervisor'), asyncHandler(async (req, res) => {
  const { tenantId } = req.auth!;
  const rows = await withTenant(tenantId, async (client) => {
    const result = await client.query(
      `SELECT e.id, e.nome, to_char(e.data, 'YYYY-MM-DD') AS data, e.meta, p.nome AS pdv,
              count(DISTINCT er.id) AS total_resultados,
              COALESCE(sum(er.pessoas_abordadas), 0) AS total_pessoas_abordadas,
              COALESCE(sum(er.quantidade_distribuida), 0) AS total_distribuido
       FROM app.events e
       JOIN app.pdvs p ON p.id = e.pdv_id
       LEFT JOIN app.event_results er ON er.event_id = e.id
       WHERE e.tenant_id = $1
       GROUP BY e.id, p.nome
       ORDER BY e.data DESC`,
      [tenantId],
    );
    return result.rows;
  });
  res.json(rows);
}));

// Eventos em que o promotor logado está escalado (para ele ver na sua área e registrar resultado).
eventsRouter.get('/events/mine', asyncHandler(async (req, res) => {
  const { tenantId, userId } = req.auth!;
  const rows = await withTenant(tenantId, async (client) => {
    const result = await client.query(
      `SELECT e.id, e.nome, to_char(e.data, 'YYYY-MM-DD') AS data, e.meta, p.nome AS pdv, p.id AS pdv_id,
              EXISTS(SELECT 1 FROM app.event_results r WHERE r.event_id = e.id AND r.promotor_id = $2) AS ja_registrou
       FROM app.events e
       JOIN app.event_promoters ep ON ep.event_id = e.id
       JOIN app.pdvs p ON p.id = e.pdv_id
       WHERE e.tenant_id = $1 AND ep.promotor_id = $2
       ORDER BY e.data DESC`,
      [tenantId, userId],
    );
    return result.rows;
  });
  res.json(rows);
}));

eventsRouter.get('/events/:id', requireRole('admin', 'gerente', 'supervisor'), asyncHandler(async (req, res) => {
  const { tenantId } = req.auth!;
  const event = await withTenant(tenantId, async (client) => {
    const base = await client.query(
      `SELECT e.id, e.nome, e.descricao, to_char(e.data, 'YYYY-MM-DD') AS data, e.meta, e.observacoes, p.nome AS pdv
       FROM app.events e JOIN app.pdvs p ON p.id = e.pdv_id WHERE e.id = $1`,
      [req.params.id],
    );
    if (!base.rows[0]) return null;

    const [promotores, produtos, resultados] = await Promise.all([
      client.query(
        `SELECT u.id, u.nome FROM app.event_promoters ep JOIN app.users u ON u.id = ep.promotor_id WHERE ep.event_id = $1`,
        [req.params.id],
      ),
      client.query(
        `SELECT pr.id, pr.nome FROM app.event_products epr JOIN app.products pr ON pr.id = epr.product_id WHERE epr.event_id = $1`,
        [req.params.id],
      ),
      client.query(
        `SELECT r.id, r.pessoas_abordadas, r.degustacoes_realizadas, r.quantidade_distribuida, r.observacoes, u.nome AS promotor
         FROM app.event_results r JOIN app.users u ON u.id = r.promotor_id WHERE r.event_id = $1`,
        [req.params.id],
      ),
    ]);

    return { ...base.rows[0], promotores: promotores.rows, produtos: produtos.rows, resultados: resultados.rows };
  });
  if (!event) return res.status(404).json({ error: 'event_not_found' });
  res.json(event);
}));

const resultSchema = z.object({
  clientId: z.string().uuid(),
  pessoasAbordadas: z.number().int().nonnegative().optional(),
  degustacoesRealizadas: z.number().int().nonnegative().optional(),
  quantidadeDistribuida: z.number().int().nonnegative().optional(),
  observacoes: z.string().optional(),
});

// Promotor registra o resultado da ação — idempotente por clientId.
eventsRouter.post('/events/:id/results', asyncHandler(async (req, res) => {
  const { tenantId, userId } = req.auth!;
  const parsed = resultSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body', details: parsed.error.flatten() });
  const d = parsed.data;

  const result = await withTenant(tenantId, async (client) => {
    const inserted = await client.query(
      `INSERT INTO app.event_results (tenant_id, client_id, event_id, promotor_id, pessoas_abordadas, degustacoes_realizadas, quantidade_distribuida, observacoes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (client_id) DO NOTHING
       RETURNING id`,
      [tenantId, d.clientId, req.params.id, userId, d.pessoasAbordadas, d.degustacoesRealizadas, d.quantidadeDistribuida, d.observacoes],
    );
    if (inserted.rows[0]) return inserted.rows[0];
    const existing = await client.query('SELECT id FROM app.event_results WHERE client_id = $1', [d.clientId]);
    return existing.rows[0];
  });

  res.status(201).json(result);
}));
