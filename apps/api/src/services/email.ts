import { Resend } from 'resend';
import { env } from '../config/env.js';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
}

/**
 * Canal de e-mail via Resend (ver docs/DECISIONS.md). Isolado atrás desta função —
 * trocar de provedor no futuro (ou adicionar SMS/push) significa mudar aqui, não em
 * quem decide mandar notificação (services/notifications.ts nunca importa `Resend`
 * diretamente).
 *
 * Sem RESEND_API_KEY configurada, loga no console em vez de lançar erro — permite
 * rodar o resto do sistema em dev/CI sem exigir uma conta Resend real. Retorna
 * `sent: false` nesse caso (não `true`) para que quem grava o log de notificação
 * (services/notifications.ts) registre status 'pulada', não 'enviada' — sem essa
 * distinção o histórico mentiria que um e-mail saiu quando só foi impresso no
 * console.
 */
export async function sendEmail(message: EmailMessage): Promise<{ sent: boolean }> {
  if (!env.resendApiKey) {
    console.log(`[email] RESEND_API_KEY não configurada — e-mail não enviado: para=${message.to} assunto="${message.subject}"`);
    return { sent: false };
  }

  const resend = new Resend(env.resendApiKey);
  const result = await resend.emails.send({
    from: env.emailFrom,
    to: message.to,
    subject: message.subject,
    html: message.html,
  });

  if (result.error) {
    throw new Error(`Resend: ${result.error.message}`);
  }
  return { sent: true };
}
