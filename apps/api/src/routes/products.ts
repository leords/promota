import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/requireAuth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { withTenant } from '../db/pool.js';

export const productsRouter = Router();
productsRouter.use(requireAuth);

const productSchema = z.object({
  nome: z.string().min(1),
  marca: z.string().optional(),
  categoria: z.string().optional(),
  codigoInterno: z.string().optional(),
});

productsRouter.get('/products', asyncHandler(async (req, res) => {
  const { tenantId } = req.auth!;
  // Por padrão só produtos ativos (uso normal: promotor escolhendo produto para
  // coletar preço). A tela de gestão pede ?includeInactive=true para poder
  // reativar um produto — sem isso, inativar um produto o esconderia para sempre.
  const includeInactive = req.query.includeInactive === 'true';
  const rows = await withTenant(tenantId, async (client) => {
    const result = await client.query(
      `SELECT id, nome, marca, categoria, codigo_interno, ativo
       FROM app.products WHERE tenant_id = $1 ${includeInactive ? '' : 'AND ativo = true'} ORDER BY nome`,
      [tenantId],
    );
    return result.rows;
  });
  res.json(rows);
}));

productsRouter.post('/products', requireRole('admin', 'gerente'), asyncHandler(async (req, res) => {
  const { tenantId } = req.auth!;
  const parsed = productSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body', details: parsed.error.flatten() });
  const d = parsed.data;

  const product = await withTenant(tenantId, async (client) => {
    const result = await client.query(
      `INSERT INTO app.products (tenant_id, nome, marca, categoria, codigo_interno)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [tenantId, d.nome, d.marca, d.categoria, d.codigoInterno],
    );
    return result.rows[0];
  });

  res.status(201).json(product);
}));

productsRouter.patch('/products/:id', requireRole('admin', 'gerente'), asyncHandler(async (req, res) => {
  const { tenantId } = req.auth!;
  const schema = productSchema.partial().extend({ ativo: z.boolean().optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body' });
  const d = parsed.data;

  const updated = await withTenant(tenantId, async (client) => {
    const result = await client.query(
      `UPDATE app.products SET
         nome = COALESCE($2, nome), marca = COALESCE($3, marca),
         categoria = COALESCE($4, categoria), codigo_interno = COALESCE($5, codigo_interno),
         ativo = COALESCE($6, ativo)
       WHERE id = $1 RETURNING id`,
      [req.params.id, d.nome, d.marca, d.categoria, d.codigoInterno, d.ativo],
    );
    return result.rows[0];
  });
  if (!updated) return res.status(404).json({ error: 'product_not_found' });
  res.json(updated);
}));
