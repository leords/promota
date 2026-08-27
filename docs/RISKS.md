# Riscos técnicos

## UNIQUE normal não deduplica quando uma coluna pode ser NULL

`app.notifications` precisa impedir notificar a mesma pessoa duas vezes sobre o mesmo
evento. A primeira tentativa foi um `UNIQUE(tipo, referencia_tabela, referencia_id,
destinatario_email, destinatario_user_id)` — mas para o caso de notificar o e-mail
cadastrado do PDV (sem usuário associado, `destinatario_user_id` fica `NULL`), duas
inserções nunca colidiriam: SQL trata cada `NULL` como distinto de qualquer outro
`NULL`, então "a mesma notificação" com `user_id = NULL` duas vezes não é uma
duplicata aos olhos do banco.

**Mitigação:** dois índices únicos **parciais** — um `WHERE destinatario_user_id IS
NOT NULL` (dedup por usuário), outro `WHERE destinatario_user_id IS NULL` (dedup por
e-mail puro) — em vez de um `UNIQUE` só. **Efeito colateral a saber:** com índices
parciais, `ON CONFLICT DO NOTHING` sem alvo explícito não funciona (Postgres não
consegue inferir sozinho qual dos dois usar — erro `42P10`); o `ON CONFLICT` precisa
apontar para o índice certo, incluindo o `WHERE` dele, escolhido em tempo de execução
conforme o caso. Ver `apps/api/src/services/notifications.ts`.

## PATCH com COALESCE não consegue limpar um campo

Todo endpoint de atualização parcial (`PATCH /pdvs/:id`, `PATCH /products/:id`) usa
`UPDATE ... SET coluna = COALESCE($n, coluna)` para só sobrescrever campos enviados.
Isso funciona para "definir um valor novo", mas não existe como **remover** um valor
(ex.: desatribuir o promotor responsável de um PDV) — o driver do Postgres não
distingue, a nível SQL, "campo ausente do corpo da requisição" de "campo enviado como
`null`", então `COALESCE` sempre mantém o valor antigo nos dois casos.

**Não é um bug que corrompe dados** — só uma ação que a interface pode oferecer (ex.:
opção "Sem promotor responsável" num PDV já atribuído) sem efeito real ao salvar.
Notado ao construir a tela de PDVs/mapa na Fase 3.

**Mitigação, se/quando virar um problema real:** trocar o padrão desses `PATCH` para
checar a presença da chave no corpo da requisição (`'campo' in req.body`) em vez de
confiar em `COALESCE`, e tratar `null` explícito como "limpar". Vale fazer numa
passada dedicada cobrindo todos os `PATCH` existentes de uma vez, não endpoint por
endpoint conforme for incomodando.

## Vazamento de dados entre empresas (multi-tenant)

O risco mais grave do produto: um bug de aplicação (query sem filtro de tenant)
expõe dados de uma empresa para outra.

**Mitigação:** Row-Level Security no Postgres como segunda camada, independente da
aplicação (ver `docs/ARCHITECTURE.md`). Toda nova tabela operacional **precisa** de
`tenant_id` + policy RLS antes de ir para produção — isso deve ser parte do checklist
de qualquer PR que crie tabela nova.

## Conflitos e perda de dados na sincronização offline

Dois cenários perigosos: (1) o mesmo registro criado offline sendo sincronizado duas
vezes (ex.: retry após timeout, mas o servidor já recebeu); (2) um registro sendo
perdido silenciosamente se a sincronização falhar sem o usuário perceber.

**Mitigação:** UUID gerado no cliente para todo registro criado offline + upsert
idempotente no servidor (nunca `INSERT` simples nesses endpoints); status visível de
"N registros aguardando sincronização" na UI, nunca uma sincronização silenciosa que
falha sem indicação.

**Confirmado por teste real (não hipotético) que "idempotente" exige atomicidade, não
só um UUID**: os endpoints de check-in/preço/foto faziam `SELECT existe? senão
INSERT`, e duas requisições concorrentes com o mesmo `client_id` — reproduzido de
verdade ao testar a fila offline, apareceu no log do servidor como
`duplicate key value violates unique constraint "visits_client_id_key"` — podiam
ambas passar pelo `SELECT` antes de qualquer uma inserir, e a segunda quebrava com
500. O cliente então marcava como "falha" um check-in que na prática já tinha sido
salvo pela primeira requisição. Corrigido com `INSERT ... ON CONFLICT (client_id) DO
NOTHING` (atômico) + leitura do existente quando o conflito ocorre. **Qualquer novo
endpoint idempotente por UUID de cliente deve seguir esse padrão, nunca
SELECT-então-INSERT** — ver `apps/api/src/routes/visits.ts`.

