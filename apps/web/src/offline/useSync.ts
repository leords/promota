import { useEffect, useState } from 'react';
import { drainSyncQueue } from './syncManager';
import { failedCount, pendingCount, retryFailed } from './syncQueue';

/** Mantém status online/offline e a contagem de pendências/falhas, e drena a fila ao reconectar. */
export function useSync(token: string | null) {
  const [online, setOnline] = useState(navigator.onLine);
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState(0);

  const refreshCounts = () => {
    pendingCount().then(setPending);
    failedCount().then(setFailed);
  };

  useEffect(() => {
    refreshCounts();
    const interval = setInterval(refreshCounts, 5000);

    async function goOnline() {
      setOnline(true);
      if (token) {
        await drainSyncQueue(token);
        refreshCounts();
      }
    }
    const goOffline = () => setOnline(false);

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    if (navigator.onLine && token) drainSyncQueue(token).then(refreshCounts);

    return () => {
      clearInterval(interval);
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, [token]);

  async function retry() {
    if (!token) return;
    await retryFailed();
    await drainSyncQueue(token);
    refreshCounts();
  }

  return { online, pending, failed, retry };
}
