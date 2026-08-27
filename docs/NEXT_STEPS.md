# Próximos passos

## Concluído — Fase 1: Fundação

- Arquitetura definida ([ARCHITECTURE.md](./ARCHITECTURE.md)) e decisões registradas
  ([DECISIONS.md](./DECISIONS.md)).
- Banco de dados multi-tenant com Row-Level Security (`data/schema.sql`): schema
  `platform` (tenants, super admins) e `app` (users, refresh_tokens), role `app_runtime`
  sem `BYPASSRLS` para a API.
- API (Express + TS): login multi-tenant (`POST /auth/login`, recebe `tenantSlug` +
  `email` + `senha`), JWT com `userId`/`tenantId`/`role`, rota protegida de exemplo
  (`GET /me`) que prova o isolamento por tenant de ponta a ponta.
- Frontend (React + TS + Vite + PWA): tela de login, shell autenticado mostrando
  indicador online/offline e contagem de pendências de sincronização, service worker
  configurado (`vite-plugin-pwa`).
- Fundação Offline First: IndexedDB (`src/offline/db.ts`) + fila de sincronização com
  UUID gerado no cliente (`src/offline/syncQueue.ts`) — pronta para os fluxos reais
  (check-in, preços, fotos, ocorrências) da Fase 2 usarem.

## Como validei

- `tsc --noEmit` limpo em `apps/api` e `apps/web`; `npm run build` do frontend gera
  `sw.js`/`manifest.webmanifest` corretamente.
- Subi Postgres+PostGIS via Docker, apliquei `data/schema.sql`, criei dois tenants de
  teste (`empresa-exemplo`, `outra-empresa`) via `npm run seed`.
- Testei login para os dois tenants, `/me` retornando os dados corretos, e
  **confirmei RLS diretamente no banco**: como `app_runtime` sem `tenant_id` setado,
  `SELECT count(*) FROM app.users` retorna 0 (não "todas as linhas"); com
  `app.tenant_id` setado para um tenant, só aparece o usuário daquele tenant, mesmo
  havendo 2 tenants com usuários na tabela.
- Confirmei que erros de rota não derrubam mais o processo Node inteiro (middleware
  `asyncHandler` + error handler global — um bug aqui na Fase 1 já fez o servidor
  crashar uma vez antes do fix, ver `docs/DECISIONS.md` se quiser o histórico).

## Concluído — Fase 2: Operação (núcleo)

- Schema (`data/schema_02_operacao.sql`): `pdvs`, `products`, `routes`, `route_pdvs`,
  `visits`, `photos`, `price_collections` — todas com `tenant_id` + RLS, seguindo o
  mesmo padrão da Fase 1.
- API: CRUD de PDVs (com visão 360º — últimas visitas/preços) e produtos
  (admin/gerente); criação de rota com PDVs atribuídos e ordenados; `GET /routes/today`
  (rota do promotor logado); check-in/check-out (`POST /visits/checkin|checkout`,
  idempotentes por `clientId`, com cálculo de distância via PostGIS e duração via
  `checkout - checkin`); coleta de preços; upload de foto (multer, **disco local —
  dev only**, ver pendência de storage abaixo).
- Frontend: tela "Rota do dia" do promotor (`src/pages/RouteToday.tsx`) — check-in,
  registrar preço, check-out — com fallback para a fila offline
  (`src/offline/syncManager.ts`) quando a chamada de API falha por rede.
- **Validado em navegador real** (não só typecheck): login → check-in → coleta de
  preço → check-out → status da rota avançando corretamente
  (`pendente → em_atendimento → concluido`), incluindo teste de idempotência
  (reenviar o mesmo check-in não duplica) e isolamento entre tenants (PDV de uma
  empresa retorna 404 para usuário de outra).

## Concluído — telas de gestão (admin/gerente)

- `GET /users` (lista promotores, para atribuir rota) e `GET /routes` (visão geral de
  rotas) adicionados à API.
- Frontend (`apps/web/src/pages/admin/`): `AdminLayout` (navegação PDVs/Produtos/Rotas),
  `PdvsPage` e `ProductsPage` (listar + cadastrar), `RoutesPage` (listar + criar rota
  com seleção de promotor e checkboxes de PDVs). Roteamento por role em `App.tsx` —
  promotor vai para a rota do dia, demais roles vão para `/pdvs`.
