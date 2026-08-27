import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/requireAuth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { withTenant } from '../db/pool.js';

export const dashboardRouter = Router();

// Seção 16 — "O que merece atenção hoje?" + visão operacional do dia. Deliberadamente
// NÃO inclui nenhum ranking de promotor por volume (proibido pelo briefing) — os
// números aqui são agregados operacionais, não avaliação individual.
//
// IMPORTANTE: middleware vai direto na rota (não em `dashboardRouter.use(...)`) —
// `router.use(mw)` sem caminho casa com QUALQUER path que passe por este router na
// cadeia do app, não só as rotas que ele declara. Isso já causou um bug real: com
// `.use(requireRole(...))` aqui, promotores levavam 403 em rotas de OUTROS routers
// montados depois deste em index.ts (ex.: GET /surveys/active, GET /events/mine),
// porque o middleware "vazava" para toda a cadeia. Ver CLAUDE.md.
dashboardRouter.get('/dashboard/today', requireAuth, requireRole('admin', 'gerente', 'supervisor'), asyncHandler(async (req, res) => {
  const { tenantId } = req.auth!;
  const date = typeof req.query.data === 'string' ? req.query.data : new Date().toISOString().slice(0, 10);

  const result = await withTenant(tenantId, async (client) => {
    const operacional = await client.query(
      `SELECT
         count(DISTINCT r.promotor_id) AS promotores_programados,
         count(DISTINCT r.promotor_id) FILTER (
           WHERE EXISTS (SELECT 1 FROM app.visits v WHERE v.promotor_id = r.promotor_id AND v.checkin_em::date = $2)
         ) AS promotores_que_trabalharam,
         count(rp.id) AS pdvs_planejados,
         count(rp.id) FILTER (WHERE rp.status = 'concluido') AS pdvs_atendidos,
         count(rp.id) FILTER (WHERE rp.status = 'nao_atendido') AS pdvs_nao_atendidos,
         count(rp.id) FILTER (WHERE rp.status IN ('pendente', 'em_atendimento')) AS pdvs_pendentes,
         count(r.id) FILTER (WHERE r.status != 'concluida') AS rotas_pendentes
       FROM app.routes r
       LEFT JOIN app.route_pdvs rp ON rp.route_id = r.id
       WHERE r.tenant_id = $1 AND r.data = $2`,
      [tenantId, date],
    );

    const tempoMedio = await client.query(
      `SELECT avg(duracao_segundos) AS media_segundos
       FROM app.visits WHERE tenant_id = $1 AND checkin_em::date = $2 AND duracao_segundos IS NOT NULL`,
      [tenantId, date],
    );

    const ocorrenciasAbertas = await client.query(
      `SELECT count(*) AS total FROM app.occurrences WHERE tenant_id = $1 AND status != 'resolvida'`,
      [tenantId],
    );

    // Produtos próximos do vencimento (Seção 14/16) — usa os mesmos limiares
    // configuráveis por tenant do módulo de validades (ver routes/expirations.ts).
    const expSettings = await client.query(
      'SELECT dias_critico FROM app.expiration_settings WHERE tenant_id = $1',
      [tenantId],
    );
    const diasCritico = expSettings.rows[0]?.dias_critico ?? 7;
    const produtosCriticos = await client.query(
      `SELECT count(*) AS total FROM app.expiration_records
       WHERE tenant_id = $1 AND (data_validade - CURRENT_DATE) <= $2`,
      [tenantId, diasCritico],
    );

    // Promotores com rota hoje mas nenhum check-in ainda — "ainda não iniciaram atividades".
    const promotoresSemAtividade = await client.query(
      `SELECT DISTINCT u.id, u.nome
       FROM app.routes r JOIN app.users u ON u.id = r.promotor_id
       WHERE r.tenant_id = $1 AND r.data = $2
         AND NOT EXISTS (SELECT 1 FROM app.visits v WHERE v.promotor_id = r.promotor_id AND v.checkin_em::date = $2)`,
      [tenantId, date],
    );

    // Detector de PDVs sem cobertura (Seção 17): só considera PDVs com frequência
    // esperada configurada — sem isso não há como dizer "atrasado" de forma justa.
    const pdvsSemCobertura = await client.query(
      `SELECT p.id, p.nome, p.frequencia_esperada_dias,
              ultima.checkin_em AS ultima_visita,
              COALESCE(now() - ultima.checkin_em, now() - p.criado_em) AS tempo_sem_visita
       FROM app.pdvs p
       LEFT JOIN LATERAL (
         SELECT checkin_em FROM app.visits WHERE pdv_id = p.id ORDER BY checkin_em DESC LIMIT 1
       ) ultima ON true
       WHERE p.tenant_id = $1 AND p.ativo = true AND p.frequencia_esperada_dias IS NOT NULL
         AND COALESCE(ultima.checkin_em, p.criado_em) < now() - (p.frequencia_esperada_dias || ' days')::interval
       ORDER BY tempo_sem_visita DESC
       LIMIT 20`,
      [tenantId],
    );

    return {
      operacional: operacional.rows[0],
      tempoMedioSegundos: tempoMedio.rows[0]?.media_segundos ? Number(tempoMedio.rows[0].media_segundos) : null,
      ocorrenciasAbertas: Number(ocorrenciasAbertas.rows[0].total),
      produtosCriticos: Number(produtosCriticos.rows[0].total),
      promotoresSemAtividade: promotoresSemAtividade.rows,
      pdvsSemCobertura: pdvsSemCobertura.rows,
    };
  });

  res.json(result);
}));
