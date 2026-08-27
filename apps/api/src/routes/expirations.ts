import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/requireAuth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { withTenant } from '../db/pool.js';
import { notifyCriticalExpiration } from '../services/notifications.js';

export const expirationsRouter = Router();
expirationsRouter.use(requireAuth);

const createSchema = z.object({
  clientId: z.string().uuid(),
  pdvId: z.string().uuid(),
  productId: z.string().uuid(),
  quantidade: z.number().int().positive(),
  dataValidade: z.string().date(),
  observacoes: z.string().optional(),
});

// Promotor registra durante a visita — idempotente por clientId (mesmo padrão de
// visits/photos/occurrences, ver docs/RISKS.md sobre a race condition já corrigida).
expirationsRouter.post('/expirations', asyncHandler(async (req, res) => {
  const { tenantId, userId } = req.auth!;
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body', details: parsed.error.flatten() });
  const d = parsed.data;

  const record = await withTenant(tenantId, async (client) => {
    const inserted = await client.query(
      `INSERT INTO app.expiration_records (tenant_id, client_id, pdv_id, promotor_id, product_id, quantidade, data_validade, observacoes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (client_id) DO NOTHING
       RETURNING id, (data_validade - CURRENT_DATE) AS dias_restantes`,
      [tenantId, d.clientId, d.pdvId, userId, d.productId, d.quantidade, d.dataValidade, d.observacoes],
    );
    if (inserted.rows[0]) return inserted.rows[0];
    const existing = await client.query(
      'SELECT id, (data_validade - CURRENT_DATE) AS dias_restantes FROM app.expiration_records WHERE client_id = $1',
      [d.clientId],
    );
    return existing.rows[0];
  });

  // Notificação nunca bloqueia a resposta ao promotor (Seção 14) — dispara numa
  // conexão própria e trata qualquer falha aqui mesmo, para nunca virar uma
  // unhandledRejection (isso já derrubou o processo inteiro uma vez, ver
  // docs/DECISIONS.md/CLAUDE.md sobre asyncHandler).
  withTenant(tenantId, async (client) => {
    const settings = await client.query('SELECT dias_critico FROM app.expiration_settings WHERE tenant_id = $1', [tenantId]);
    const diasCritico = settings.rows[0]?.dias_critico ?? 7;
    if (record.dias_restantes <= diasCritico) {
      await notifyCriticalExpiration(client, tenantId, record.id);
    }
  }).catch((err) => console.error('Falha ao notificar validade crítica:', err));

  res.status(201).json(record);
}));

// Limiares de classificação da empresa (Seção 14 — configuráveis, não fixos).
expirationsRouter.get('/expirations/settings', requireRole('admin', 'gerente'), asyncHandler(async (req, res) => {
  const { tenantId } = req.auth!;
  const settings = await withTenant(tenantId, async (client) => {
    const result = await client.query('SELECT dias_critico, dias_atencao FROM app.expiration_settings WHERE tenant_id = $1', [tenantId]);
    return result.rows[0] ?? { dias_critico: 7, dias_atencao: 30 };
  });
  res.json(settings);
}));

const settingsSchema = z.object({ diasCritico: z.number().int().positive(), diasAtencao: z.number().int().positive() });

expirationsRouter.put('/expirations/settings', requireRole('admin', 'gerente'), asyncHandler(async (req, res) => {
  const { tenantId } = req.auth!;
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body' });

  await withTenant(tenantId, (client) =>
    client.query(
      `INSERT INTO app.expiration_settings (tenant_id, dias_critico, dias_atencao)
       VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id) DO UPDATE SET dias_critico = $2, dias_atencao = $3`,
      [tenantId, parsed.data.diasCritico, parsed.data.diasAtencao],
    ),
  );
  res.json(parsed.data);
}));

// Lista classificada 🔴/🟡/🟢 (Seção 14) — para a tela de gestão e o dashboard.
expirationsRouter.get('/expirations', requireRole('admin', 'gerente', 'supervisor'), asyncHandler(async (req, res) => {
  const { tenantId } = req.auth!;
  const rows = await withTenant(tenantId, async (client) => {
    const settings = await client.query(
      'SELECT dias_critico, dias_atencao FROM app.expiration_settings WHERE tenant_id = $1',
      [tenantId],
    );
    const { dias_critico: diasCritico, dias_atencao: diasAtencao } = settings.rows[0] ?? { dias_critico: 7, dias_atencao: 30 };

    const result = await client.query(
      `SELECT e.id, e.quantidade, to_char(e.data_validade, 'YYYY-MM-DD') AS data_validade, e.observacoes, e.criado_em,
              p.nome AS pdv, pr.nome AS produto,
              (e.data_validade - CURRENT_DATE) AS dias_restantes,
              CASE
                WHEN (e.data_validade - CURRENT_DATE) <= $2 THEN 'critico'
                WHEN (e.data_validade - CURRENT_DATE) <= $3 THEN 'atencao'
                ELSE 'regular'
              END AS classificacao
       FROM app.expiration_records e
       JOIN app.pdvs p ON p.id = e.pdv_id
       JOIN app.products pr ON pr.id = e.product_id
       WHERE e.tenant_id = $1
       ORDER BY e.data_validade ASC
       LIMIT 200`,
      [tenantId, diasCritico, diasAtencao],
    );
    return result.rows;
  });
  res.json(rows);
}));
