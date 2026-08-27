import { useAuth } from '../../auth/AuthContext';
import { downloadAuthenticated } from '../../api/client';

const REPORTS = [
  { path: '/reports/visits.csv', filename: 'visitas.csv', label: 'Relatório de visitas' },
  { path: '/reports/pdvs.csv', filename: 'pdvs.csv', label: 'Relatório por PDV' },
  { path: '/reports/occurrences.csv', filename: 'ocorrencias.csv', label: 'Relatório de ocorrências' },
  { path: '/reports/price-collections.csv', filename: 'precos.csv', label: 'Relatório de preços coletados' },
];

export default function ReportsPage() {
  const { token } = useAuth();

  async function handleDownload(path: string, filename: string) {
    if (!token) return;
    await downloadAuthenticated(path, token, filename);
  }

  return (
    <section>
      <h2>Relatórios</h2>
      <p style={{ color: '#64748b' }}>Exportações em CSV, respeitando os dados da sua empresa.</p>
      <div style={{ display: 'grid', gap: 12, maxWidth: 360 }}>
        {REPORTS.map((r) => (
          <button key={r.path} onClick={() => handleDownload(r.path, r.filename)}>
            {r.label}
          </button>
        ))}
      </div>
    </section>
  );
}
