-- Fase 4 — Recursos avançados: controle de validades, pesquisas dinâmicas, eventos.
-- Aplicar depois de schema_03_gestao.sql. Mesma regra de sempre: tenant_id + RLS.
--
-- Escopo deliberadamente cortado nesta primeira passada (ver docs/DECISIONS.md):
-- pesquisas não têm targeting por rota/PDV específico ainda (qualquer pesquisa
-- "ativa" pode ser respondida em qualquer visita) — construir isso quando houver um
-- caso de uso real pedindo, não antes.

-- ============================================================
-- Controle de validades (Seção 14)
-- ============================================================

-- Limiares de classificação são por tenant, não fixos no código — "diferentes tipos
-- de produtos possuem necessidades diferentes" é responsabilidade de cada empresa
-- ajustar, não do sistema decidir por ela. Uma linha por tenant, criada sob demanda.
CREATE TABLE IF NOT EXISTS app.expiration_settings (
    tenant_id       UUID PRIMARY KEY REFERENCES platform.tenants(id),
    dias_critico    INTEGER NOT NULL DEFAULT 7,
    dias_atencao    INTEGER NOT NULL DEFAULT 30
);

CREATE TABLE IF NOT EXISTS app.expiration_records (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES platform.tenants(id),
    client_id       UUID NOT NULL UNIQUE,
    pdv_id          UUID NOT NULL REFERENCES app.pdvs(id),
    promotor_id     UUID NOT NULL REFERENCES app.users(id),
    product_id      UUID NOT NULL REFERENCES app.products(id),
    quantidade      INTEGER NOT NULL,
    data_validade   DATE NOT NULL,
    observacoes     TEXT,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_expiration_tenant_data ON app.expiration_records (tenant_id, data_validade);
CREATE INDEX IF NOT EXISTS idx_expiration_pdv ON app.expiration_records (pdv_id);

-- ============================================================
-- Pesquisas e formulários dinâmicos (Seção 11)
-- ============================================================

CREATE TYPE app.survey_status AS ENUM ('rascunho', 'ativa', 'encerrada');
CREATE TYPE app.question_tipo AS ENUM ('texto', 'numero', 'sim_nao', 'multipla_escolha', 'selecao_unica', 'nota', 'foto');

CREATE TABLE IF NOT EXISTS app.surveys (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES platform.tenants(id),
    nome            TEXT NOT NULL,
    descricao       TEXT,
    status          app.survey_status NOT NULL DEFAULT 'rascunho',
    disponivel_de   DATE,
    disponivel_ate  DATE,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.survey_questions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES platform.tenants(id),
    survey_id       UUID NOT NULL REFERENCES app.surveys(id) ON DELETE CASCADE,
    ordem           INTEGER NOT NULL DEFAULT 0,
    tipo            app.question_tipo NOT NULL,
    texto           TEXT NOT NULL,
    obrigatoria     BOOLEAN NOT NULL DEFAULT true,
    -- opcoes: array JSON de strings, usado só por multipla_escolha/selecao_unica.
    opcoes          JSONB
);
CREATE INDEX IF NOT EXISTS idx_survey_questions_survey ON app.survey_questions (survey_id, ordem);

CREATE TABLE IF NOT EXISTS app.survey_responses (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES platform.tenants(id),
    client_id       UUID NOT NULL UNIQUE,
    survey_id       UUID NOT NULL REFERENCES app.surveys(id),
    pdv_id          UUID NOT NULL REFERENCES app.pdvs(id),
    promotor_id     UUID NOT NULL REFERENCES app.users(id),
    visit_id        UUID REFERENCES app.visits(id),
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_survey_responses_survey ON app.survey_responses (survey_id);
CREATE INDEX IF NOT EXISTS idx_survey_responses_pdv ON app.survey_responses (pdv_id);

CREATE TABLE IF NOT EXISTS app.survey_answers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES platform.tenants(id),
    response_id     UUID NOT NULL REFERENCES app.survey_responses(id) ON DELETE CASCADE,
    question_id     UUID NOT NULL REFERENCES app.survey_questions(id),
    -- valor guarda a resposta como texto sempre — número/nota como string numérica,
    -- múltipla escolha como JSON-array-string, foto como o id de uma app.photos já
    -- enviada. Um único tipo de coluna evita ramificação de schema por tipo de
    -- pergunta; quem interpreta o formato é a camada de aplicação, guiada por
    -- survey_questions.tipo.
    valor           TEXT,
    UNIQUE (response_id, question_id)
);

-- ============================================================
-- Eventos e degustações (Seção 12)
-- ============================================================

CREATE TABLE IF NOT EXISTS app.events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES platform.tenants(id),
    nome            TEXT NOT NULL,
    descricao       TEXT,
    pdv_id          UUID NOT NULL REFERENCES app.pdvs(id),
    data            DATE NOT NULL,
    meta            TEXT,
    survey_id       UUID REFERENCES app.surveys(id),
    observacoes     TEXT,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_events_tenant_data ON app.events (tenant_id, data);

CREATE TABLE IF NOT EXISTS app.event_promoters (
    event_id        UUID NOT NULL REFERENCES app.events(id) ON DELETE CASCADE,
    promotor_id     UUID NOT NULL REFERENCES app.users(id),
    tenant_id       UUID NOT NULL REFERENCES platform.tenants(id),
    PRIMARY KEY (event_id, promotor_id)
);

CREATE TABLE IF NOT EXISTS app.event_products (
    event_id        UUID NOT NULL REFERENCES app.events(id) ON DELETE CASCADE,
    product_id      UUID NOT NULL REFERENCES app.products(id),
    tenant_id       UUID NOT NULL REFERENCES platform.tenants(id),
    PRIMARY KEY (event_id, product_id)
);

CREATE TABLE IF NOT EXISTS app.event_results (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID NOT NULL REFERENCES platform.tenants(id),
    client_id               UUID NOT NULL UNIQUE,
    event_id                UUID NOT NULL REFERENCES app.events(id),
    promotor_id             UUID NOT NULL REFERENCES app.users(id),
    pessoas_abordadas       INTEGER,
    degustacoes_realizadas  INTEGER,
    quantidade_distribuida  INTEGER,
    observacoes             TEXT,
    criado_em               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- RLS — mesmo padrão de sempre para todas as tabelas novas.
-- ============================================================

DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'expiration_records', 'surveys', 'survey_questions', 'survey_responses',
        'survey_answers', 'events', 'event_promoters', 'event_products', 'event_results'
    ]
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

ALTER TABLE app.expiration_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.expiration_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app.expiration_settings
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON
    app.expiration_settings, app.expiration_records, app.surveys, app.survey_questions,
    app.survey_responses, app.survey_answers, app.events, app.event_promoters,
    app.event_products, app.event_results
    TO app_runtime;
