import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

// Fundação do armazenamento offline (ver docs/ARCHITECTURE.md, seção Offline First).
// Cada registro criado offline (check-in, preço, ocorrência, foto, resposta de
// pesquisa) entra aqui com um UUID gerado no cliente e status de sincronização — os
// fluxos que de fato gravam nessa fila são implementados junto de cada feature
// (Fases 2-4), não aqui.

export type SyncStatus = 'pending' | 'syncing' | 'synced' | 'failed';

export interface SyncQueueItem {
  id: string; // UUID gerado no cliente — usado como chave de idempotência no servidor
  kind: string; // ex.: 'checkin', 'price_collection', 'occurrence', 'photo'
  payload: unknown;
  status: SyncStatus;
  attempts: number;
  createdAt: string;
  lastError?: string;
}

interface PromotaOfflineDB extends DBSchema {
  sync_queue: {
    key: string;
    value: SyncQueueItem;
    indexes: { 'by-status': SyncStatus };
  };
}

let dbPromise: Promise<IDBPDatabase<PromotaOfflineDB>> | undefined;

export function getOfflineDB() {
  dbPromise ??= openDB<PromotaOfflineDB>('promota-offline', 1, {
    upgrade(db) {
      const store = db.createObjectStore('sync_queue', { keyPath: 'id' });
      store.createIndex('by-status', 'status');
    },
  });
  return dbPromise;
}
