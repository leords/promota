-- Fase 3 — Gestão e inteligência: ocorrências. Dashboard, mapa e detector de
-- cobertura (Seções 15-17 do briefing) são consultas sobre tabelas já existentes
-- (pdvs, visits, route_pdvs) — não precisam de tabela nova, só de índices e queries
-- (ver apps/api/src/routes/dashboard.ts). Aplicar depois de schema_02_operacao.sql.

CREATE TYPE app.occurrence_tipo AS ENUM (
    'ruptura', 'falta_espaco', 'material_danificado', 'problema_operacional',
    'concorrente', 'problema_atendimento', 'outro'
);
CREATE TYPE app.occurrence_prioridade AS ENUM ('baixa', 'media', 'alta');
CREATE TYPE app.occurrence_status AS ENUM ('aberta', 'em_acompanhamento', 'resolvida');

CREATE TABLE IF NOT EXISTS app.occurrences (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES platform.tenants(id),
    client_id   UUID NOT NULL UNIQUE, -- idempotência offline, mesmo padrão de visits/photos
    pdv_id      UUID NOT NULL REFERENCES app.pdvs(id),
    promotor_id UUID NOT NULL REFERENCES app.users(id),
    visit_id    UUID REFERENCES app.visits(id), -- opcional: nem toda ocorrência nasce de uma visita
    tipo        app.occurrence_tipo NOT NULL,
    descricao   TEXT NOT NULL,
    prioridade  app.occurrence_prioridade NOT NULL DEFAULT 'media',
    status      app.occurrence_status NOT NULL DEFAULT 'aberta',
    criado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_occurrences_tenant_status ON app.occurrences (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_occurrences_pdv ON app.occurrences (pdv_id);

ALTER TABLE app.occurrences ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.occurrences FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app.occurrences
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON app.occurrences TO app_runtime;

-- Anexar fotos a uma ocorrência (Seção 13: "Fotos, quando necessário") fica para
-- quando houver um caso de uso concreto pedindo — reaproveitar app.photos exigiria
-- tornar visit_id opcional lá, o que não vale a pena mudar sem necessidade real
-- ainda (ver docs/RISKS.md sobre não antecipar).
