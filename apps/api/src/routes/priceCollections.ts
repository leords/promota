import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { withTenant } from '../db/pool.js';

export const priceCollectionsRouter = Router();
priceCollectionsRouter.use(requireAuth);

const priceSchema = z.object({
  clientId: z.string().uuid(),
  visitId: z.string().uuid(),
  productId: z.string().uuid(),
  marca: z.string().optional(),
  preco: z.number().positive(),
  concorrente: z.string().optional(),
  observacoes: z.string().optional(),
  coletadoEm: z.string().datetime().optional(),
});

priceCollectionsRouter.post('/price-collections', asyncHandler(async (req, res) => {
  const { tenantId, userId } = req.auth!;
  const parsed = priceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body', details: parsed.error.flatten() });
  const d = parsed.data;

  const collection = await withTenant(tenantId, async (client) => {
    const visit = await client.query('SELECT pdv_id FROM app.visits WHERE id = $1', [d.visitId]);
    if (!visit.rows[0]) return null;

    // ON CONFLICT DO NOTHING em vez de SELECT-então-INSERT: evita a mesma race
    // condition de idempotência corrigida em visits.ts (ver comentário lá e
    // docs/RISKS.md) — duas submissões concorrentes do mesmo clientId nunca
    // resultam em 500 nem em duplicata.
    const inserted = await client.query(
      `INSERT INTO app.price_collections (
         tenant_id, client_id, visit_id, pdv_id, promotor_id, product_id,
         marca, preco, concorrente, observacoes, coletado_em
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, COALESCE($11::timestamptz, now()))
       ON CONFLICT (client_id) DO NOTHING
       RETURNING id`,
      [tenantId, d.clientId, d.visitId, visit.rows[0].pdv_id, userId, d.productId, d.marca, d.preco, d.concorrente, d.observacoes, d.coletadoEm],
    );
    if (inserted.rows[0]) return inserted.rows[0];

    const existing = await client.query('SELECT id FROM app.price_collections WHERE client_id = $1', [d.clientId]);
    return existing.rows[0];
  });

  if (!collection) return res.status(404).json({ error: 'visit_not_found' });
  res.status(201).json(collection);
}));

// Análises (Seção 10): média por PDV/região, evolução no tempo — filtráveis por produto/período.
priceCollectionsRouter.get('/price-collections', asyncHandler(async (req, res) => {
  const { tenantId } = req.auth!;
  const { productId, pdvId, de, ate } = req.query;

  const conditions: string[] = [];
  const params: unknown[] = [tenantId];
  if (productId) { params.push(productId); conditions.push(`product_id = $${params.length}`); }
  if (pdvId) { params.push(pdvId); conditions.push(`pdv_id = $${params.length}`); }
  if (de) { params.push(de); conditions.push(`coletado_em >= $${params.length}`); }
  if (ate) { params.push(ate); conditions.push(`coletado_em <= $${params.length}`); }
  const where = conditions.length ? `AND ${conditions.join(' AND ')}` : '';

  const rows = await withTenant(tenantId, async (client) => {
    const result = await client.query(
      `SELECT pc.id, pc.preco, pc.marca, pc.concorrente, pc.coletado_em,
              p.nome AS produto, pdv.nome AS pdv, pdv.cidade
       FROM app.price_collections pc
       JOIN app.products p ON p.id = pc.product_id
       JOIN app.pdvs pdv ON pdv.id = pc.pdv_id
       WHERE pc.tenant_id = $1 ${where}
       ORDER BY pc.coletado_em DESC LIMIT 500`,
      params,
    );
    return result.rows;
  });

  res.json(rows);
}));
