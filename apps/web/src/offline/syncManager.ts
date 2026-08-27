import { getOfflineDB } from './db';
import { markFailed, markSynced } from './syncQueue';
import {
  checkin,
  checkout,
  collectPrice,
  uploadPhoto,
  createOccurrence,
  createExpirationRecord,
  submitSurveyResponse,
  type PhotoCategory,
} from '../api/operacao';
import { ApiError } from '../api/client';
import { resolveActiveVisit } from './activeVisits';

/**
 * Drena a fila de sincronização — chamado quando o app volta a ficar online (ver
 * hook useSyncOnReconnect) ou manualmente. Cada `kind` mapeia para a chamada de API
 * correspondente; o `clientId` gerado no momento do enfileiramento é o que garante
 * que reenviar não duplica (ver docs/ARCHITECTURE.md).
 */
export async function drainSyncQueue(token: string): Promise<void> {
  const db = await getOfflineDB();
  const pending = await db.getAllFromIndex('sync_queue', 'by-status', 'pending');

  for (const item of pending) {
    try {
      await db.put('sync_queue', { ...item, status: 'syncing' });
      switch (item.kind) {
        case 'checkin': {
          const payload = item.payload as Parameters<typeof checkin>[1];
          const result = await checkin(token, payload);
          // Sem isto, o check-in fica sincronizado no servidor mas o app continua
          // achando que não tem visitId — o promotor fica travado sem conseguir
          // fazer check-out. Encontrado num teste real de reconexão (ver
          // docs/RISKS.md).
          resolveActiveVisit(payload.clientId, result.id);
          break;
        }
        case 'checkout':
          await checkout(token, item.payload as Parameters<typeof checkout>[1]);
          break;
        case 'price_collection':
          await collectPrice(token, item.payload as Parameters<typeof collectPrice>[1]);
          break;
        case 'photo': {
          const payload = item.payload as { clientId: string; visitId: string; categoria: PhotoCategory; blob: Blob };
          await uploadPhoto(token, { clientId: payload.clientId, visitId: payload.visitId, categoria: payload.categoria, file: payload.blob });
          break;
        }
        case 'occurrence':
          await createOccurrence(token, item.payload as Parameters<typeof createOccurrence>[1]);
          break;
        case 'expiration':
          await createExpirationRecord(token, item.payload as Parameters<typeof createExpirationRecord>[1]);
          break;
        case 'survey_response':
          await submitSurveyResponse(token, item.payload as Parameters<typeof submitSurveyResponse>[1]);
          break;
        default:
          throw new Error(`tipo de fila desconhecido: ${item.kind}`);
      }
      await markSynced(item.id);
    } catch (err) {
      // Erro de negócio (4xx) não se resolve tentando de novo — marca como falha
      // visível. Falha de rede volta para 'pending' e será retentada na próxima
      // reconexão (ver docs/RISKS.md: "conflitos e perda de dados na sincronização").
      if (err instanceof ApiError) {
        await markFailed(item.id, `erro ${err.status}`);
      } else {
        await db.put('sync_queue', { ...item, status: 'pending' });
      }
    }
  }
}
