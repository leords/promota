import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/requireAuth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { withTenant } from '../db/pool.js';

export const pdvsRouter = Router();
pdvsRouter.use(requireAuth);

const pdvSchema = z.object({
  nome: z.string().min(1),
  razaoSocial: z.string().optional(),
  tipoEstabelecimento: z.string().optional(),
  rede: z.string().optional(),
  logradouro: z.string().optional(),
  numero: z.string().optional(),
  complemento: z.string().optional(),
  bairro: z.string().optional(),
  cidade: z.string().optional(),
  uf: z.string().length(2).optional(),
  cep: z.string().optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  telefone: z.string().optional(),
  email: z.string().email().optional(),
  contatoResponsavel: z.string().optional(),
  promotorResponsavelId: z.string().uuid().optional(),
  observacoes: z.string().optional(),
  frequenciaEsperadaDias: z.number().int().positive().optional(),
  notificarEmail: z.boolean().optional(),
});

// Lista com filtros — Seção 5 do briefing: região/cidade/bairro/rede/tipo/promotor/status.
pdvsRouter.get('/pdvs', asyncHandler(async (req, res) => {
  const { tenantId } = req.auth!;
  const { cidade, bairro, rede, tipo, promotorId, ativo } = req.query;

  const conditions: string[] = [];
  const params: unknown[] = [];
  const addFilter = (column: string, value: unknown) => {
    params.push(value);
    conditions.push(`${column} = $${params.length}`);
  };
  if (cidade) addFilter('cidade', cidade);
  if (bairro) addFilter('bairro', bairro);
  if (rede) addFilter('rede', rede);
  if (tipo) addFilter('tipo_estabelecimento', tipo);
  if (promotorId) addFilter('promotor_responsavel_id', promotorId);
  if (ativo !== undefined) addFilter('ativo', ativo === 'true');

  const where = conditions.length ? `AND ${conditions.join(' AND ')}` : '';

  const rows = await withTenant(tenantId, async (client) => {
    const result = await client.query(
      `SELECT id, nome, razao_social, tipo_estabelecimento, rede, cidade, bairro, uf,
              telefone, email, promotor_responsavel_id, ativo, notificar_email,
              ST_Y(geom::geometry) AS latitude, ST_X(geom::geometry) AS longitude
       FROM app.pdvs
       WHERE tenant_id = $1 ${where}
       ORDER BY nome`,
      [tenantId, ...params],
    );
    return result.rows;
  });

  res.json(rows);
}));

pdvsRouter.get('/pdvs/:id', asyncHandler(async (req, res) => {
  const { tenantId } = req.auth!;
  const pdv = await withTenant(tenantId, async (client) => {
    const result = await client.query(
      `SELECT id, nome, razao_social, tipo_estabelecimento, rede, logradouro, numero,
              complemento, bairro, cidade, uf, cep, telefone, email, contato_responsavel,
              promotor_responsavel_id, observacoes, ativo, frequencia_esperada_dias, notificar_email,
              ST_Y(geom::geometry) AS latitude, ST_X(geom::geometry) AS longitude
       FROM app.pdvs WHERE id = $1`,
      [req.params.id],
    );
    return result.rows[0];
  });
  if (!pdv) return res.status(404).json({ error: 'pdv_not_found' });

  // Visão 360º (Seção 5): últimas visitas, fotos, preços, ocorrências.
  const [ultimasVisitas, precos] = await withTenant(tenantId, (client) =>
    Promise.all([
      client.query(
        `SELECT v.id, v.checkin_em, v.checkout_em, v.duracao_segundos, u.nome AS promotor
         FROM app.visits v JOIN app.users u ON u.id = v.promotor_id
         WHERE v.pdv_id = $1 ORDER BY v.checkin_em DESC LIMIT 10`,
        [req.params.id],
      ),
      client.query(
        `SELECT pc.id, pc.preco, pc.marca, pc.concorrente, pc.coletado_em, p.nome AS produto
         FROM app.price_collections pc JOIN app.products p ON p.id = pc.product_id
         WHERE pc.pdv_id = $1 ORDER BY pc.coletado_em DESC LIMIT 20`,
        [req.params.id],
      ),
    ]),
  );

  res.json({ ...pdv, ultimasVisitas: ultimasVisitas.rows, precos: precos.rows });
}));

