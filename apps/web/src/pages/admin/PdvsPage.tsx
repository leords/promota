import { useEffect, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { listPdvs, listUsers, createPdv, updatePdv, setPdvStatus, type Pdv, type UserSummary } from '../../api/admin';
import PdvDetail from './PdvDetail';

const emptyForm = {
  nome: '',
  cidade: '',
  bairro: '',
  rede: '',
  tipoEstabelecimento: '',
  frequenciaEsperadaDias: '',
  promotorResponsavelId: '',
  latitude: '',
  longitude: '',
  email: '',
  notificarEmail: false,
};

function toBody(form: typeof emptyForm) {
  return {
    ...form,
    frequenciaEsperadaDias: form.frequenciaEsperadaDias ? Number(form.frequenciaEsperadaDias) : undefined,
    promotorResponsavelId: form.promotorResponsavelId || undefined,
    latitude: form.latitude ? Number(form.latitude) : undefined,
    longitude: form.longitude ? Number(form.longitude) : undefined,
    email: form.email.trim() || undefined,
  };
}

export default function PdvsPage() {
  const { token } = useAuth();
  const [pdvs, setPdvs] = useState<Pdv[]>([]);
  const [promotores, setPromotores] = useState<UserSummary[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState(emptyForm);
  const [detailId, setDetailId] = useState<string | null>(null);

  function reload() {
    if (!token) return;
    listPdvs(token).then(setPdvs).catch(() => setPdvs([]));
    listUsers(token, 'promotor').then(setPromotores).catch(() => setPromotores([]));
  }

  useEffect(reload, [token]);

  async function handleSubmit() {
    if (!token || !form.nome.trim()) return;
    setSaving(true);
    try {
      await createPdv(token, toBody(form));
      setForm(emptyForm);
      setShowForm(false);
      reload();
    } finally {
      setSaving(false);
    }
  }

  function startEdit(pdv: Pdv) {
    setEditingId(pdv.id);
    setEditForm({
      ...emptyForm,
      nome: pdv.nome,
      cidade: pdv.cidade ?? '',
      bairro: pdv.bairro ?? '',
      rede: pdv.rede ?? '',
      tipoEstabelecimento: pdv.tipo_estabelecimento ?? '',
      promotorResponsavelId: pdv.promotor_responsavel_id ?? '',
      latitude: pdv.latitude !== null ? String(pdv.latitude) : '',
      longitude: pdv.longitude !== null ? String(pdv.longitude) : '',
      email: pdv.email ?? '',
      notificarEmail: pdv.notificar_email,
    });
  }

  async function saveEdit() {
    if (!token || !editingId) return;
    setSaving(true);
    try {
      await updatePdv(token, editingId, toBody(editForm));
      setEditingId(null);
      reload();
    } finally {
      setSaving(false);
    }
  }

  async function toggleAtivo(pdv: Pdv) {
    if (!token) return;
    await setPdvStatus(token, pdv.id, !pdv.ativo);
    reload();
  }

  function promotorNome(id: string | null) {
    return promotores.find((p) => p.id === id)?.nome ?? '—';
  }

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2>Pontos de venda</h2>
        <button onClick={() => setShowForm((v) => !v)}>{showForm ? 'Cancelar' : 'Novo PDV'}</button>
      </div>

      {showForm && (
        <div style={{ display: 'grid', gap: 8, marginBottom: 24, maxWidth: 360 }}>
          <input placeholder="Nome" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
          <input placeholder="Cidade" value={form.cidade} onChange={(e) => setForm({ ...form, cidade: e.target.value })} />
          <input placeholder="Bairro" value={form.bairro} onChange={(e) => setForm({ ...form, bairro: e.target.value })} />
          <input placeholder="Rede" value={form.rede} onChange={(e) => setForm({ ...form, rede: e.target.value })} />
          <input
            placeholder="Tipo de estabelecimento"
            value={form.tipoEstabelecimento}
            onChange={(e) => setForm({ ...form, tipoEstabelecimento: e.target.value })}
          />
          <select value={form.promotorResponsavelId} onChange={(e) => setForm({ ...form, promotorResponsavelId: e.target.value })}>
            <option value="">Sem promotor responsável</option>
            {promotores.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
          <div style={{ display: 'flex', gap: 8 }}>
            <input placeholder="Latitude" type="number" value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} />
            <input placeholder="Longitude" type="number" value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} />
          </div>
          <input
            placeholder="Frequência esperada de visita (dias, opcional)"
            type="number"
            value={form.frequenciaEsperadaDias}
            onChange={(e) => setForm({ ...form, frequenciaEsperadaDias: e.target.value })}
          />
          <input
            placeholder="E-mail do PDV (opcional)"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
            <input
              type="checkbox"
              checked={form.notificarEmail}
              onChange={(e) => setForm({ ...form, notificarEmail: e.target.checked })}
            />
            Notificar este e-mail sobre produtos próximos do vencimento
          </label>
          <button onClick={handleSubmit} disabled={saving || !form.nome.trim()}>
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>
            <th>Nome</th>
            <th>Cidade</th>
            <th>Bairro</th>
            <th>Rede</th>
            <th>Promotor</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {pdvs.map((pdv) =>
            editingId === pdv.id ? (
              <tr key={pdv.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td>
                  <input value={editForm.nome} onChange={(e) => setEditForm({ ...editForm, nome: e.target.value })} />
                </td>
                <td>
                  <input value={editForm.cidade} onChange={(e) => setEditForm({ ...editForm, cidade: e.target.value })} />
                </td>
                <td>
                  <input value={editForm.bairro} onChange={(e) => setEditForm({ ...editForm, bairro: e.target.value })} />
                </td>
                <td>
                  <input value={editForm.rede} onChange={(e) => setEditForm({ ...editForm, rede: e.target.value })} />
                </td>
                <td>
                  <select
                    value={editForm.promotorResponsavelId}
                    onChange={(e) => setEditForm({ ...editForm, promotorResponsavelId: e.target.value })}
                  >
                    <option value="">Sem promotor</option>
                    {promotores.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nome}
                      </option>
                    ))}
                  </select>
                </td>
                <td>{pdv.ativo ? 'Ativo' : 'Inativo'}</td>
                <td style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center', maxWidth: 260 }}>
                  <input
                    placeholder="Latitude"
                    type="number"
                    style={{ width: 80 }}
                    value={editForm.latitude}
                    onChange={(e) => setEditForm({ ...editForm, latitude: e.target.value })}
                  />
                  <input
                    placeholder="Longitude"
                    type="number"
                    style={{ width: 80 }}
                    value={editForm.longitude}
                    onChange={(e) => setEditForm({ ...editForm, longitude: e.target.value })}
                  />
                  <input
                    placeholder="Freq. (dias)"
                    type="number"
                    style={{ width: 90 }}
                    value={editForm.frequenciaEsperadaDias}
                    onChange={(e) => setEditForm({ ...editForm, frequenciaEsperadaDias: e.target.value })}
                  />
                  <input
                    placeholder="E-mail do PDV"
                    type="email"
                    style={{ width: 160 }}
                    value={editForm.email}
                    onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                  />
                  <label style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={editForm.notificarEmail}
                      onChange={(e) => setEditForm({ ...editForm, notificarEmail: e.target.checked })}
                    />
                    Notificar
                  </label>
                  <button onClick={saveEdit} disabled={saving}>
                    Salvar
                  </button>
                  <button onClick={() => setEditingId(null)}>Cancelar</button>
                </td>
              </tr>
            ) : (
              <tr key={pdv.id} style={{ borderBottom: '1px solid #f1f5f9', opacity: pdv.ativo ? 1 : 0.5 }}>
                <td>
                  <button
                    onClick={() => setDetailId(pdv.id)}
                    style={{ background: 'none', border: 'none', color: '#0f172a', textDecoration: 'underline', cursor: 'pointer', padding: 0 }}
                  >
                    {pdv.nome}
                  </button>
                </td>
                <td>{pdv.cidade}</td>
                <td>{pdv.bairro}</td>
                <td>{pdv.rede}</td>
                <td>{promotorNome(pdv.promotor_responsavel_id)}</td>
                <td>{pdv.ativo ? 'Ativo' : 'Inativo'}</td>
                <td style={{ display: 'flex', gap: 4 }}>
                  <button onClick={() => startEdit(pdv)}>Editar</button>
                  <button onClick={() => toggleAtivo(pdv)}>{pdv.ativo ? 'Inativar' : 'Reativar'}</button>
                </td>
              </tr>
            ),
          )}
          {pdvs.length === 0 && (
            <tr>
              <td colSpan={7} style={{ padding: 16, textAlign: 'center', color: '#64748b' }}>
                Nenhum PDV cadastrado ainda.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {detailId && <PdvDetail pdvId={detailId} onClose={() => setDetailId(null)} />}
    </section>
  );
}
