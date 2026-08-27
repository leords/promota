import { useEffect, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { listRoutes, createRoute, listUsers, listPdvs, type RouteSummary, type UserSummary, type Pdv } from '../../api/admin';

const todayISO = () => new Date().toISOString().slice(0, 10);

export default function RoutesPage() {
  const { token } = useAuth();
  const [routes, setRoutes] = useState<RouteSummary[]>([]);
  const [promotores, setPromotores] = useState<UserSummary[]>([]);
  const [pdvs, setPdvs] = useState<Pdv[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [nome, setNome] = useState('');
  const [data, setData] = useState(todayISO());
  const [promotorId, setPromotorId] = useState('');
  const [selectedPdvIds, setSelectedPdvIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  function reload() {
    if (!token) return;
    listRoutes(token).then(setRoutes).catch(() => setRoutes([]));
    listUsers(token, 'promotor').then(setPromotores).catch(() => setPromotores([]));
    listPdvs(token).then(setPdvs).catch(() => setPdvs([]));
  }

  useEffect(reload, [token]);

  function togglePdv(id: string) {
    setSelectedPdvIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  }

  async function handleSubmit() {
    if (!token || !nome.trim() || !promotorId || selectedPdvIds.length === 0) return;
    setSaving(true);
    try {
      await createRoute(token, { nome, data, promotorId, pdvIds: selectedPdvIds });
      setNome('');
      setSelectedPdvIds([]);
      setShowForm(false);
      reload();
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2>Rotas</h2>
        <button onClick={() => setShowForm((v) => !v)}>{showForm ? 'Cancelar' : 'Nova rota'}</button>
      </div>

      {showForm && (
        <div style={{ display: 'grid', gap: 8, marginBottom: 24, maxWidth: 420 }}>
          <input placeholder="Nome da rota" value={nome} onChange={(e) => setNome(e.target.value)} />
          <input type="date" value={data} onChange={(e) => setData(e.target.value)} />
          <select value={promotorId} onChange={(e) => setPromotorId(e.target.value)}>
            <option value="">Selecione o promotor</option>
            {promotores.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>

          <p style={{ marginBottom: 0 }}>PDVs da rota:</p>
          <div style={{ display: 'grid', gap: 4, maxHeight: 200, overflowY: 'auto', border: '1px solid #e2e8f0', padding: 8 }}>
            {pdvs.map((pdv) => (
              <label key={pdv.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="checkbox" checked={selectedPdvIds.includes(pdv.id)} onChange={() => togglePdv(pdv.id)} />
                {pdv.nome} — {pdv.cidade}
              </label>
            ))}
            {pdvs.length === 0 && <p style={{ color: '#64748b' }}>Cadastre PDVs antes de criar uma rota.</p>}
          </div>

          <button onClick={handleSubmit} disabled={saving || !nome.trim() || !promotorId || selectedPdvIds.length === 0}>
            {saving ? 'Salvando...' : 'Criar rota'}
          </button>
        </div>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>
            <th>Nome</th>
            <th>Data</th>
            <th>Promotor</th>
            <th>Progresso</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {routes.map((r) => (
            <tr key={r.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
              <td>{r.nome}</td>
              <td>{r.data}</td>
              <td>{r.promotor}</td>
              <td>
                {r.concluidos}/{r.total_pdvs}
              </td>
              <td>{r.status}</td>
            </tr>
          ))}
          {routes.length === 0 && (
            <tr>
              <td colSpan={5} style={{ padding: 16, textAlign: 'center', color: '#64748b' }}>
                Nenhuma rota criada ainda.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
