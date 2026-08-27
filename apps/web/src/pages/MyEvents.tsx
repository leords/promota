import { useEffect, useState } from 'react';
import { fetchMyEvents, submitEventResult, type MyEvent } from '../api/operacao';

// Eventos não são tratados como uma rota convencional (Seção 12) — ficam numa seção
// separada da rota do dia, com registro de resultado próprio.
export default function MyEvents({ token }: { token: string }) {
  const [events, setEvents] = useState<MyEvent[]>([]);
  const [resultForm, setResultForm] = useState<{ eventId: string; pessoasAbordadas: string; degustacoesRealizadas: string; quantidadeDistribuida: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function reload() {
    fetchMyEvents(token).then(setEvents).catch(() => setEvents([]));
  }

  useEffect(reload, [token]);

  async function handleSubmit() {
    if (!resultForm) return;
    const body = {
      clientId: crypto.randomUUID(),
      pessoasAbordadas: resultForm.pessoasAbordadas ? Number(resultForm.pessoasAbordadas) : undefined,
      degustacoesRealizadas: resultForm.degustacoesRealizadas ? Number(resultForm.degustacoesRealizadas) : undefined,
      quantidadeDistribuida: resultForm.quantidadeDistribuida ? Number(resultForm.quantidadeDistribuida) : undefined,
    };
    try {
      await submitEventResult(token, resultForm.eventId, body);
      setMessage('Resultado registrado.');
    } catch {
      setMessage('Sem conexão — não foi possível registrar agora. Tente novamente ao reconectar.');
    }
    setResultForm(null);
    reload();
  }

  if (events.length === 0) return null;

  return (
    <div style={{ marginTop: 24 }}>
      <h2>Meus eventos</h2>
      {message && <p style={{ background: '#eef', padding: 8, borderRadius: 6 }}>{message}</p>}
      <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 12 }}>
        {events.map((e) => (
          <li key={e.id} style={{ border: '1px solid #ccc', borderRadius: 8, padding: 12 }}>
            <strong>{e.nome}</strong>
            <p>
              {e.pdv} — {e.data} {e.meta && `— ${e.meta}`}
            </p>
            {e.ja_registrou ? (
              <p style={{ color: '#16a34a', fontSize: 14 }}>Resultado já registrado.</p>
            ) : (
              <button
                onClick={() =>
                  setResultForm({ eventId: e.id, pessoasAbordadas: '', degustacoesRealizadas: '', quantidadeDistribuida: '' })
                }
              >
                Registrar resultado
              </button>
            )}
          </li>
        ))}
      </ul>

      {resultForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'grid', placeItems: 'center' }}>
          <div style={{ background: 'white', padding: 16, borderRadius: 8, display: 'grid', gap: 8, width: 300 }}>
            <h3>Resultado do evento</h3>
            <input
              placeholder="Pessoas abordadas"
              type="number"
              value={resultForm.pessoasAbordadas}
              onChange={(e) => setResultForm({ ...resultForm, pessoasAbordadas: e.target.value })}
            />
            <input
              placeholder="Degustações realizadas"
              type="number"
              value={resultForm.degustacoesRealizadas}
              onChange={(e) => setResultForm({ ...resultForm, degustacoesRealizadas: e.target.value })}
            />
            <input
              placeholder="Quantidade distribuída"
              type="number"
              value={resultForm.quantidadeDistribuida}
              onChange={(e) => setResultForm({ ...resultForm, quantidadeDistribuida: e.target.value })}
            />
            <button onClick={handleSubmit}>Salvar</button>
            <button onClick={() => setResultForm(null)}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}
