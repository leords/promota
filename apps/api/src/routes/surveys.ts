import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/requireAuth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { withTenant } from '../db/pool.js';

export const surveysRouter = Router();
surveysRouter.use(requireAuth);

const QUESTION_TYPES = ['texto', 'numero', 'sim_nao', 'multipla_escolha', 'selecao_unica', 'nota', 'foto'] as const;

const createSurveySchema = z.object({
  nome: z.string().min(1),
  descricao: z.string().optional(),
  disponivelDe: z.string().date().optional(),
  disponivelAte: z.string().date().optional(),
});

surveysRouter.post('/surveys', requireRole('admin', 'gerente'), asyncHandler(async (req, res) => {
  const { tenantId } = req.auth!;
  const parsed = createSurveySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body', details: parsed.error.flatten() });
  const d = parsed.data;

  const survey = await withTenant(tenantId, async (client) => {
    const result = await client.query(
      `INSERT INTO app.surveys (tenant_id, nome, descricao, disponivel_de, disponivel_ate)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [tenantId, d.nome, d.descricao, d.disponivelDe, d.disponivelAte],
    );
    return result.rows[0];
  });
  res.status(201).json(survey);
}));

surveysRouter.get('/surveys', requireRole('admin', 'gerente', 'supervisor'), asyncHandler(async (req, res) => {
  const { tenantId } = req.auth!;
  const rows = await withTenant(tenantId, async (client) => {
    const result = await client.query(
      `SELECT s.id, s.nome, s.status, s.disponivel_de, s.disponivel_ate,
              count(DISTINCT q.id) AS total_perguntas, count(DISTINCT r.id) AS total_respostas
       FROM app.surveys s
       LEFT JOIN app.survey_questions q ON q.survey_id = s.id
       LEFT JOIN app.survey_responses r ON r.survey_id = s.id
       WHERE s.tenant_id = $1
       GROUP BY s.id ORDER BY s.criado_em DESC`,
      [tenantId],
    );
    return result.rows;
  });
  res.json(rows);
}));

// Pesquisas que o promotor pode responder agora — ativa e dentro do período, se
// definido (Seção 11: sem targeting por rota/PDV ainda, ver docs/DECISIONS.md).
surveysRouter.get('/surveys/active', asyncHandler(async (req, res) => {
  const { tenantId } = req.auth!;
  const rows = await withTenant(tenantId, async (client) => {
    const result = await client.query(
      `SELECT id, nome, descricao FROM app.surveys
       WHERE tenant_id = $1 AND status = 'ativa'
         AND (disponivel_de IS NULL OR disponivel_de <= CURRENT_DATE)
         AND (disponivel_ate IS NULL OR disponivel_ate >= CURRENT_DATE)
       ORDER BY criado_em DESC`,
      [tenantId],
    );
    return result.rows;
  });
  res.json(rows);
}));

surveysRouter.get('/surveys/:id', asyncHandler(async (req, res) => {
  const { tenantId } = req.auth!;
  const survey = await withTenant(tenantId, async (client) => {
    const surveyResult = await client.query(
      'SELECT id, nome, descricao, status, disponivel_de, disponivel_ate FROM app.surveys WHERE id = $1',
      [req.params.id],
    );
    if (!surveyResult.rows[0]) return null;
    const questions = await client.query(
      `SELECT id, ordem, tipo, texto, obrigatoria, opcoes
       FROM app.survey_questions WHERE survey_id = $1 ORDER BY ordem`,
      [req.params.id],
    );
    return { ...surveyResult.rows[0], questions: questions.rows };
  });
  if (!survey) return res.status(404).json({ error: 'survey_not_found' });
  res.json(survey);
}));

const statusSchema = z.object({ status: z.enum(['rascunho', 'ativa', 'encerrada']) });

surveysRouter.patch('/surveys/:id/status', requireRole('admin', 'gerente'), asyncHandler(async (req, res) => {
  const { tenantId } = req.auth!;
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body' });

  const updated = await withTenant(tenantId, async (client) => {
    const result = await client.query(
      'UPDATE app.surveys SET status = $2 WHERE id = $1 RETURNING id, status',
      [req.params.id, parsed.data.status],
    );
    return result.rows[0];
  });
  if (!updated) return res.status(404).json({ error: 'survey_not_found' });
  res.json(updated);
}));

const questionSchema = z.object({
  tipo: z.enum(QUESTION_TYPES),
  texto: z.string().min(1),
  obrigatoria: z.boolean().optional(),
  opcoes: z.array(z.string()).optional(),
});

surveysRouter.post('/surveys/:id/questions', requireRole('admin', 'gerente'), asyncHandler(async (req, res) => {
  const { tenantId } = req.auth!;
  const parsed = questionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body', details: parsed.error.flatten() });
  const d = parsed.data;

  const question = await withTenant(tenantId, async (client) => {
    const survey = await client.query('SELECT id FROM app.surveys WHERE id = $1', [req.params.id]);
    if (!survey.rows[0]) return null;

    const ordem = await client.query('SELECT COALESCE(max(ordem), -1) + 1 AS proxima FROM app.survey_questions WHERE survey_id = $1', [req.params.id]);
    const result = await client.query(
      `INSERT INTO app.survey_questions (tenant_id, survey_id, ordem, tipo, texto, obrigatoria, opcoes)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [tenantId, req.params.id, ordem.rows[0].proxima, d.tipo, d.texto, d.obrigatoria ?? true, d.opcoes ? JSON.stringify(d.opcoes) : null],
    );
    return result.rows[0];
  });
  if (!question) return res.status(404).json({ error: 'survey_not_found' });
  res.status(201).json(question);
}));

