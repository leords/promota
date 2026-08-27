import { useEffect, useState } from 'react';
import { fetchSurveyForm, submitSurveyResponse, type SurveyQuestionForm } from '../api/operacao';
import { enqueue } from '../offline/syncQueue';

interface Props {
  token: string;
  surveyId: string;
  pdvId: string;
  visitId?: string;
  onDone: (message: string) => void;
  onCancel: () => void;
}

function QuestionInput({
  question,
  value,
  onChange,
}: {
  question: SurveyQuestionForm;
  value: string;
  onChange: (v: string) => void;
}) {
  switch (question.tipo) {
    case 'texto':
      return <textarea rows={2} value={value} onChange={(e) => onChange(e.target.value)} />;
    case 'numero':
      return <input type="number" value={value} onChange={(e) => onChange(e.target.value)} />;
    case 'nota':
      return (
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Selecione</option>
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      );
    case 'sim_nao':
      return (
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Selecione</option>
          <option value="sim">Sim</option>
          <option value="nao">Não</option>
        </select>
      );
    case 'selecao_unica':
      return (
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Selecione</option>
          {(question.opcoes ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    case 'multipla_escolha': {
      const selected: string[] = value ? JSON.parse(value) : [];
      function toggle(opt: string) {
        const next = selected.includes(opt) ? selected.filter((o) => o !== opt) : [...selected, opt];
        onChange(JSON.stringify(next));
      }
      return (
        <div style={{ display: 'grid', gap: 4 }}>
          {(question.opcoes ?? []).map((opt) => (
            <label key={opt} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={selected.includes(opt)} onChange={() => toggle(opt)} />
              {opt}
            </label>
          ))}
        </div>
      );
    }
    case 'foto':
      // Fotos em respostas de pesquisa ficam para quando houver um caso de uso
      // pedindo (ver docs/DECISIONS.md) — por ora a pergunta aparece mas não bloqueia
      // o restante do formulário mesmo que marcada obrigatória.
      return <p style={{ color: '#64748b', fontSize: 13 }}>Envio de foto em pesquisas ainda não suportado.</p>;
    default:
      return null;
  }
}

export default function SurveyAnswerModal({ token, surveyId, pdvId, visitId, onDone, onCancel }: Props) {
  const [survey, setSurvey] = useState<{ nome: string; questions: SurveyQuestionForm[] } | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchSurveyForm(token, surveyId).then(setSurvey).catch(() => setSurvey(null));
  }, [token, surveyId]);

  const pendingRequired = survey?.questions.filter((q) => q.obrigatoria && q.tipo !== 'foto' && !answers[q.id]?.trim()) ?? [];

  async function handleSubmit() {
    if (!survey || pendingRequired.length > 0) return;
    setSaving(true);
    const body = {
      clientId: crypto.randomUUID(),
      surveyId,
      pdvId,
      visitId,
      answers: survey.questions.filter((q) => answers[q.id]?.trim()).map((q) => ({ questionId: q.id, valor: answers[q.id] })),
    };
    try {
      await submitSurveyResponse(token, body);
      onDone('Pesquisa respondida.');
    } catch {
      await enqueue('survey_response', body);
      onDone('Sem conexão — respostas salvas localmente.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'grid', placeItems: 'center', zIndex: 10 }}>
      <div style={{ background: 'white', color: '#0f172a', padding: 16, borderRadius: 8, display: 'grid', gap: 12, width: 320, maxHeight: '85vh', overflowY: 'auto' }}>
        <h3 style={{ margin: 0 }}>{survey?.nome ?? 'Carregando...'}</h3>
        {survey?.questions.map((q) => (
          <div key={q.id} style={{ display: 'grid', gap: 4 }}>
            <label>
              {q.texto} {q.obrigatoria && '*'}
            </label>
            <QuestionInput question={q} value={answers[q.id] ?? ''} onChange={(v) => setAnswers({ ...answers, [q.id]: v })} />
          </div>
        ))}
        <button onClick={handleSubmit} disabled={saving || !survey || pendingRequired.length > 0}>
          {saving ? 'Enviando...' : 'Enviar respostas'}
        </button>
        <button onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  );
}
