import { getOfflineDB, type SyncQueueItem } from './db';

/**
 * Fila de sincronização — enfileira mutações feitas offline com um UUID gerado no
 * cliente (garante que o servidor possa fazer upsert idempotente em vez de duplicar
 * ao reenviar). Drenagem/retry real acontece quando cada tipo de registro (check-in,
 * preço, foto, ocorrência) for implementado nas Fases 2-4; esta classe é a fundação
 * comum que todos eles vão reusar.
 */
export async function enqueue(kind: string, payload: unknown): Promise<SyncQueueItem> {
  const db = await getOfflineDB();
  const item: SyncQueueItem = {
    id: crypto.randomUUID(),
    kind,
    payload,
    status: 'pending',
    attempts: 0,
    createdAt: new Date().toISOString(),
  };
  await db.put('sync_queue', item);
  return item;
}

export async function pendingCount(): Promise<number> {
  const db = await getOfflineDB();
  const pending = await db.getAllFromIndex('sync_queue', 'by-status', 'pending');
  const syncing = await db.getAllFromIndex('sync_queue', 'by-status', 'syncing');
  return pending.length + syncing.length;
}

export async function failedCount(): Promise<number> {
  const db = await getOfflineDB();
  const failed = await db.getAllFromIndex('sync_queue', 'by-status', 'failed');
  return failed.length;
}

/** Volta todo item 'failed' para 'pending' para a próxima drenagem tentar de novo —
 * usado pelo botão "tentar novamente" (ver pages/RouteToday.tsx). Um erro de negócio
 * (ex.: 404 porque a visita não existe mais) pode continuar falhando, mas isso é
 * visível de novo como 'failed', nunca escondido. */
export async function retryFailed(): Promise<void> {
  const db = await getOfflineDB();
  const failed = await db.getAllFromIndex('sync_queue', 'by-status', 'failed');
  for (const item of failed) {
    await db.put('sync_queue', { ...item, status: 'pending' });
  }
}

export async function markSynced(id: string): Promise<void> {
  const db = await getOfflineDB();
  const item = await db.get('sync_queue', id);
  if (!item) return;
  await db.put('sync_queue', { ...item, status: 'synced' });
}

export async function markFailed(id: string, error: string): Promise<void> {
  const db = await getOfflineDB();
  const item = await db.get('sync_queue', id);
  if (!item) return;
  await db.put('sync_queue', {
    ...item,
    status: 'failed',
    attempts: item.attempts + 1,
    lastError: error,
  });
}
