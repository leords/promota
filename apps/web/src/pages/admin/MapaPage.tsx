import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useAuth } from '../../auth/AuthContext';
import { listPdvs, listUsers, type Pdv, type UserSummary } from '../../api/admin';

// Paleta fixa para promotores — cores consistentes entre renders (não geradas por
// hash, para evitar duas cores parecidas de cair lado a lado por acaso).
const PALETTE = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#65a30d'];
const SEM_PROMOTOR_COLOR = '#94a3b8';

function colorFor(promotorId: string | null, promotorIds: string[]): string {
  if (!promotorId) return SEM_PROMOTOR_COLOR;
  const index = promotorIds.indexOf(promotorId);
  return PALETTE[index % PALETTE.length];
}

export default function MapaPage() {
  const { token } = useAuth();
  const [pdvs, setPdvs] = useState<Pdv[]>([]);
  const [promotores, setPromotores] = useState<UserSummary[]>([]);
  const [filtroPromotor, setFiltroPromotor] = useState('');
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const markersLayer = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!token) return;
    listPdvs(token).then(setPdvs).catch(() => setPdvs([]));
    listUsers(token, 'promotor').then(setPromotores).catch(() => setPromotores([]));
  }, [token]);

  // Mapa criado uma vez; camada de marcadores recriada quando os dados/filtro mudam
  // (mais simples e barato o suficiente para a quantidade de PDVs de um MVP do que
  // fazer diffing de marcadores individuais).
  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;
    mapInstance.current = L.map(mapRef.current).setView([-23.55, -46.63], 11); // centro: São Paulo
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(mapInstance.current);
    markersLayer.current = L.layerGroup().addTo(mapInstance.current);
  }, []);

  useEffect(() => {
    if (!markersLayer.current) return;
    markersLayer.current.clearLayers();

    const promotorIds = promotores.map((p) => p.id);
    const visiveis = pdvs.filter(
      (p) => p.latitude !== null && p.longitude !== null && (!filtroPromotor || p.promotor_responsavel_id === filtroPromotor),
    );

    for (const pdv of visiveis) {
      const color = colorFor(pdv.promotor_responsavel_id, promotorIds);
      const promotorNome = promotores.find((p) => p.id === pdv.promotor_responsavel_id)?.nome ?? 'Sem promotor responsável';
      L.circleMarker([pdv.latitude!, pdv.longitude!], {
        radius: 8,
        color,
        fillColor: color,
        fillOpacity: 0.8,
        weight: 2,
      })
        .bindPopup(`<strong>${pdv.nome}</strong><br/>${pdv.cidade ?? ''}<br/>Promotor: ${promotorNome}`)
        .addTo(markersLayer.current);
    }

    if (visiveis.length > 0 && mapInstance.current) {
      const bounds = L.latLngBounds(visiveis.map((p) => [p.latitude!, p.longitude!] as [number, number]));
      mapInstance.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
    }
  }, [pdvs, promotores, filtroPromotor]);

  const semCoordenadas = pdvs.filter((p) => p.latitude === null || p.longitude === null).length;

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2>Mapa de cobertura</h2>
        <select value={filtroPromotor} onChange={(e) => setFiltroPromotor(e.target.value)}>
          <option value="">Todos os promotores</option>
          {promotores.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
            </option>
          ))}
        </select>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12, fontSize: 13 }}>
        {promotores.map((p, i) => (
          <span key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: PALETTE[i % PALETTE.length], display: 'inline-block' }} />
            {p.nome}
          </span>
        ))}
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: SEM_PROMOTOR_COLOR, display: 'inline-block' }} />
          Sem promotor responsável
        </span>
      </div>

      {semCoordenadas > 0 && (
        <p style={{ color: '#92400e', fontSize: 13 }}>
          {semCoordenadas} PDV(s) sem latitude/longitude cadastrada não aparecem no mapa.
        </p>
      )}

      <div ref={mapRef} style={{ height: 500, borderRadius: 8, border: '1px solid #e2e8f0' }} />
    </section>
  );
}
