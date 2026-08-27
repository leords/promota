-- Fase 2 — Operação: PDVs, produtos, rotas, visitas (check-in/out), fotos, preços.
-- Aplicar depois de schema.sql. Toda tabela aqui segue a mesma regra de
-- docs/RISKS.md: tenant_id + RLS antes de ir para produção — sem exceção.
--
-- client_id (UUID) em visits/photos/price_collections é a chave de idempotência da
-- fila de sincronização offline (ver docs/ARCHITECTURE.md, Offline First): o
-- promotor gera esse UUID no dispositivo antes de ter rede, e o servidor faz
-- upsert por ele — reenviar o mesmo registro nunca duplica.

CREATE TYPE app.pdv_status_atendimento AS ENUM (
    'pendente', 'em_atendimento', 'concluido', 'nao_atendido'
);

CREATE TABLE IF NOT EXISTS app.pdvs (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID NOT NULL REFERENCES platform.tenants(id),
    nome                    TEXT NOT NULL,
    razao_social            TEXT,
    tipo_estabelecimento    TEXT,
    rede                    TEXT,
    logradouro              TEXT,
    numero                  TEXT,
    complemento             TEXT,
    bairro                  TEXT,
    cidade                  TEXT,
    uf                      CHAR(2),
    cep                     TEXT,
    geom                    geography(Point, 4326), -- NULL até geocodificar/informar manualmente
    telefone                TEXT,
    email                   TEXT,
    contato_responsavel     TEXT,
    promotor_responsavel_id UUID REFERENCES app.users(id),
    observacoes             TEXT,
    ativo                   BOOLEAN NOT NULL DEFAULT true,
    frequencia_esperada_dias INTEGER, -- reservado para o detector de cobertura (Fase 3)
    criado_em               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pdvs_tenant    ON app.pdvs (tenant_id);
CREATE INDEX IF NOT EXISTS idx_pdvs_cidade    ON app.pdvs (tenant_id, cidade);
CREATE INDEX IF NOT EXISTS idx_pdvs_bairro    ON app.pdvs (tenant_id, bairro);
CREATE INDEX IF NOT EXISTS idx_pdvs_rede      ON app.pdvs (tenant_id, rede);
CREATE INDEX IF NOT EXISTS idx_pdvs_tipo      ON app.pdvs (tenant_id, tipo_estabelecimento);
CREATE INDEX IF NOT EXISTS idx_pdvs_promotor  ON app.pdvs (tenant_id, promotor_responsavel_id);
CREATE INDEX IF NOT EXISTS idx_pdvs_geom       ON app.pdvs USING gist (geom);

CREATE TABLE IF NOT EXISTS app.products (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES platform.tenants(id),
    nome            TEXT NOT NULL,
    marca           TEXT,
    categoria       TEXT,
    codigo_interno  TEXT,
    ativo           BOOLEAN NOT NULL DEFAULT true,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_products_tenant ON app.products (tenant_id);

CREATE TYPE app.route_status AS ENUM ('planejada', 'em_andamento', 'concluida');

CREATE TABLE IF NOT EXISTS app.routes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES platform.tenants(id),
    nome            TEXT NOT NULL,
    data            DATE NOT NULL,
    promotor_id     UUID NOT NULL REFERENCES app.users(id),
    status          app.route_status NOT NULL DEFAULT 'planejada',
    observacoes     TEXT,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_routes_tenant_promotor_data
    ON app.routes (tenant_id, promotor_id, data);

CREATE TABLE IF NOT EXISTS app.route_pdvs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES platform.tenants(id),
    route_id            UUID NOT NULL REFERENCES app.routes(id) ON DELETE CASCADE,
    pdv_id              UUID NOT NULL REFERENCES app.pdvs(id),
    ordem               INTEGER NOT NULL DEFAULT 0,
    status              app.pdv_status_atendimento NOT NULL DEFAULT 'pendente',
    motivo_nao_atendido TEXT,
    criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (route_id, pdv_id)
);
CREATE INDEX IF NOT EXISTS idx_route_pdvs_route ON app.route_pdvs (route_id, ordem);
CREATE INDEX IF NOT EXISTS idx_route_pdvs_tenant ON app.route_pdvs (tenant_id);

CREATE TABLE IF NOT EXISTS app.visits (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES platform.tenants(id),
    client_id           UUID NOT NULL UNIQUE, -- idempotência (gerado offline pelo app)
    route_pdv_id        UUID NOT NULL REFERENCES app.route_pdvs(id),
    pdv_id              UUID NOT NULL REFERENCES app.pdvs(id),
    promotor_id         UUID NOT NULL REFERENCES app.users(id),
    checkin_em          TIMESTAMPTZ NOT NULL,
    checkin_lat         DOUBLE PRECISION,
    checkin_lng         DOUBLE PRECISION,
    checkin_precisao_m  DOUBLE PRECISION,
    checkin_distancia_m DOUBLE PRECISION, -- distância até o PDV no momento do check-in
    checkout_em         TIMESTAMPTZ,
    checkout_lat        DOUBLE PRECISION,
    checkout_lng        DOUBLE PRECISION,
    duracao_segundos    INTEGER, -- calculado no check-out, não em tempo real
    justificativa       TEXT,    -- atendimento muito curto/longo (ver docs/RISKS.md — não é vigilância)
    criado_em           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_visits_tenant_pdv      ON app.visits (tenant_id, pdv_id);
CREATE INDEX IF NOT EXISTS idx_visits_tenant_promotor ON app.visits (tenant_id, promotor_id);
CREATE INDEX IF NOT EXISTS idx_visits_route_pdv       ON app.visits (route_pdv_id);

CREATE TABLE IF NOT EXISTS app.photos (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES platform.tenants(id),
    client_id   UUID NOT NULL UNIQUE,
    visit_id    UUID NOT NULL REFERENCES app.visits(id),
    pdv_id      UUID NOT NULL REFERENCES app.pdvs(id),
    promotor_id UUID NOT NULL REFERENCES app.users(id),
    categoria   TEXT NOT NULL, -- antes, depois, gondola, ponto_extra, merchandising, ruptura, livre
    -- Armazenamento definitivo (S3/R2/etc) ainda não decidido — ver docs/DECISIONS.md.
    -- storage_key guarda o caminho relativo no provedor que for escolhido; no MVP de
    -- dev aponta para apps/api/uploads/ em disco local (NÃO usar em produção).
    storage_key TEXT NOT NULL,
    criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_photos_visit ON app.photos (visit_id);
CREATE INDEX IF NOT EXISTS idx_photos_pdv   ON app.photos (tenant_id, pdv_id);

CREATE TABLE IF NOT EXISTS app.price_collections (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES platform.tenants(id),
    client_id       UUID NOT NULL UNIQUE,
    visit_id        UUID NOT NULL REFERENCES app.visits(id),
    pdv_id          UUID NOT NULL REFERENCES app.pdvs(id),
    promotor_id     UUID NOT NULL REFERENCES app.users(id),
    product_id      UUID NOT NULL REFERENCES app.products(id),
    marca           TEXT,
    preco           NUMERIC(10, 2) NOT NULL,
    concorrente     TEXT,
    observacoes     TEXT,
    coletado_em     TIMESTAMPTZ NOT NULL,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_price_collections_pdv_produto_data
    ON app.price_collections (tenant_id, pdv_id, product_id, coletado_em);

-- ============================================================
-- RLS — mesmo padrão de schema.sql para todas as tabelas novas.
-- ============================================================

DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['pdvs', 'products', 'routes', 'route_pdvs', 'visits', 'photos', 'price_collections']
    LOOP
        EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON app.%I USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid)',
            t
        );
    END LOOP;
END
$$;

GRANT SELECT, INSERT, UPDATE, DELETE
    ON app.pdvs, app.products, app.routes, app.route_pdvs, app.visits, app.photos, app.price_collections
    TO app_runtime;
