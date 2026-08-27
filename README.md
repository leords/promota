# Promota — Gestão de Promotores e Inteligência de Campo

Plataforma web multi-tenant para gestão de equipes de promotores, execução em pontos
de venda e inteligência comercial. PWA, mobile-first para o promotor em campo
(offline first), desktop-otimizado para gestão.

Documentação completa em [`docs/`](./docs):

- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — stack, multi-tenancy (RLS), offline first
- [`docs/DECISIONS.md`](./docs/DECISIONS.md) — decisões técnicas e por quê
- [`docs/RISKS.md`](./docs/RISKS.md) — riscos técnicos e mitigações
- [`docs/NEXT_STEPS.md`](./docs/NEXT_STEPS.md) — status atual, como rodar, próxima fase

## Estrutura

```
apps/web/    frontend (React + TypeScript + Vite + PWA)
apps/api/     API REST (Node + TypeScript + Express)
data/          schema.sql — banco multi-tenant com Row-Level Security
infra/         docker-compose (PostgreSQL + PostGIS)
```

## Como rodar localmente

Ver instruções completas em [`docs/NEXT_STEPS.md`](./docs/NEXT_STEPS.md#como-rodar-localmente).

Status atual: **Fase 1 (fundação) concluída** — multi-tenancy com RLS, autenticação
JWT, fundação Offline First (IndexedDB + fila de sincronização), PWA configurada.
