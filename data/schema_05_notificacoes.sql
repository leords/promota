-- Fase 4 (complemento) — Notificações (Seção 14). Aplicar depois de
-- schema_04_avancado.sql.
--
-- "Criar uma estrutura de notificações que permita expansão futura para: e-mail,
-- notificações dentro do sistema, outros canais" — cada notificação decidida pelo
-- sistema é sempre gravada em app.notifications (isso já é a "notificação dentro do
-- sistema"), e opcionalmente também enviada por um canal externo (e-mail via Resend
-- por ora). Ver apps/api/src/services/notifications.ts.

CREATE TYPE app.notification_canal AS ENUM ('email', 'sistema');
CREATE TYPE app.notification_status AS ENUM ('enviada', 'falha', 'pulada');

CREATE TABLE IF NOT EXISTS app.notifications (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES platform.tenants(id),
    tipo                TEXT NOT NULL, -- ex.: 'validade_critica'
    referencia_tabela    TEXT NOT NULL, -- ex.: 'expiration_records' — evita reenviar para o mesmo evento
    referencia_id       UUID NOT NULL,
    destinatario_email  TEXT,
    destinatario_user_id UUID REFERENCES app.users(id),
    canal               app.notification_canal NOT NULL,
    status              app.notification_status NOT NULL,
    assunto             TEXT NOT NULL,
    erro                TEXT,
    criado_em           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_tenant ON app.notifications (tenant_id, criado_em DESC);

-- Uma notificação por (tipo, referência, destinatário) — reenviar o mesmo aviso para
-- a mesma pessoa sobre o mesmo evento não faz sentido e nunca deve duplicar.
--
-- IMPORTANTE: um único UNIQUE(..., destinatario_user_id) NÃO funcionaria para o caso
-- do e-mail do PDV (sem usuário associado, destinatario_user_id fica NULL) — o SQL
-- padrão trata cada NULL como distinto dos outros, então duas notificações para o
-- mesmo e-mail de PDV sobre o mesmo evento nunca colidiriam e o ON CONFLICT DO
-- NOTHING nunca pegaria a duplicata. Por isso dois índices únicos parciais, um para
-- cada caso — ON CONFLICT DO NOTHING sem alvo explícito casa com qualquer um dos dois.
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedup_user
    ON app.notifications (tipo, referencia_tabela, referencia_id, destinatario_user_id)
    WHERE destinatario_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedup_email
    ON app.notifications (tipo, referencia_tabela, referencia_id, destinatario_email)
    WHERE destinatario_user_id IS NULL;

-- "E-mail cadastrado do PDV, quando aplicável e autorizado" — autorização explícita,
-- não assumida: só notifica o e-mail do PDV se essa coluna for true.
ALTER TABLE app.pdvs ADD COLUMN IF NOT EXISTS notificar_email BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE app.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app.notifications
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON app.notifications TO app_runtime;