- **Bug real encontrado e corrigido durante a validação em navegador**:
  `app.routes.status` nunca avançava de `planejada` mesmo com todos os PDVs
  concluídos — o campo não estava ligado ao status agregado de `route_pdvs`. Criado
  `apps/api/src/services/routeStatus.ts` (`refreshRouteStatus`), chamado depois de
  check-in, check-out e de marcar "não atendido"; confirmado via API e na tela de
  Rotas que o status agora avança `planejada → em_andamento → concluida`
  corretamente. Também corrigido: a coluna `data` da rota aparecia como timestamp
  completo na tabela em vez de `YYYY-MM-DD`.
- Validado em navegador real: login como admin, criar PDV/produto/rota pela UI,
  conferir que aparecem nas listas, e o ciclo completo de status da rota.

## Concluído — fila offline testada com rede realmente cortada

Testado em navegador real (não simulação): API derrubada de verdade (processo morto,
não só `navigator.onLine`), promotor faz check-in → volta a API → reconecta →
check-out — três bugs reais encontrados e corrigidos nesse processo:

1. **`RouteToday` apagava a rota da tela sempre que uma tentativa de recarregar
   falhava** (`catch(() => setRoute(null))` incondicional) — ficar sem rede fazia o
   promotor perder a visão da própria rota, o oposto do que Offline First exige.
   Corrigido: só limpa a rota em 404 confirmado pelo servidor; qualquer outro erro
   mantém o que já estava carregado.
2. **A rota nunca era persistida localmente** — abrir o app já offline (não só
   perder conexão em sessão) não mostrava nada. Corrigido com um cache em
   `localStorage` (`offline/localKeys.ts`) da última rota sincronizada, hidratado no
   mount e limpo no logout (para não vazar entre tenants no mesmo dispositivo);
   um aviso "dados podem estar desatualizados" aparece quando exibindo do cache.
3. **Depois que um check-in enfileirado sincronizava, o app não sabia o `visitId`
   real** — a fila marcava sucesso, mas o campo local ficava com `visitId: ""`,
   travando o promotor: nunca mais conseguia dar check-out naquele PDV. Corrigido em
   `offline/activeVisits.ts`/`syncManager.ts` (`resolveActiveVisit`), que atualiza o
   `visitId` local assim que a sincronização confirma.
4. **Bug de concorrência real no backend, achado pelo log de erro do servidor**: os
   três endpoints idempotentes por `client_id` (check-in, coleta de preço, foto)
   faziam `SELECT existe? senão INSERT` — não atômico. Duas requisições concorrentes
   com o mesmo `clientId` (reproduzido de verdade, não hipotético — apareceu no log
   como `duplicate key value violates unique constraint "visits_client_id_key"`)
   podiam ambas passar pelo SELECT e uma delas quebrava com 500, fazendo a fila
   marcar como "falha" um check-in que na prática já tinha sido salvo. Corrigido nos
   três endpoints com `INSERT ... ON CONFLICT (client_id) DO NOTHING` + fallback de
   leitura, que é atômico.

## Concluído — pendências da Fase 2 fechadas

- **Edição/inativação de PDVs e produtos pela UI**: `PdvsPage`/`ProductsPage` agora
  têm "Editar" e "Inativar/Reativar" inline. Corrigido de quebra junto: `GET
  /products` só retornava produtos ativos — inativar um produto o escondia da tela
  de gestão para sempre, sem forma de reativar. Agora aceita `?includeInactive=true`
  (usado pela tela de gestão; o uso normal do promotor continua só ativos).
- **Visão 360º do PDV com fotos** (`PdvDetail.tsx`, aberta ao clicar no nome do PDV
  na lista): últimas visitas, preços coletados e galeria de fotos.
- **Captura de foto pelo promotor** (`RouteToday.tsx`, botão "Enviar foto" durante
  atendimento): categoria + input de arquivo (`capture="environment"` para abrir a
  câmera em celular). Funciona offline — se o upload falhar, o `Blob` fica na mesma
  fila de sincronização (IndexedDB suporta Blob nativamente) e é enviado como
  `multipart/form-data` quando reconectar (`offline/syncManager.ts`).
- **Retry visível para itens que falharam de verdade** (erro de negócio, não de
  rede): contador "N registros não sincronizaram" + botão "Tentar novamente" em
  `RouteToday.tsx`, usando `offline/syncQueue.ts` (`failedCount`/`retryFailed`).

### Bug de segurança real encontrado e corrigido durante esse trabalho

