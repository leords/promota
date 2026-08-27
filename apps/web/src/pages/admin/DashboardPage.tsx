import { useEffect, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { getDashboardToday, type DashboardToday } from '../../api/admin';

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—';
  return `${Math.round(seconds / 60)} min`;
}

function formatSemVisita(iso: string | null): string {
  if (!iso) return 'nunca visitado';
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return `${dias} dia(s) sem visita`;
}

export default function DashboardPage() {
  const { token } = useAuth();
  const [data, setData] = useState<DashboardToday | null>(null);

  useEffect(() => {
    if (token) getDashboardToday(token).then(setData).catch(() => setData(null));
  }, [token]);

  if (!data) return <p>Carregando...</p>;

  const op = data.operacional;
  const taxaExecucao = Number(op.pdvs_planejados) > 0 ? Math.round((Number(op.pdvs_atendidos) / Number(op.pdvs_planejados)) * 100) : 0;

  const atencao: string[] = [];
  if (data.produtosCriticos > 0) atencao.push(`${data.produtosCriticos} produto(s) próximos do vencimento precisam de atenção.`);
  if (data.ocorrenciasAbertas > 0) atencao.push(`${data.ocorrenciasAbertas} ocorrência(s) aberta(s) precisam de atenção.`);
  if (Number(op.rotas_pendentes) > 0) atencao.push(`${op.rotas_pendentes} rota(s) de hoje ainda não foram concluídas.`);
  if (data.promotoresSemAtividade.length > 0) {
    atencao.push(`${data.promotoresSemAtividade.length} promotor(es) programado(s) ainda não iniciaram atividades hoje: ${data.promotoresSemAtividade.map((p) => p.nome).join(', ')}.`);
  }
  if (data.pdvsSemCobertura.length > 0) {
    atencao.push(`${data.pdvsSemCobertura.length} PDV(s) estão há mais tempo sem visita do que o esperado.`);
  }

  return (
    <section style={{ display: 'grid', gap: 24 }}>
      <div>
        <h2>O que merece atenção hoje?</h2>
        {atencao.length === 0 && <p style={{ color: '#64748b' }}>Nada precisando de atenção imediata.</p>}
        <ul style={{ display: 'grid', gap: 8, paddingLeft: 18 }}>
          {atencao.map((a, i) => (
            <li key={i} style={{ color: '#92400e' }}>
              {a}
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h2>Visão operacional de hoje</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
          <Stat label="Promotores programados" value={op.promotores_programados} />
          <Stat label="Promotores que trabalharam" value={op.promotores_que_trabalharam} />
          <Stat label="PDVs planejados" value={op.pdvs_planejados} />
          <Stat label="PDVs atendidos" value={op.pdvs_atendidos} />
          <Stat label="PDVs pendentes" value={op.pdvs_pendentes} />
          <Stat label="PDVs não atendidos" value={op.pdvs_nao_atendidos} />
          <Stat label="Taxa de execução" value={`${taxaExecucao}%`} />
          <Stat label="Tempo médio de atendimento" value={formatDuration(data.tempoMedioSegundos)} />
        </div>
      </div>

      {data.pdvsSemCobertura.length > 0 && (
        <div>
          <h2>PDVs sem cobertura</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>
                <th>PDV</th>
                <th>Frequência esperada</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {data.pdvsSemCobertura.map((p) => (
                <tr key={p.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td>{p.nome}</td>
                  <td>a cada {p.frequencia_esperada_dias} dia(s)</td>
                  <td style={{ color: '#b91c1c' }}>{formatSemVisita(p.ultima_visita)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 12 }}>
      <div style={{ fontSize: 24, fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: 13, color: '#64748b' }}>{label}</div>
    </div>
  );
}
