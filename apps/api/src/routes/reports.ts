import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/requireAuth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { withTenant } from '../db/pool.js';
import { toCsv, sendCsv } from '../services/csv.js';

export const reportsRouter = Router();
// Middleware vai direto em cada rota, não em router.use() — ver comentário em dashboard.ts sobre por que router.use(mw) sem caminho vaza para outros routers montados depois na cadeia do app.

// Relatório de visitas (Seção 18) — respeita filtros de período/PDV/promotor e o
// isolamento por tenant (RLS via withTenant, igual a qualquer outra rota).
reportsRouter.get('/reports/visits.csv', requireAuth, requireRole('admin', 'gerente', 'supervisor'), asyncHandler(async (req, res) => {
  const { tenantId } = req.auth!;
  const { de, ate, pdvId, promotorId } = req.query;
  const conditions: string[] = [];
  const params: unknown[] = [tenantId];
  if (de) { params.push(de); conditions.push(`v.checkin_em >= $${params.length}`); }
  if (ate) { params.push(ate); conditions.push(`v.checkin_em <= $${params.length}`); }
  if (pdvId) { params.push(pdvId); conditions.push(`v.pdv_id = $${params.length}`); }
  if (promotorId) { params.push(promotorId); conditions.push(`v.promotor_id = $${params.length}`); }
  const where = conditions.length ? `AND ${conditions.join(' AND ')}` : '';

  const rows = await withTenant(tenantId, async (client) => {
    const result = await client.query(
      `SELECT p.nome AS pdv, p.cidade, u.nome AS promotor, v.checkin_em, v.checkout_em,
              v.duracao_segundos, v.checkin_distancia_m, v.justificativa
       FROM app.visits v
       JOIN app.pdvs p ON p.id = v.pdv_id
       JOIN app.users u ON u.id = v.promotor_id
       WHERE v.tenant_id = $1 ${where}
       ORDER BY v.checkin_em DESC`,
      params,
    );
    return result.rows;
  });

  const csv = toCsv(rows, [
    { key: 'pdv', header: 'PDV' },
    { key: 'cidade', header: 'Cidade' },
    { key: 'promotor', header: 'Promotor' },
    { key: 'checkin_em', header: 'Check-in' },
    { key: 'checkout_em', header: 'Check-out' },
    { key: 'duracao_segundos', header: 'Duração (segundos)' },
    { key: 'checkin_distancia_m', header: 'Distância do check-in (m)' },
    { key: 'justificativa', header: 'Justificativa' },
  ]);
  sendCsv(res, 'visitas.csv', csv);
}));

reportsRouter.get('/reports/occurrences.csv', requireAuth, requireRole('admin', 'gerente', 'supervisor'), asyncHandler(async (req, res) => {
  const { tenantId } = req.auth!;
  const rows = await withTenant(tenantId, async (client) => {
    const result = await client.query(
      `SELECT p.nome AS pdv, u.nome AS promotor, o.tipo, o.descricao, o.prioridade, o.status, o.criado_em
       FROM app.occurrences o
       JOIN app.pdvs p ON p.id = o.pdv_id
       JOIN app.users u ON u.id = o.promotor_id
       WHERE o.tenant_id = $1
       ORDER BY o.criado_em DESC`,
      [tenantId],
    );
    return result.rows;
  });

  const csv = toCsv(rows, [
    { key: 'pdv', header: 'PDV' },
    { key: 'promotor', header: 'Promotor' },
    { key: 'tipo', header: 'Tipo' },
    { key: 'descricao', header: 'Descrição' },
    { key: 'prioridade', header: 'Prioridade' },
    { key: 'status', header: 'Status' },
    { key: 'criado_em', header: 'Data' },
  ]);
  sendCsv(res, 'ocorrencias.csv', csv);
}));

// Relatório por PDV (Seção 5/18) — frequência de visitas, último atendimento, preços.
reportsRouter.get('/reports/pdvs.csv', requireAuth, requireRole('admin', 'gerente', 'supervisor'), asyncHandler(async (req, res) => {
  const { tenantId } = req.auth!;
  const rows = await withTenant(tenantId, async (client) => {
    const result = await client.query(
      `SELECT p.nome, p.cidade, p.bairro, p.rede, p.ativo,
              count(DISTINCT v.id) AS total_visitas,
              max(v.checkin_em) AS ultima_visita,
              count(DISTINCT o.id) FILTER (WHERE o.status != 'resolvida') AS ocorrencias_abertas
       FROM app.pdvs p
       LEFT JOIN app.visits v ON v.pdv_id = p.id
       LEFT JOIN app.occurrences o ON o.pdv_id = p.id
       WHERE p.tenant_id = $1
       GROUP BY p.id
       ORDER BY p.nome`,
      [tenantId],
    );
    return result.rows;
  });

  const csv = toCsv(rows, [
    { key: 'nome', header: 'Nome' },
    { key: 'cidade', header: 'Cidade' },
    { key: 'bairro', header: 'Bairro' },
    { key: 'rede', header: 'Rede' },
    { key: 'ativo', header: 'Ativo' },
    { key: 'total_visitas', header: 'Total de visitas' },
    { key: 'ultima_visita', header: 'Última visita' },
    { key: 'ocorrencias_abertas', header: 'Ocorrências abertas' },
  ]);
  sendCsv(res, 'pdvs.csv', csv);
}));

reportsRouter.get('/reports/price-collections.csv', requireAuth, requireRole('admin', 'gerente', 'supervisor'), asyncHandler(async (req, res) => {
  const { tenantId } = req.auth!;
  const rows = await withTenant(tenantId, async (client) => {
    const result = await client.query(
      `SELECT p.nome AS pdv, p.cidade, pr.nome AS produto, pc.marca, pc.preco, pc.concorrente, pc.coletado_em
       FROM app.price_collections pc
       JOIN app.pdvs p ON p.id = pc.pdv_id
       JOIN app.products pr ON pr.id = pc.product_id
       WHERE pc.tenant_id = $1
       ORDER BY pc.coletado_em DESC`,
      [tenantId],
    );
    return result.rows;
  });

  const csv = toCsv(rows, [
    { key: 'pdv', header: 'PDV' },
    { key: 'cidade', header: 'Cidade' },
    { key: 'produto', header: 'Produto' },
    { key: 'marca', header: 'Marca' },
    { key: 'preco', header: 'Preço' },
    { key: 'concorrente', header: 'Concorrente' },
    { key: 'coletado_em', header: 'Data da coleta' },
  ]);
  sendCsv(res, 'precos.csv', csv);
}));