Testando a galeria de fotos, a imagem aparecia quebrada. Investigando: `/uploads`
estava montado como **arquivo estático público** (`express.static`), sem nenhuma
checagem de tenant — qualquer pessoa com a URL do arquivo (um UUID previsível só
pelo padrão, não por segredo) conseguiria baixar a foto de **qualquer empresa**,
violando diretamente o princípio central do projeto ("nunca confiar apenas no
frontend para isolamento"). Corrigido substituindo por
`GET /photos/:id/file` — autenticado, com lookup em `app.photos` (RLS aplica o
filtro de tenant antes de servir o arquivo). O frontend busca a foto autenticada e
monta um blob URL local (`api/admin.ts` → `fetchPhotoBlobUrl`), já que uma tag
`<img src>` normal não consegue mandar o header `Authorization`. Ver
`docs/RISKS.md` para o registro completo — isso também expôs um detalhe de
roteamento do Express que vale a pena conhecer (ver `CLAUDE.md`).

## Pendente para fechar a Fase 2

- **Decisão de armazenamento de fotos** (S3/R2/etc.) — hoje salva em disco local do
  container, o que não sobrevive a um redeploy. Ver `docs/DECISIONS.md`. O acesso já
  está corretamente autenticado/isolado por tenant; só a durabilidade do disco local
  ainda é o problema.

## Concluído — Fase 3: Gestão e inteligência

- **Schema** (`data/schema_03_gestao.sql`): tabela `occurrences` (tenant_id + RLS,
  idempotente por `client_id` como visits/photos/price_collections). Dashboard, mapa
  e detector de cobertura são consultas sobre tabelas já existentes — não precisaram
  de tabela nova.
- **Central de ocorrências** (Seção 13): `POST /occurrences` (promotor registra
  durante o atendimento, com tipo/descrição/prioridade), `GET /occurrences` +
  `PATCH /occurrences/:id/status` (admin/gerente/supervisor, tela
  `OccurrencesPage.tsx` com filtro por status e ações Acompanhar/Resolver/Reabrir).
  Promotor tem botão "Registrar ocorrência" em `RouteToday.tsx`, com suporte offline
  (mesma fila de sincronização).
- **"Não atendido" com motivo** (Seção 7, existia no backend desde a Fase 2 mas nunca
  tinha UI): botão "Não foi possível atender" no PDV pendente, pede o motivo, chama
  `PATCH /routes/pdvs/:id/status`.
- **Dashboard** (`DashboardPage.tsx`, agora a tela inicial de quem não é promotor) —
  `GET /dashboard/today`: painel "O que merece atenção hoje?" (ocorrências abertas,
  rotas pendentes, promotores sem atividade, PDVs sem cobertura), visão operacional
  do dia (promotores programados/que trabalharam, PDVs planejados/atendidos/pendentes/
  não atendidos, taxa de execução, tempo médio de atendimento). **Deliberadamente sem
  nenhum ranking de promotor por volume** — proibido pelo briefing; os números são
  agregados operacionais, não avaliação individual.
- **Detector de PDVs sem cobertura** (Seção 17): usa o `frequencia_esperada_dias` já
  existente no schema desde a Fase 1 mas nunca exposto pela API — corrigido, agora
  configurável na tela de PDVs. A query considera a visita mais recente (ou a data de
  criação do PDV, se nunca visitado) contra a frequência esperada.
- **Mapa de cobertura** (Seção 15, `MapaPage.tsx`, biblioteca Leaflet + tiles do
  OpenStreetMap — sem chave de API): PDVs plotados coloridos por promotor
  responsável, com filtro por promotor e popup com nome/cidade/promotor. PDVs sem
  latitude/longitude cadastrada ficam de fora, com aviso visível de quantos.

### Bugs reais encontrados e corrigidos durante a validação desta fase

- `PATCH /pdvs/:id` nunca persistia latitude/longitude, mesmo depois de eu adicionar
  esses campos ao formulário de edição — o `UPDATE` SQL simplesmente não os incluía.
  Encontrado testando o mapa (PDVs editados não apareciam nele). Corrigido.
- **Limitação conhecida, não corrigida ainda**: os `PATCH` de PDV/produto usam
  `COALESCE($n, coluna)` para só atualizar campos enviados — isso funciona para
  "definir um valor", mas não existe forma de **limpar** um campo (ex.: remover o
  promotor responsável de um PDV) por esse endpoint, porque o driver Postgres não
  distingue "campo não enviado" de "enviado como null" no nível SQL. Não é um bug que
  corrompe dados, só uma ação que a UI oferece (selecionar "Sem promotor responsável"
  num PDV já atribuído) e não tem efeito. Corrigir exigiria mudar o padrão de todos os
  `PATCH` existentes para checar presença de chave no corpo da requisição, não só o
  valor — vale fazer numa passada dedicada, não author-by-author.

## Concluído — Fase 4: Recursos avançados (exceto notificações)

- **Schema** (`data/schema_04_avancado.sql`): `expiration_settings` +
  `expiration_records` (validades), `surveys` + `survey_questions` +
  `survey_responses` + `survey_answers` (pesquisas), `events` + `event_promoters` +
  `event_products` + `event_results` (eventos). Mesmo padrão de sempre: `tenant_id` +
  RLS, `client_id` de idempotência nas tabelas que o promotor escreve offline.
- **Controle de validades** (Seção 14): limiares 🔴/🟡/🟠 configuráveis por tenant
  (`ExpirationsPage.tsx`), promotor registra produto+quantidade+validade durante o
  atendimento (offline-capaz), integrado ao painel "O que merece atenção hoje" do
  dashboard.
- **Pesquisas dinâmicas** (Seção 11): admin monta a pesquisa (`SurveysPage.tsx`) com
  perguntas de texto/número/sim-não/múltipla escolha/seleção única/nota (foto
  propositalmente não suportado ainda, ver `docs/DECISIONS.md`), ativa/encerra;
  promotor responde durante o atendimento (`SurveyAnswerModal.tsx`, renderiza o input
  certo por tipo de pergunta); admin vê as respostas agrupadas por PDV/promotor.
  **Sem targeting por rota/PDV/evento ainda** — qualquer pesquisa ativa aparece para
  qualquer promotor em qualquer visita (decisão deliberada, ver `docs/DECISIONS.md`).
- **Eventos e degustações** (Seção 12): admin cria evento vinculado a um PDV com
  promotores e produtos escalados (`EventsPage.tsx`); aparece numa seção própria
  "Meus eventos" do promotor (`MyEvents.tsx`, **não misturado com a rota do dia** —
  o briefing pede isso explicitamente); promotor registra pessoas
  abordadas/degustações/quantidade distribuída.
- **Relatórios/exportação CSV** (Seção 18): visitas, ocorrências, PDVs, preços
  coletados (`ReportsPage.tsx`, `apps/api/src/services/csv.ts`). BOM UTF-8 para abrir
  corretamente no Excel; download via fetch+blob autenticado (mesmo padrão de fotos),
  não link direto.
- **Pendente, não implementado**: notificações (Seção 14) — decisão de provedor de
  e-mail ainda não tomada (ver `docs/DECISIONS.md`); a estrutura de dados já suporta
  identificar "quem precisa ser avisado" (classificação de validade, ocorrências
  abertas), só falta o canal de envio.

### Bugs reais encontrados e corrigidos durante a validação desta fase

1. **Regressão de autorização que já tinha sido documentada e aconteceu de novo**:
   `dashboardRouter.use(requireAuth, requireRole(...))` e
   `reportsRouter.use(requireAuth, requireRole(...))` — o mesmo padrão do bug do
   `/uploads` da Fase 2 (`router.use(mw)` sem caminho intercepta *qualquer* rota
   que passe por aquele router na cadeia do app, não só as suas). Isso bloqueava
   promotores com 403 em `GET /surveys/active` e `GET /events/mine` — rotas de
   *outros* routers montados depois na `index.ts`, sem relação nenhuma com dashboard
   ou relatórios. Corrigido movendo o middleware para dentro de cada rota
   individualmente. **Motivo de ter acontecido de novo apesar de já documentado**:
   o padrão errado (`router.use(requireAuth, requireRole(...))`) parece natural de
   escrever num router novo — vale revisar isso especificamente ao adicionar
   qualquer router futuro, não só confiar na memória do que já foi corrigido antes.
2. Datas (`DATE`, não `TIMESTAMPTZ`) voltavam da API como timestamp completo em vez
   de `AAAA-MM-DD` em três lugares (`expirations`, `events` × 3 consultas) — mesmo
   padrão do bug já corrigido em `routes.data` na Fase 2, reintroduzido em código
   novo. Corrigido com `to_char(coluna, 'YYYY-MM-DD')` nas queries.
3. Relatórios CSV mostravam datas no formato verboso do `Date.toString()` do
   JavaScript (`Thu Aug 27 2026 09:55:09 GMT-0300 (Horário Padrão de Brasília)`) em
   vez de um formato limpo — `node-pg` devolve colunas de timestamp como objetos
   `Date`, e a serialização CSV genérica fazia `String(value)`. Corrigido uma vez no
   serializador CSV (`apps/api/src/services/csv.ts`), não em cada query.

## Concluído — Notificações (Seção 14, provedor: Resend)

- **Schema** (`data/schema_05_notificacoes.sql`): `app.notifications` (log — é a
  "notificação dentro do sistema" da Seção 14, sempre gravada mesmo quando o e-mail
  não sai), coluna `notificar_email` em `app.pdvs` (autorização explícita para
  notificar o e-mail do PDV, não assumida).
- **Estrutura de canal plugável**: `services/email.ts` isola a chamada ao Resend;
  `services/notifications.ts` (quem decide mandar e para quem) nunca importa o SDK do
  Resend diretamente — trocar de provedor no futuro, ou adicionar SMS/push, é mudar
  um arquivo, não repensar quem decide notificar.
- Quando um registro de validade nasce crítico, notifica automaticamente: promotor
  responsável pelo PDV, supervisor dele, todo gerente do tenant, e o e-mail do PDV
  (só se `notificar_email = true`). Nunca bloqueia a resposta ao promotor — dispara
  numa conexão própria com `.catch()` explícito (ver `docs/RISKS.md`/`CLAUDE.md`
  sobre por que uma promise solta sem `.catch` já derrubou o processo antes).
- **Sem `RESEND_API_KEY` configurada, o sistema não trava** — loga no console e
  registra a notificação com status `pulada` (não `enviada`, que seria mentira) no
  histórico (`NotificationsPage.tsx`). Dá para rodar e testar todo o resto do sistema
  sem uma conta Resend real.
- Tela de PDVs ganhou campo de e-mail e o checkbox de consentimento; tela de
  Notificações mostra o histórico com status por destinatário.

### Bugs reais encontrados e corrigidos durante a validação

1. **`UNIQUE` normal não serve para deduplicar quando uma das colunas pode ser
   `NULL`** — a notificação do e-mail do PDV (sem `destinatario_user_id`) nunca
   colidiria com ela mesma, porque SQL trata cada `NULL` como distinto dos outros.
   Corrigido com dois índices únicos parciais (um para destinatário com usuário, um
   para destinatário só por e-mail) em vez de um `UNIQUE` único.
2. **Consequência do anterior**: com dois índices únicos parciais, o Postgres não
   consegue inferir sozinho qual usar num `ON CONFLICT DO NOTHING` sem alvo explícito
   (erro `42P10`, "could not infer arbiter") — corrigido apontando o `ON CONFLICT`
   para o índice certo (incluindo o `WHERE` dele) conforme o destinatário tem ou não
   `userId`.
3. Validado que o *retry* idempotente (mesmo `clientId` reenviado) não duplica
   notificações — 3 eventos de teste distintos, cada um gerando exatamente 4
   notificações (promotor/supervisor/gerente/e-mail do PDV), confirmado consultando
   `GET /notifications` antes e depois de um reenvio deliberado.

## Pendente para fechar a Fase 4

- Exibição de respostas de múltipla escolha na tela de pesquisas ainda mostra o
  JSON bruto (`["Marca A","Marca B"]`) em vez de uma lista formatada — cosmético,
  não bloqueia o uso.
- Suporte a perguntas do tipo "foto" em pesquisas (aceita a pergunta, mas ainda não
  captura a imagem) — ver `docs/DECISIONS.md`.
- Notificações cobrem só "validade crítica" por ora — ocorrências de prioridade alta
  ou PDVs sem cobertura poderiam usar a mesma estrutura de canal no futuro, mas isso
  não foi pedido explicitamente e não foi antecipado.

## Como rodar localmente

```bash
cp .env.example .env

# banco de dados
docker compose -f infra/docker-compose.yml up -d
docker exec -i promota-db psql -U promota -d promota < data/schema.sql

# criar o primeiro tenant + admin
cd apps/api
MIGRATE_DATABASE_URL="postgres://promota:promota@localhost:5433/promota" \
  npm run seed -- --slug minha-empresa --nome "Minha Empresa" \
  --admin-email admin@minhaempresa.com --admin-senha escolha-uma-senha

# API — http://localhost:3334/health
npm install && npm run dev

# frontend — http://localhost:5173 (login com o slug/e-mail/senha do seed acima)
cd ../web && npm install && npm run dev
```
