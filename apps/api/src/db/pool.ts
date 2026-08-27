import { Pool, type PoolClient } from 'pg';
import { env } from '../config/env.js';

export const pool = new Pool({ connectionString: env.databaseUrl });

/**
 * Executa `fn` com uma conexão dedicada cujo `app.tenant_id` está setado — a Row-
 * Level Security do Postgres (ver data/schema.sql) filtra automaticamente todas as
 * queries de tabelas do schema `app` por esse tenant. NUNCA pular este wrapper para
 * acessar dados de tenant fora de uma rota de Super Admin.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    // SET não aceita bind parameters ($1) — usar set_config(), que aceita.
    await client.query("SELECT set_config('app.tenant_id', $1, false)", [tenantId]);
    return await fn(client);
  } finally {
    await client.query('RESET app.tenant_id');
    client.release();
  }
}

/** Para consultas ao schema `platform` (fora do RLS de tenant) — ex.: resolver o tenant pelo slug no login. */
export async function withoutTenant<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}