pdvsRouter.post('/pdvs', requireRole('admin', 'gerente'), asyncHandler(async (req, res) => {
  const { tenantId } = req.auth!;
  const parsed = pdvSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body', details: parsed.error.flatten() });
  const d = parsed.data;

  const pdv = await withTenant(tenantId, async (client) => {
    const result = await client.query(
      `INSERT INTO app.pdvs (
         tenant_id, nome, razao_social, tipo_estabelecimento, rede, logradouro, numero,
         complemento, bairro, cidade, uf, cep, telefone, email, contato_responsavel,
         promotor_responsavel_id, observacoes, frequencia_esperada_dias, notificar_email, geom
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,COALESCE($19, false),
         CASE WHEN $20::double precision IS NOT NULL AND $21::double precision IS NOT NULL
              THEN ST_SetSRID(ST_MakePoint($21, $20), 4326)::geography END)
       RETURNING id`,
      [
        tenantId, d.nome, d.razaoSocial, d.tipoEstabelecimento, d.rede, d.logradouro, d.numero,
        d.complemento, d.bairro, d.cidade, d.uf, d.cep, d.telefone, d.email, d.contatoResponsavel,
        d.promotorResponsavelId, d.observacoes, d.frequenciaEsperadaDias, d.notificarEmail, d.latitude, d.longitude,
      ],
    );
    return result.rows[0];
  });

  res.status(201).json(pdv);
}));

pdvsRouter.patch('/pdvs/:id', requireRole('admin', 'gerente'), asyncHandler(async (req, res) => {
  const { tenantId } = req.auth!;
  const parsed = pdvSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body', details: parsed.error.flatten() });
  const d = parsed.data;

  const updated = await withTenant(tenantId, async (client) => {
    const result = await client.query(
      `UPDATE app.pdvs SET
         nome = COALESCE($2, nome),
         razao_social = COALESCE($3, razao_social),
         tipo_estabelecimento = COALESCE($4, tipo_estabelecimento),
         rede = COALESCE($5, rede),
         cidade = COALESCE($6, cidade),
         bairro = COALESCE($7, bairro),
         promotor_responsavel_id = COALESCE($8, promotor_responsavel_id),
         observacoes = COALESCE($9, observacoes),
         frequencia_esperada_dias = COALESCE($10, frequencia_esperada_dias),
         notificar_email = COALESCE($11, notificar_email),
         geom = CASE WHEN $12::double precision IS NOT NULL AND $13::double precision IS NOT NULL
                     THEN ST_SetSRID(ST_MakePoint($13, $12), 4326)::geography ELSE geom END
       WHERE id = $1
       RETURNING id`,
      [req.params.id, d.nome, d.razaoSocial, d.tipoEstabelecimento, d.rede, d.cidade, d.bairro, d.promotorResponsavelId, d.observacoes, d.frequenciaEsperadaDias, d.notificarEmail, d.latitude, d.longitude],
    );
    return result.rows[0];
  });

  if (!updated) return res.status(404).json({ error: 'pdv_not_found' });
  res.json(updated);
}));

pdvsRouter.patch('/pdvs/:id/status', requireRole('admin', 'gerente'), asyncHandler(async (req, res) => {
  const { tenantId } = req.auth!;
  const schema = z.object({ ativo: z.boolean() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body' });

  const updated = await withTenant(tenantId, async (client) => {
    const result = await client.query(
      'UPDATE app.pdvs SET ativo = $2 WHERE id = $1 RETURNING id, ativo',
      [req.params.id, parsed.data.ativo],
    );
    return result.rows[0];
  });
  if (!updated) return res.status(404).json({ error: 'pdv_not_found' });
  res.json(updated);
}));
