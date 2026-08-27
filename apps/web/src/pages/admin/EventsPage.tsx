import { useEffect, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import {
  listEvents,
  createEvent,
  getEvent,
  listPdvs,
  listUsers,
  listProducts,
  type EventSummary,
  type EventDetail,
  type Pdv,
  type UserSummary,
  type Product,
} from '../../api/admin';

const todayISO = () => new Date().toISOString().slice(0, 10);

export default function EventsPage() {
  const { token } = useAuth();
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [pdvs, setPdvs] = useState<Pdv[]>([]);
  const [promotores, setPromotores] = useState<UserSummary[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [nome, setNome] = useState('');
  const [pdvId, setPdvId] = useState('');
  const [data, setData] = useState(todayISO());
  const [meta, setMeta] = useState('');
  const [promotorIds, setPromotorIds] = useState<string[]>([]);
  const [productIds, setProductIds] = useState<string[]>([]);

  function reload() {
    if (!token) return;
    listEvents(token).then(setEvents).catch(() => setEvents([]));
    listPdvs(token).then(setPdvs).catch(() => setPdvs([]));
    listUsers(token, 'promotor').then(setPromotores).catch(() => setPromotores([]));
    listProducts(token).then(setProducts).catch(() => setProducts([]));
  }

  useEffect(reload, [token]);

  function toggle(list: string[], setList: (v: string[]) => void, id: string) {
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  }

  async function handleCreate() {
    if (!token || !nome.trim() || !pdvId || promotorIds.length === 0) return;
    await createEvent(token, { nome, pdvId, data, meta: meta || undefined, promotorIds, productIds });
    setNome('');
    setPdvId('');
    setMeta('');
    setPromotorIds([]);
    setProductIds([]);
    setShowForm(false);
    reload();
  }

  if (selectedId && token) {
    return <EventDetailView token={token} eventId={selectedId} onBack={() => setSelectedId(null)} />;
  }

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2>Eventos e degustações</h2>
        <button onClick={() => setShowForm((v) => !v)}>{showForm ? 'Cancelar' : 'Novo evento'}</button>
      </div>

      {showForm && (
        <div style={{ display: 'grid', gap: 8, marginBottom: 24, maxWidth: 420 }}>
          <input placeholder="Nome do evento" value={nome} onChange={(e) => setNome(e.target.value)} />
          <select value={pdvId} onChange={(e) => setPdvId(e.target.value)}>
            <option value="">Selecione o PDV</option>
            {pdvs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
          <input type="date" value={data} onChange={(e) => setData(e.target.value)} />
          <input placeholder="Meta/objetivo (opcional)" value={meta} onChange={(e) => setMeta(e.target.value)} />

          <p style={{ marginBottom: 0 }}>Promotores participantes:</p>
          <div style={{ border: '1px solid #e2e8f0', padding: 8, display: 'grid', gap: 4 }}>
            {promotores.map((p) => (
              <label key={p.id} style={{ display: 'flex', gap: 8 }}>
                <input type="checkbox" checked={promotorIds.includes(p.id)} onChange={() => toggle(promotorIds, setPromotorIds, p.id)} />
                {p.nome}
              </label>
            ))}
          </div>

          <p style={{ marginBottom: 0 }}>Produtos envolvidos (opcional):</p>
          <div style={{ border: '1px solid #e2e8f0', padding: 8, display: 'grid', gap: 4, maxHeight: 120, overflowY: 'auto' }}>
            {products.map((p) => (
              <label key={p.id} style={{ display: 'flex', gap: 8 }}>
                <input type="checkbox" checked={productIds.includes(p.id)} onChange={() => toggle(productIds, setProductIds, p.id)} />
                {p.nome}
              </label>
            ))}
          </div>

          <button onClick={handleCreate} disabled={!nome.trim() || !pdvId || promotorIds.length === 0}>
            Criar evento
          </button>
        </div>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>
            <th>Nome</th>
            <th>PDV</th>
            <th>Data</th>
            <th>Resultados registrados</th>
            <th>Pessoas abordadas</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
              <td>
                <button
                  onClick={() => setSelectedId(e.id)}
                  style={{ background: 'none', border: 'none', color: '#0f172a', textDecoration: 'underline', cursor: 'pointer', padding: 0 }}
                >
                  {e.nome}
                </button>
              </td>
              <td>{e.pdv}</td>
              <td>{e.data}</td>
              <td>{e.total_resultados}</td>
              <td>{e.total_pessoas_abordadas}</td>
            </tr>
          ))}
          {events.length === 0 && (
            <tr>
              <td colSpan={5} style={{ padding: 16, textAlign: 'center', color: '#64748b' }}>
                Nenhum evento criado ainda.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

function EventDetailView({ token, eventId, onBack }: { token: string; eventId: string; onBack: () => void }) {
  const [event, setEvent] = useState<EventDetail | null>(null);

  useEffect(() => {
    getEvent(token, eventId).then(setEvent).catch(() => setEvent(null));
  }, [token, eventId]);

  if (!event) return <p>Carregando...</p>;

  return (
    <section>
      <button onClick={onBack} style={{ marginBottom: 16 }}>
        ← Voltar
      </button>
      <h2>{event.nome}</h2>
      <p>
        {event.pdv} — {event.data} {event.meta && `— Meta: ${event.meta}`}
      </p>

      <h3>Promotores</h3>
      <p>{event.promotores.map((p) => p.nome).join(', ') || 'Nenhum'}</p>

      <h3>Produtos</h3>
      <p>{event.produtos.map((p) => p.nome).join(', ') || 'Nenhum'}</p>

      <h3>Resultados</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>
            <th>Promotor</th>
            <th>Pessoas abordadas</th>
            <th>Degustações</th>
            <th>Quantidade distribuída</th>
            <th>Observações</th>
          </tr>
        </thead>
        <tbody>
          {event.resultados.map((r) => (
            <tr key={r.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
              <td>{r.promotor}</td>
              <td>{r.pessoas_abordadas ?? '—'}</td>
              <td>{r.degustacoes_realizadas ?? '—'}</td>
              <td>{r.quantidade_distribuida ?? '—'}</td>
              <td>{r.observacoes ?? '—'}</td>
            </tr>
          ))}
          {event.resultados.length === 0 && (
            <tr>
              <td colSpan={5} style={{ padding: 16, textAlign: 'center', color: '#64748b' }}>
                Nenhum resultado registrado ainda.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
