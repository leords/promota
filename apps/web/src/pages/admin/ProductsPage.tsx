import { useEffect, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { listProducts, createProduct, updateProduct, type Product } from '../../api/admin';

const emptyForm = { nome: '', marca: '', categoria: '' };

export default function ProductsPage() {
  const { token } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState(emptyForm);

  function reload() {
    if (token) listProducts(token).then(setProducts).catch(() => setProducts([]));
  }

  useEffect(reload, [token]);

  async function handleSubmit() {
    if (!token || !form.nome.trim()) return;
    setSaving(true);
    try {
      await createProduct(token, form);
      setForm(emptyForm);
      setShowForm(false);
      reload();
    } finally {
      setSaving(false);
    }
  }

  function startEdit(p: Product) {
    setEditingId(p.id);
    setEditForm({ nome: p.nome, marca: p.marca ?? '', categoria: p.categoria ?? '' });
  }

  async function saveEdit() {
    if (!token || !editingId) return;
    setSaving(true);
    try {
      await updateProduct(token, editingId, editForm);
      setEditingId(null);
      reload();
    } finally {
      setSaving(false);
    }
  }

  async function toggleAtivo(p: Product) {
    if (!token) return;
    await updateProduct(token, p.id, { ativo: !p.ativo });
    reload();
  }

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2>Produtos</h2>
        <button onClick={() => setShowForm((v) => !v)}>{showForm ? 'Cancelar' : 'Novo produto'}</button>
      </div>

      {showForm && (
        <div style={{ display: 'grid', gap: 8, marginBottom: 24, maxWidth: 360 }}>
          <input placeholder="Nome" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
          <input placeholder="Marca" value={form.marca} onChange={(e) => setForm({ ...form, marca: e.target.value })} />
          <input placeholder="Categoria" value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })} />
          <button onClick={handleSubmit} disabled={saving || !form.nome.trim()}>
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>
            <th>Nome</th>
            <th>Marca</th>
            <th>Categoria</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {products.map((p) =>
            editingId === p.id ? (
              <tr key={p.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td>
                  <input value={editForm.nome} onChange={(e) => setEditForm({ ...editForm, nome: e.target.value })} />
                </td>
                <td>
                  <input value={editForm.marca} onChange={(e) => setEditForm({ ...editForm, marca: e.target.value })} />
                </td>
                <td>
                  <input value={editForm.categoria} onChange={(e) => setEditForm({ ...editForm, categoria: e.target.value })} />
                </td>
                <td>{p.ativo ? 'Ativo' : 'Inativo'}</td>
                <td style={{ display: 'flex', gap: 4 }}>
                  <button onClick={saveEdit} disabled={saving}>
                    Salvar
                  </button>
                  <button onClick={() => setEditingId(null)}>Cancelar</button>
                </td>
              </tr>
            ) : (
              <tr key={p.id} style={{ borderBottom: '1px solid #f1f5f9', opacity: p.ativo ? 1 : 0.5 }}>
                <td>{p.nome}</td>
                <td>{p.marca}</td>
                <td>{p.categoria}</td>
                <td>{p.ativo ? 'Ativo' : 'Inativo'}</td>
                <td style={{ display: 'flex', gap: 4 }}>
                  <button onClick={() => startEdit(p)}>Editar</button>
                  <button onClick={() => toggleAtivo(p)}>{p.ativo ? 'Inativar' : 'Reativar'}</button>
                </td>
              </tr>
            ),
          )}
          {products.length === 0 && (
            <tr>
              <td colSpan={5} style={{ padding: 16, textAlign: 'center', color: '#64748b' }}>
                Nenhum produto cadastrado ainda.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
