import 'dotenv/config';

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  port: Number(process.env.API_PORT ?? 3334),
  databaseUrl: required(
    'DATABASE_URL',
    'postgres://app_runtime:app_runtime@localhost:5433/promota',
  ),
  jwtSecret: required('JWT_SECRET', 'dev-secret-troque-em-producao'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '8h',
  // Sem chave configurada, o serviço de e-mail loga no console em vez de falhar —
  // ver services/email.ts. Isso permite rodar o resto do sistema em dev sem exigir
  // uma conta Resend.
  resendApiKey: process.env.RESEND_API_KEY,
  emailFrom: process.env.EMAIL_FROM ?? 'Promota <onboarding@resend.dev>',
};
