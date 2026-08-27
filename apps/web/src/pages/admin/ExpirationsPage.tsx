import { useEffect, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { listExpirations, getExpirationSettings, setExpirationSettings, type ExpirationRecord } from '../../api/admin';

const CLASS_LABEL: Record<ExpirationRecord['classificacao'], string> = {
  critico: '🔴 Crítico',
  atencao: '🟡 Atenção',
  regular: '🟢 Regular',
};

export default function ExpirationsPage() {
  const { token } = useAuth();
  const [records, setRecords] = useState<ExpirationRecord[]>([]);
  const [diasCritico, setDiasCritico] = useState('7');
  const [diasAtencao, setDiasAtencao] = useState('30');
  const [savingSettings, setSavingSettings] = useState(false);

  function reload() {
    if (!token) return;
    listExpirations(token).then(setRecords).catch(() => setRecords([]));
    getExpirationSettings(token).then((s) => {
      setDiasCritico(String(s.dias_critico));
      setDiasAtencao(String(s.dias_atencao));
    });
  }

  useEffect(reload, [token]);

  async function saveSettings() {
    if (!token) return;
    setSavingSettings(true);
    try {
      await setExpirationSettings(token, Number(diasCritico), Number(diasAtencao));
      reload();
    } finally {
      setSavingSettings(false);
    }
  }

  return (
    <section>
      <h2>Controle de validades</h2>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 24, fontSize: 14 }}>
        <span>Crítico até</span>
        <input type="number" style={{ width: 60 }} value={diasCritico} onChange={(e) => setDiasCritico(e.target.value)} />
        <span>dia(s) · Atenção até</span>
        <input type="number" style={{ width: 60 }} value={diasAtencao} onChange={(e) => setDiasAtencao(e.target.value)} />
        <span>dia(s)</span>
        <button onClick={saveSettings} disabled={savingSettings}>
          Salvar limiares
        </button>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>
            <th>Produto</th>
            <th>PDV</th>
            <th>Quantidade</th>
            <th>Validade</th>
            <th>Dias restantes</th>
            <th>Situação</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <tr key={r.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
              <td>{r.produto}</td>
              <td>{r.pdv}</td>
              <td>{r.quantidade}</td>
              <td>{r.data_validade}</td>
              <td>{r.dias_restantes}</td>
              <td>{CLASS_LABEL[r.classificacao]}</td>
            </tr>
          ))}
          {records.length === 0 && (
            <tr>
              <td colSpan={6} style={{ padding: 16, textAlign: 'center', color: '#64748b' }}>
                Nenhum registro de validade ainda.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
