import { ACTIVE_VISIT_KEY as KEY } from './localKeys';

// Cada visita em andamento precisa lembrar o visitId (retornado pelo servidor no
// check-in) para o check-out e a coleta de preço funcionarem. Enquanto o check-in
// está só na fila offline (ainda não sincronizado), visitId fica vazio — é
// atualizado aqui assim que a fila sincroniza (ver offline/syncManager.ts). Sem
// isso, o promotor fica travado: o check-in chega no servidor mas o app nunca fica
// sabendo o visitId real, e o check-out nunca consegue ser enviado.
export interface ActiveVisit {
  visitId: string;
  clientId: string;
}

export function loadActiveVisits(): Record<string, ActiveVisit> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    return {};
  }
}

export function saveActiveVisit(routePdvId: string, visit: ActiveVisit): void {
  const all = loadActiveVisits();
  all[routePdvId] = visit;
  localStorage.setItem(KEY, JSON.stringify(all));
}

/** Encontra a entrada com este clientId (usado ao sincronizar) e preenche o visitId real. */
export function resolveActiveVisit(clientId: string, visitId: string): void {
  const all = loadActiveVisits();
  for (const routePdvId of Object.keys(all)) {
    if (all[routePdvId].clientId === clientId) {
      all[routePdvId] = { ...all[routePdvId], visitId };
    }
  }
  localStorage.setItem(KEY, JSON.stringify(all));
}
