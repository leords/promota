import { useEffect, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { listOccurrences, setOccurrenceStatus, type Occurrence } from '../../api/admin';

const TIPO_LABEL: Record<string, string> = {
  ruptura: 'Ruptura',
  falta_espaco: 'Falta de espaço',
  material_danificado: 'Material danificado',
  problema_operacional: 'Problema operacional',
  concorrente: 'Concorrente realizando ação',
  problema_atendimento: 'Problema com atendimento',
  outro: 'Outro',
};

const STATUS_LABEL: Record<Occurrence['status'], string> = {
  aberta: 'Aberta',
  em_acompanhamento: 'Em acompanhamento',
  resolvida: 'Resolvida',
};

const PRIORIDADE_COLOR: Record<Occurrence['prioridade'], string> = {
  alta: '#b91c1c',
  media: '#92400e',
  baixa: '#475569',
};

export default function OccurrencesPage() {
  const { token } = useAuth();
  const [occurrences, setOccurrences] = useState<Occurrence[]>([]);
  const [filter, setFilter] = useState<string>('');

  function reload() {
    if (token) listOccurrences(token, filter || undefined).then(setOccurrences).catch(() => setOccurrences([]));
  }

  useEffect(reload, [token, filter]);

  async function updateStatus(o: Occurrence, status: Occurrence['status']) {
    if (!token) return;
    await setOccurrenceStatus(token, o.id, status);
    reload();
  }

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2>Central de ocorrências</h2>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">Todas</option>
          <option value="aberta">Abertas</option>
          <option value="em_acompanhamento">Em acompanhamento</option>
          <option value="resolvida">Resolvidas</option>
        </select>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>
            <th>Tipo</th>
            <th>Descrição</th>
            <th>PDV</th>
            <th>Promotor</th>
            <th>Prioridade</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {occurrences.map((o) => (
            <tr key={o.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
              <td>{TIPO_LABEL[o.tipo] ?? o.tipo}</td>
              <td style={{ maxWidth: 240 }}>{o.descricao}</td>
              <td>{o.pdv}</td>
              <td>{o.promotor}</td>
              <td style={{ color: PRIORIDADE_COLOR[o.prioridade], fontWeight: 600 }}>{o.prioridade}</td>
              <td>{STATUS_LABEL[o.status]}</td>
              <td>
                {o.status !== 'em_acompanhamento' && o.status !== 'resolvida' && (
                  <button onClick={() => updateStatus(o, 'em_acompanhamento')}>Acompanhar</button>
                )}
                {o.status !== 'resolvida' && <button onClick={() => updateStatus(o, 'resolvida')}>Resolver</button>}
                {o.status === 'resolvida' && <button onClick={() => updateStatus(o, 'aberta')}>Reabrir</button>}
              </td>
            </tr>
          ))}
          {occurrences.length === 0 && (
            <tr>
              <td colSpan={7} style={{ padding: 16, textAlign: 'center', color: '#64748b' }}>
                Nenhuma ocorrência encontrada.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
