# Arquitetura — Plataforma de Gestão de Promotores

## Visão geral

Monorepo com três partes:

```
promota/
├── apps/
│   ├── web/     # React + TypeScript + Vite + PWA — frontend (promotor mobile-first, gestor desktop)
│   └── api/     # Node + TypeScript + Express — API REST multi-tenant
├── infra/       # docker-compose (Postgres + PostGIS)
└── docs/        # documentação do projeto
```

## Stack

| Camada    | Escolha                         | Motivo |
|-----------|----------------------------------|--------|
| Frontend  | React + TypeScript + Vite + PWA  | PWA cobre a exigência de "100% web, sem app nativo" com instalação e service worker; Vite dá build/dev rápido |
| Backend   | Node.js + TypeScript + Express   | mesma linguagem do frontend, simples de operar |
| Banco     | PostgreSQL + PostGIS              | multi-tenant com RLS nativo (seção abaixo); PostGIS para o módulo de mapa/território (Fase 3) |
| Offline   | Service Worker + IndexedDB (`idb`) + fila de sincronização própria | ver seção Offline First |

## Multi-tenancy — estratégia escolhida: banco único, schema único, `tenant_id` + Row-Level Security

Três estratégias possíveis foram avaliadas:

1. **Banco por tenant** — isolamento mais forte, mas inviável operacionalmente para um
   SaaS com potencialmente dezenas/centenas de empresas pequenas (migração e backup
   multiplicados por tenant).
2. **Schema por tenant** — meio-termo, mas dificulta queries administrativas
   cross-tenant (necessárias para o Super Administrador) e migrations ficam mais
   complexas (rodar em N schemas).
3. **Coluna `tenant_id` em toda tabela operacional + Row-Level Security do Postgres** — escolhida.

**Motivo da escolha:** a regra do projeto é "nunca confiar apenas no frontend para
isolamento". RLS coloca o isolamento *dentro do banco*, não apenas na lógica da
aplicação — mesmo um bug de aplicação que esqueça de filtrar por `tenant_id` não
consegue vazar dados de outro tenant, porque o Postgres aplica a política
independentemente da query. A aplicação define `SET app.tenant_id = '<uuid>'` na
conexão a cada requisição (a partir do JWT autenticado) e todas as tabelas
operacionais têm uma policy `USING (tenant_id = current_setting('app.tenant_id')::uuid)`.

Tabelas administrativas da plataforma (schema `platform`: `tenants`, dados do Super
Administrador) ficam **fora** do RLS de tenant — são geridas apenas pelo Super Admin,
nunca por usuários de empresa. Ver `data/schema.sql`.

**Detalhe crítico:** o Postgres ignora RLS para superusuários, sempre — independente
de `FORCE ROW LEVEL SECURITY`. O usuário do docker-compose (`POSTGRES_USER`) é
dono/superuser das tabelas e serve só para rodar migrations. A API roda com uma role
separada, `app_runtime`, criada em `data/schema.sql` sem `BYPASSRLS`. Nunca apontar
`DATABASE_URL` da API para o usuário superuser.

## Autenticação e autorização

- JWT assinado pelo backend. Payload contém `user_id`, `tenant_id` (nulo apenas para
  Super Admin), `role`.
- Roles fixas na Fase 1: `super_admin`, `admin`, `gerente`, `supervisor`, `promotor`
  (enum no banco — refinamento de permissões por role granular fica para quando surgir
  necessidade real, não antecipar).
- Todo middleware de rota lê o JWT, valida, e popula `req.auth = { userId, tenantId, role }`;
  a camada de banco usa `tenantId` para o `SET app.tenant_id`. Rotas de Super Admin
  (`/platform/*`) não fazem esse `SET` — usam uma policy separada.

## Offline First

Prioridade definida no briefing: rota sincronizada, dados de PDV, checklists/pesquisas,
visitas, check-in/check-out, observações, coleta de preços, ocorrências, fotos em fila.

Abordagem:

- **IndexedDB** (via `idb`) como armazenamento local estruturado — não `localStorage`
  (não serve para volume de dados/fotos que o app precisa reter offline).
- **Fila de sincronização própria**: toda mutação feita offline (check-in, preço,
  ocorrência, foto, resposta de pesquisa) é gravada localmente com um
  **UUID gerado no cliente** (garante idempotência: o mesmo registro reenviado não
  duplica no servidor — a API faz upsert por esse UUID) e um status
  (`pending` → `syncing` → `synced` / `failed`).
- Um `SyncManager` no frontend observa `navigator.onLine`/eventos de
  `online`/`offline`, tenta drenar a fila em lotes, com retry exponencial, e atualiza
  a UI com contagem de pendências.
- Service Worker (via `vite-plugin-pwa`) cacheia o app shell e os assets estáticos
  para o app abrir mesmo sem rede; dados de negócio ficam no IndexedDB, não no cache
  do Service Worker.
- Fotos offline: salvas como `Blob` no IndexedDB, enviadas quando a fila sincroniza;
  nunca bloqueiam o restante da fila (fila de fotos é separada da fila de dados
  textuais, pois upload de foto é mais lento e mais sujeito a falha em rede ruim).

Esta fundação (estrutura da fila, IndexedDB, Service Worker) é construída na Fase 1;
os fluxos que a *usam* (check-in, preços, fotos, ocorrências) são implementados
conforme cada um é construído nas Fases 2–4, já em cima dessa fundação.

## Estrutura de dados — Fase 1 (fundação)

Ver `data/schema.sql` para o SQL completo. Nesta fase:

- `platform.tenants` — empresas clientes da plataforma.
- `platform.super_admins` — usuários da plataforma (não pertencem a nenhum tenant).
- `app.users` — usuários de uma empresa (`tenant_id`, `role`, credenciais).
- `app.refresh_tokens` — sessões/refresh tokens para JWT.

Tabelas de PDVs, produtos, rotas, visitas, fotos, preços, pesquisas, eventos,
ocorrências e validades **serão criadas na Fase 2/3/4**, conforme o roteiro do
projeto — não antecipar o schema completo agora para não travar decisões de modelagem
que dependem de como o fluxo de cada tela funciona na prática.

## Riscos técnicos

Ver `docs/RISKS.md`.
