-- Schema inicial (Fase 1 — fundação: multi-tenancy, autenticação, usuários).
-- Tabelas operacionais (PDVs, rotas, visitas, etc.) entram nas Fases 2-4.
-- Ver docs/ARCHITECTURE.md para a estratégia de multi-tenancy (RLS).

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()

CREATE SCHEMA IF NOT EXISTS platform; -- administração do SaaS, fora do RLS de tenant
CREATE SCHEMA IF NOT EXISTS app;      -- dados operacionais de cada empresa (tenant)

-- ============================================================
-- schema platform — administração da plataforma (Super Admin)
-- ============================================================

CREATE TABLE IF NOT EXISTS platform.tenants (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome        TEXT NOT NULL,
    slug        TEXT NOT NULL UNIQUE,
    status      TEXT NOT NULL DEFAULT 'ativo', -- ativo, suspenso, cancelado
    criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform.super_admins (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email       TEXT NOT NULL UNIQUE,
    senha_hash  TEXT NOT NULL,
    nome        TEXT,
    criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- schema app — dados de cada empresa (tenant), protegidos por RLS
-- ============================================================

CREATE TYPE app.user_role AS ENUM ('admin', 'gerente', 'supervisor', 'promotor');

CREATE TABLE IF NOT EXISTS app.users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES platform.tenants(id),
    email           TEXT NOT NULL,
    senha_hash      TEXT NOT NULL,
    nome            TEXT NOT NULL,
    role            app.user_role NOT NULL,
    supervisor_id   UUID REFERENCES app.users(id), -- para vincular promotor a supervisor
    ativo           BOOLEAN NOT NULL DEFAULT true,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, email)
);

CREATE TABLE IF NOT EXISTS app.refresh_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES platform.tenants(id),
    user_id     UUID NOT NULL REFERENCES app.users(id),
    token_hash  TEXT NOT NULL UNIQUE,
    expira_em   TIMESTAMPTZ NOT NULL,
    revogado_em TIMESTAMPTZ,
    criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_tenant ON app.users (tenant_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON app.refresh_tokens (user_id);

-- ============================================================
-- Row-Level Security — a aplicação faz SET app.tenant_id = '<uuid>' por conexão/
-- requisição (ver apps/api/src/db). current_setting(..., true) retorna NULL se não
-- setado, e a comparação com NULL nunca é verdadeira — sem tenant setado, zero linhas
-- visíveis (nunca "sem filtro").
-- ============================================================

ALTER TABLE app.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.users FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app.users
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE app.refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.refresh_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app.refresh_tokens
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ============================================================
-- Role de runtime da API — IMPORTANTE: RLS é sempre ignorado por superusuários
-- (mesmo com FORCE ROW LEVEL SECURITY), independentemente da policy. O usuário
-- definido em POSTGRES_USER no docker-compose é superuser/dono das tabelas, então a
-- API NUNCA deve se conectar com ele em produção — apenas para migrations. A conexão
-- da API usa esta role, sem BYPASSRLS.
-- ============================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
        CREATE ROLE app_runtime LOGIN PASSWORD 'app_runtime' NOBYPASSRLS;
    END IF;
END
$$;

GRANT USAGE ON SCHEMA app TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
-- platform.tenants: app_runtime só precisa LER (para validar tenant_id no login),
-- nunca escrever — só o Super Admin gerencia tenants.
GRANT USAGE ON SCHEMA platform TO app_runtime;
GRANT SELECT ON platform.tenants TO app_runtime;
