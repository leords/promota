import { useEffect, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { getPdv, listPhotosByPdv, fetchPhotoBlobUrl, type PdvDetail as PdvDetailData, type Photo } from '../../api/admin';

const CATEGORIA_LABEL: Record<string, string> = {
  antes: 'Antes',
  depois: 'Depois',
  gondola: 'Gôndola',
  ponto_extra: 'Ponto extra',
  merchandising: 'Merchandising',
  ruptura: 'Ruptura',
  livre: 'Livre',
};

export default function PdvDetail({ pdvId, onClose }: { pdvId: string; onClose: () => void }) {
  const { token } = useAuth();
  const [pdv, setPdv] = useState<PdvDetailData | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!token) return;
    getPdv(token, pdvId).then(setPdv).catch(() => setPdv(null));
    listPhotosByPdv(token, pdvId).then(setPhotos).catch(() => setPhotos([]));
  }, [token, pdvId]);

  // Cada foto é servida autenticada (ver api/admin.ts) — buscamos o blob de cada uma
  // e guardamos a object URL local; revogadas ao desmontar para não vazar memória.
  useEffect(() => {
    if (!token || photos.length === 0) return;
    let cancelled = false;
    const urls: string[] = [];

    Promise.all(
      photos.map(async (photo) => {
        const url = await fetchPhotoBlobUrl(token, photo.id).catch(() => null);
        if (url) urls.push(url);
        return [photo.id, url] as const;
      }),
    ).then((entries) => {
      if (cancelled) return;
      setPhotoUrls(Object.fromEntries(entries.filter(([, url]) => url) as [string, string][]));
    });

    return () => {
      cancelled = true;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [token, photos]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'grid', placeItems: 'center', zIndex: 10 }}>
      <div style={{ background: 'white', color: '#0f172a', padding: 24, borderRadius: 8, width: 640, maxHeight: '85vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
          <h2 style={{ marginTop: 0 }}>{pdv?.nome ?? 'Carregando...'}</h2>
          <button onClick={onClose}>Fechar</button>
        </div>

        {pdv && (
          <>
            <p style={{ color: '#475569' }}>
              {[pdv.logradouro, pdv.numero, pdv.bairro, pdv.cidade, pdv.uf].filter(Boolean).join(', ') || 'Endereço não informado'}
            </p>

            <h3>Últimas visitas</h3>
            {pdv.ultimasVisitas.length === 0 && <p style={{ color: '#64748b' }}>Nenhuma visita registrada ainda.</p>}
            <ul style={{ paddingLeft: 18 }}>
              {pdv.ultimasVisitas.map((v) => (
                <li key={v.id}>
                  {new Date(v.checkin_em).toLocaleString('pt-BR')} — {v.promotor}
                  {v.duracao_segundos ? ` — ${Math.round(v.duracao_segundos / 60)} min` : ' — em andamento'}
                </li>
              ))}
            </ul>

            <h3>Preços coletados</h3>
            {pdv.precos.length === 0 && <p style={{ color: '#64748b' }}>Nenhum preço coletado ainda.</p>}
            <ul style={{ paddingLeft: 18 }}>
              {pdv.precos.map((p) => (
                <li key={p.id}>
                  {p.produto}: R$ {p.preco} {p.marca ? `(${p.marca})` : ''} —{' '}
                  {new Date(p.coletado_em).toLocaleDateString('pt-BR')}
                </li>
              ))}
            </ul>

            <h3>Fotos</h3>
            {photos.length === 0 && <p style={{ color: '#64748b' }}>Nenhuma foto enviada ainda.</p>}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              {photos.map((photo) =>
                photoUrls[photo.id] ? (
                  <a key={photo.id} href={photoUrls[photo.id]} target="_blank" rel="noreferrer">
                    <img
                      src={photoUrls[photo.id]}
                      alt={CATEGORIA_LABEL[photo.categoria] ?? photo.categoria}
                      style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 4 }}
                    />
                    <p style={{ fontSize: 12, margin: '2px 0', textAlign: 'center' }}>{CATEGORIA_LABEL[photo.categoria] ?? photo.categoria}</p>
                  </a>
                ) : (
                  <p key={photo.id} style={{ fontSize: 12, color: '#64748b' }}>
                    Carregando...
                  </p>
                ),
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
