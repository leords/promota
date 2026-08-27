/**
 * Cria o primeiro tenant + usuário admin. Roda com a connection string de migração
 * (superuser), não com app_runtime, porque precisa inserir em platform.tenants.
 *
 * Uso: MIGRATE_DATABASE_URL=postgres://promota:promota@localhost:5433/promota \
 *      npx tsx src/scripts/seed.ts --slug empresa-exemplo --nome "Empresa Exemplo" \
 *      --admin-email admin@exemplo.com --admin-senha troque-esta-senha
 */
import bcrypt from 'bcryptjs';
import { Pool } from 'pg';

function arg(name: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1 || !process.argv[idx + 1]) {
    throw new Error(`Faltando argumento obrigatório: --${name}`);
  }
  return process.argv[idx + 1];
}

async function main() {
  const slug = arg('slug');
  const nome = arg('nome');
  const adminEmail = arg('admin-email');
  const adminSenha = arg('admin-senha');

  const databaseUrl =
    process.env.MIGRATE_DATABASE_URL ?? 'postgres://promota:promota@localhost:5433/promota';
  const pool = new Pool({ connectionString: databaseUrl });

  const tenantResult = await pool.query<{ id: string }>(
    `INSERT INTO platform.tenants (nome, slug) VALUES ($1, $2)
     ON CONFLICT (slug) DO UPDATE SET nome = EXCLUDED.nome
     RETURNING id`,
    [nome, slug],
  );
  const tenantId = tenantResult.rows[0].id;

  const senhaHash = await bcrypt.hash(adminSenha, 12);
  await pool.query(
    `INSERT INTO app.users (tenant_id, email, senha_hash, nome, role)
     VALUES ($1, $2, $3, $4, 'admin')
     ON CONFLICT (tenant_id, email) DO UPDATE SET senha_hash = EXCLUDED.senha_hash`,
    [tenantId, adminEmail, senhaHash, 'Administrador'],
  );

  console.log(`Tenant "${slug}" (${tenantId}) pronto. Login: ${adminEmail}`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