surveysRouter.delete('/surveys/questions/:id', requireRole('admin', 'gerente'), asyncHandler(async (req, res) => {
  const { tenantId } = req.auth!;
  const deleted = await withTenant(tenantId, async (client) => {
    const result = await client.query('DELETE FROM app.survey_questions WHERE id = $1 RETURNING id', [req.params.id]);
    return result.rows[0];
  });
  if (!deleted) return res.status(404).json({ error: 'question_not_found' });
  res.status(204).end();
}));

const answerSchema = z.object({ questionId: z.string().uuid(), valor: z.string() });
const submitResponseSchema = z.object({
  clientId: z.string().uuid(),
  surveyId: z.string().uuid(),
  pdvId: z.string().uuid(),
  visitId: z.string().uuid().optional(),
  answers: z.array(answerSchema).min(1),
});

// Promotor responde — idempotente por clientId (mesmo padrão de visits/photos/etc,
// ver docs/RISKS.md).
surveysRouter.post('/survey-responses', asyncHandler(async (req, res) => {
  const { tenantId, userId } = req.auth!;
  const parsed = submitResponseSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body', details: parsed.error.flatten() });
  const d = parsed.data;

  const response = await withTenant(tenantId, async (client) => {
    const existing = await client.query('SELECT id FROM app.survey_responses WHERE client_id = $1', [d.clientId]);
    if (existing.rows[0]) return existing.rows[0];

    await client.query('BEGIN');
    try {
      const inserted = await client.query(
        `INSERT INTO app.survey_responses (tenant_id, client_id, survey_id, pdv_id, promotor_id, visit_id)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [tenantId, d.clientId, d.surveyId, d.pdvId, userId, d.visitId],
      );
      const responseId = inserted.rows[0].id;
      for (const answer of d.answers) {
        await client.query(
          `INSERT INTO app.survey_answers (tenant_id, response_id, question_id, valor) VALUES ($1,$2,$3,$4)`,
          [tenantId, responseId, answer.questionId, answer.valor],
        );
      }
      await client.query('COMMIT');
      return { id: responseId };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });

  res.status(201).json(response);
}));

// Análise (Seção 11): respostas de uma pesquisa, para a tela de gestão gerar
// visualizações por tipo de pergunta.
surveysRouter.get('/surveys/:id/responses', requireRole('admin', 'gerente', 'supervisor'), asyncHandler(async (req, res) => {
  const { tenantId } = req.auth!;
  const rows = await withTenant(tenantId, async (client) => {
    const result = await client.query(
      `SELECT r.id AS response_id, r.criado_em, p.nome AS pdv, u.nome AS promotor,
              a.question_id, a.valor, q.texto AS pergunta, q.tipo
       FROM app.survey_responses r
       JOIN app.pdvs p ON p.id = r.pdv_id
       JOIN app.users u ON u.id = r.promotor_id
       JOIN app.survey_answers a ON a.response_id = r.id
       JOIN app.survey_questions q ON q.id = a.question_id
       WHERE r.tenant_id = $1 AND r.survey_id = $2
       ORDER BY r.criado_em DESC, q.ordem`,
      [tenantId, req.params.id],
    );
    return result.rows;
  });
  res.json(rows);
}));
