# Decisões técnicas

Registro de decisões relevantes e o motivo. Adicionar entrada nova por decisão — não
editar entradas antigas, só anotar se algo for revertido depois.

## 2026-08-27 — Multi-tenancy: banco único + `tenant_id` + Row-Level Security (não banco/schema por tenant)

**Decisão:** todas as tabelas operacionais têm `tenant_id`, e o isolamento é reforçado
por RLS no Postgres, não apenas por `WHERE tenant_id = ...` na aplicação.

**Motivo:** o requisito do projeto é explícito — "nunca confiar apenas no frontend
para isolamento" e "a segurança de isolamento deve ser garantida no backend e nas
consultas ao banco". RLS é a forma de tornar isso estrutural em vez de depender de
disciplina do desenvolvedor em cada nova query. Banco/schema por tenant foi descartado
por custo operacional alto para um SaaS de muitas empresas pequenas. Detalhe técnico
em `docs/ARCHITECTURE.md`.

## 2026-08-27 — PWA em vez de app nativo, offline via IndexedDB + fila própria (não apenas cache do Service Worker)

**Decisão:** app 100% web/PWA; dados offline vivem em IndexedDB com uma fila de
sincronização com UUID gerado no cliente, não apenas cache de assets do Service
Worker.

**Motivo:** requisito explícito do briefing ("não implementar Offline First apenas
como uma mensagem de sem conexão"). Cache de Service Worker resolve abrir o app sem
rede, mas não resolve registrar dados de negócio (check-in, preço, foto) offline e
sincronizar sem duplicar depois — por isso a fila própria com idempotência por UUID.

## 2026-08-27 — Roles fixas (enum) na Fase 1, não sistema de permissões granular

**Decisão:** cinco roles fixas (`super_admin`, `admin`, `gerente`, `supervisor`,
`promotor`) implementadas como enum, sem sistema de permissões configuráveis por
empresa nesta fase.

**Motivo:** o briefing pede "supervisor... permissões configuráveis ou bem definidas"
mas não exige um motor de permissões dinâmico desde o dia 1. Construir isso agora
seria antecipar uma necessidade sem casos de uso reais ainda — mais fácil evoluir de
enum fixo para tabela de permissões depois do que desfazer um sistema genérico
superdimensionado. Revisar quando houver um caso de uso concreto que o enum não
resolva.

## 2026-08-27 — Postgres com PostGIS desde a Fase 1, mesmo sem o módulo de mapa ainda

**Decisão:** o `docker-compose.yml` já sobe `postgis/postgis`, não `postgres` puro.

**Motivo:** o módulo de mapa/território (Fase 3) e os PDVs (Fase 2) vão precisar de
`geography(Point,4326)`. Trocar a imagem base depois de já haver dados em produção dá
mais trabalho do que subir com PostGIS desde o início — custo de manter a extensão
instalada e não usada ainda é zero.

## 2026-08-27 — Portas não-padrão para evitar conflito no ambiente de desenvolvimento

**Decisão:** Postgres exposto em `5433` no host (não `5432`), API em `3334` (não
`3001`/`3000`).

**Motivo:** esta máquina já tem outro Postgres/stack Supabase local ocupando `5432` e
um processo não relacionado ocupando `3001`. Usar essas portas específicas é só uma
conveniência de dev local — não afeta produção, onde cada serviço roda isolado.

## 2026-08-27 — Pesquisas dinâmicas sem targeting por rota/PDV/evento na primeira versão

**Decisão:** qualquer pesquisa com `status = 'ativa'` (dentro do período de
disponibilidade, se definido) pode ser respondida em qualquer visita — não existe
ainda a associação "esta pesquisa só vale para esta rota/PDV/evento" descrita na
Seção 11 do briefing.

**Motivo:** construir um motor de targeting (pesquisa → rota específica, PDV
específico, grupo de PDVs, ou evento) sem um caso de uso real definindo as regras
exatas seria antecipar uma necessidade e arriscar modelar errado. A tabela
`app.surveys` já tem uma coluna `survey_id` referenciável a partir de `app.events`
para o caso de pesquisa-de-evento; o restante do targeting fica para quando houver
uma necessidade concreta puxando o design.

## 2026-08-27 — Limiares de validade configuráveis por tenant, não por produto

**Decisão:** `app.expiration_settings` guarda `dias_critico`/`dias_atencao` uma vez
por tenant (não por produto ou categoria de produto).

**Motivo:** o briefing pede limiares configuráveis porque "diferentes tipos de
produtos possuem necessidades diferentes", mas não especifica a granularidade.
Configuração por tenant é o menor passo que já resolve o problema descrito (uma
distribuidora de perecíveis configura limiares mais curtos que uma de produtos de
limpeza); refinar para por-categoria-de-produto é reversível e fica para quando um
cliente real pedir.

## 2026-08-27 — Resend como provedor de e-mail transacional

**Decisão:** notificações por e-mail (Seção 14) usam a API do Resend.

**Motivo:** confirmado pelo usuário. Resend tem SDK simples em Node, não exige
verificação de domínio complexa para começar (dá pra usar `onboarding@resend.dev` em
dev) e tem tier gratuito adequado para o volume inicial. A camada de notificação
(`apps/api/src/services/notifications.ts`) foi escrita atrás de uma interface
`NotificationChannel` — trocar de provedor de e-mail no futuro, ou adicionar outro
canal, não deveria exigir tocar em quem *decide* mandar notificação, só em quem
*envia*.

## Pendente de confirmação do usuário

- **Armazenamento de fotos** (Seção 9 do briefing): não definido ainda se será S3/R2/
  Blob storage compatível, ou disco local para o MVP. Impacta custo recorrente —
  perguntar antes da Fase 2, quando fotos forem implementadas.
- **Provedor de notificação por e-mail** (Seção 14): não definido (ex.: Resend,
  SendGrid, SES). Perguntar antes da Fase 4.
