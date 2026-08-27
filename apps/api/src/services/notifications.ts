import type { PoolClient } from 'pg';
import { sendEmail } from './email.js';

interface Recipient {
  email: string;
  userId?: string;
}

/**
 * Registra e envia uma notificação — sempre grava em app.notifications primeiro
 * (isso já é a "notificação dentro do sistema" da Seção 14), e só então tenta o
 * canal externo (e-mail). A gravação usa ON CONFLICT DO NOTHING como guarda
 * atômica: se duas chamadas concorrentes tentarem notificar o mesmo
 * (tipo, referência, destinatário), só uma reserva a linha e manda o e-mail — a
 * mesma técnica de INSERT-atômico já usada para idempotência de check-in/foto/etc.
 * (ver docs/RISKS.md), aplicada aqui para nunca mandar o mesmo aviso duas vezes.
 */
async function notifyOnce(
  client: PoolClient,
  tenantId: string,
  params: { tipo: string; referenciaTabela: string; referenciaId: string; recipient: Recipient; assunto: string; html: string },
): Promise<void> {
  // Postgres não consegue inferir automaticamente qual dos dois índices únicos
  // parciais (ver data/schema_05_notificacoes.sql) usar quando o conflict target é
  // omitido — precisa apontar exatamente para o índice certo, incluindo o WHERE
  // dele, ou dá erro 42P10 ("could not infer arbiter"). Descoberto testando de
  // verdade, não hipotético.
  const conflictClause = params.recipient.userId
    ? `ON CONFLICT (tipo, referencia_tabela, referencia_id, destinatario_user_id) WHERE destinatario_user_id IS NOT NULL DO NOTHING`
    : `ON CONFLICT (tipo, referencia_tabela, referencia_id, destinatario_email) WHERE destinatario_user_id IS NULL DO NOTHING`;

  const reserved = await client.query(
    `INSERT INTO app.notifications (tenant_id, tipo, referencia_tabela, referencia_id, destinatario_email, destinatario_user_id, canal, status, assunto)
     VALUES ($1,$2,$3,$4,$5,$6,'email','enviada',$7)
     ${conflictClause}
     RETURNING id`,
    [tenantId, params.tipo, params.referenciaTabela, params.referenciaId, params.recipient.email, params.recipient.userId ?? null, params.assunto],
  );
  const notificationId = reserved.rows[0]?.id;
  if (!notificationId) return; // já notificado antes para este destinatário/evento

  try {
    const { sent } = await sendEmail({ to: params.recipient.email, subject: params.assunto, html: params.html });
    // 'pulada' = provedor não configurado (ver services/email.ts) — a linha "enviada"
    // gravada na inserção seria falsa nesse caso, então corrige aqui.
    if (!sent) {
      await client.query(`UPDATE app.notifications SET status = 'pulada' WHERE id = $1`, [notificationId]);
    }
  } catch (err) {
    await client.query(
      `UPDATE app.notifications SET status = 'falha', erro = $2 WHERE id = $1`,
      [notificationId, err instanceof Error ? err.message : String(err)],
    );
  }
}

/**
 * Seção 14: quando um produto entra em classificação crítica, notifica o promotor
 * responsável pelo PDV, o supervisor dele, todo gerente do tenant, e o e-mail do PDV
 * — este último só se `notificar_email` estiver marcado (autorização explícita, não
 * assumida). Chamado depois de criar um expiration_record que já nasce crítico (ver
 * routes/expirations.ts); nunca bloqueia a resposta ao promotor — erros de envio só
 * aparecem em app.notifications.status = 'falha', não voltam pro cliente.
 */
export async function notifyCriticalExpiration(client: PoolClient, tenantId: string, expirationRecordId: string): Promise<void> {
  const record = await client.query(
    `SELECT e.quantidade, e.data_validade, p.id AS pdv_id, p.nome AS pdv_nome, p.email AS pdv_email,
            p.notificar_email, p.promotor_responsavel_id, pr.nome AS produto_nome
     FROM app.expiration_records e
     JOIN app.pdvs p ON p.id = e.pdv_id
     JOIN app.products pr ON pr.id = e.product_id
     WHERE e.id = $1`,
    [expirationRecordId],
  );
  const r = record.rows[0];
  if (!r) return;

  const assunto = `Produto próximo do vencimento — ${r.pdv_nome}`;
  const html = `
    <p><strong>${r.produto_nome}</strong> (${r.quantidade} unidade(s)) está próximo do vencimento em <strong>${r.pdv_nome}</strong>.</p>
    <p>Data de validade: ${new Date(r.data_validade).toLocaleDateString('pt-BR')}</p>
  `;
  const tipo = 'validade_critica';
  const referenciaTabela = 'expiration_records';

  const recipients: Recipient[] = [];

  if (r.promotor_responsavel_id) {
    const promotor = await client.query('SELECT id, email FROM app.users WHERE id = $1', [r.promotor_responsavel_id]);
    if (promotor.rows[0]) recipients.push({ email: promotor.rows[0].email, userId: promotor.rows[0].id });

    const supervisor = await client.query(
      `SELECT s.id, s.email FROM app.users u JOIN app.users s ON s.id = u.supervisor_id WHERE u.id = $1`,
      [r.promotor_responsavel_id],
    );
    if (supervisor.rows[0]) recipients.push({ email: supervisor.rows[0].email, userId: supervisor.rows[0].id });
  }

  const gerentes = await client.query(`SELECT id, email FROM app.users WHERE tenant_id = $1 AND role = 'gerente' AND ativo = true`, [tenantId]);
  for (const g of gerentes.rows) recipients.push({ email: g.email, userId: g.id });

  if (r.notificar_email && r.pdv_email) {
    recipients.push({ email: r.pdv_email });
  }

  for (const recipient of recipients) {
    await notifyOnce(client, tenantId, { tipo, referenciaTabela, referenciaId: expirationRecordId, recipient, assunto, html });
  }
}