## Falso senso de precisão em check-in geolocalizado

GPS de celular em ambientes urbanos/internos pode ter erro de dezenas a centenas de
metros. Tratar "distância do check-in até o PDV" como métrica policial rígida geraria
punição injusta a promotores.

**Mitigação:** registrar a precisão do GPS junto com a localização (já previsto no
schema de check-in, Fase 2) e permitir justificativa — conforme o próprio briefing
já define ("o objetivo não é criar um sistema policial").

## Ranking de produtividade mal utilizado

O briefing proíbe explicitamente ranking simplista de promotores ou "índice de
qualidade de execução". O risco técnico aqui é de produto: é fácil um dashboard
"neutro" (ex.: ordenar promotores por número de visitas) ser lido/usado como ranking
na prática.

**Mitigação:** ao construir a Fase 3 (dashboards por promotor), não ordenar
promotores por métrica de volume por padrão, e sempre contextualizar números com o
tamanho da carteira/rota de cada um.

## Volume de fotos e armazenamento

Fotos por visita, por promotor, multiplicadas por muitos PDVs/dia, em múltiplos
tenants, crescem rápido em armazenamento e em custo.

**Mitigação:** decidir provedor de storage antes da Fase 2 (ver pendência em
`docs/DECISIONS.md`); comprimir/redimensionar no cliente antes do upload quando
possível para poupar banda em conexões de campo ruins.

## Servir arquivos por caminho estático vaza dados entre tenants

Encontrado de verdade (não hipotético): `/uploads` estava montado como
`express.static`, servindo qualquer foto pelo nome do arquivo, sem nenhuma checagem
de que o usuário autenticado pertence ao tenant dono daquela foto. O nome do arquivo
é um UUID gerado pelo servidor — não é secreto, é só "difícil de adivinhar", o que
não é a mesma coisa que controle de acesso. Qualquer pessoa com a URL (vazada por um
link compartilhado, um proxy de cache, um histórico de navegador) conseguiria ver a
foto de outra empresa.

**Mitigação:** nenhum arquivo de usuário (fotos, e futuramente relatórios/exports)
deve ser servido por caminho estático público. Sempre por uma rota autenticada que
faça o lookup do registro no banco primeiro (RLS aplica o filtro de tenant
automaticamente) e só então sirva o arquivo — ver `GET /photos/:id/file` em
`apps/api/src/routes/photos.ts`. O frontend busca autenticado e monta um blob URL
local, já que `<img src>` não manda header `Authorization`.

**Detalhe de roteamento do Express que causou isso**: cada router de feature
(`pdvsRouter`, `productsRouter`, etc.) é montado em `app.use(algumRouter)` sem
prefixo de caminho, e cada um chama `algumRouter.use(requireAuth)` antes de suas
rotas. Esse `.use()` sem caminho casa com **qualquer** requisição que chegue até ali
na cadeia — inclusive `/uploads/foo.png` — não só as rotas que aquele router
declara. Foi por isso que a versão pública original quebrava silenciosamente para
qualquer requisição sem header `Authorization` (como uma tag `<img>` normal manda):
o primeiro router com `requireAuth` na cadeia intercepta e devolve 401 antes do
`express.static` ser alcançado. Ao adicionar um novo router "global" (sem prefixo)
com middleware de auth, ter isso em mente.

## RLS mal configurado é pior do que não ter RLS (falso senso de segurança)

Uma policy RLS escrita incorretamente (ex.: sem `FORCE ROW LEVEL SECURITY`, ou usando
um `current_setting` sem valor padrão seguro) pode aparentar estar protegendo os dados
sem realmente estar.

**Mitigação:** toda tabela com RLS usa `ALTER TABLE ... FORCE ROW LEVEL SECURITY`
(aplica a policy até para o dono da tabela) e a policy nunca assume um default
permissivo — `current_setting('app.tenant_id', true)` retornando `NULL` deve resultar
em zero linhas visíveis, não em "sem filtro".
