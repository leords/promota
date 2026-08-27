import { useEffect, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import {
  listSurveys,
  createSurvey,
  getSurvey,
  setSurveyStatus,
  addSurveyQuestion,
  deleteSurveyQuestion,
  listSurveyResponses,
  type SurveySummary,
  type SurveyDetail,
  type SurveyResponseRow,
  type QuestionType,
} from '../../api/admin';

const TIPO_LABEL: Record<QuestionType, string> = {
  texto: 'Texto',
  numero: 'Número',
  sim_nao: 'Sim ou não',
  multipla_escolha: 'Múltipla escolha',
  selecao_unica: 'Seleção única',
  nota: 'Nota (1-5)',
  foto: 'Foto',
};

export default function SurveysPage() {
  const { token } = useAuth();
  const [surveys, setSurveys] = useState<SurveySummary[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [nome, setNome] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  function reload() {
    if (token) listSurveys(token).then(setSurveys).catch(() => setSurveys([]));
  }

  useEffect(reload, [token]);

  async function handleCreate() {
    if (!token || !nome.trim()) return;
    await createSurvey(token, { nome });
    setNome('');
    setShowForm(false);
    reload();
  }

  async function toggleStatus(s: SurveySummary) {
    if (!token) return;
    const next = s.status === 'rascunho' ? 'ativa' : s.status === 'ativa' ? 'encerrada' : 'rascunho';
    await setSurveyStatus(token, s.id, next);
    reload();
  }

  if (selectedId && token) {
    return <SurveyDetailView token={token} surveyId={selectedId} onBack={() => { setSelectedId(null); reload(); }} />;
  }

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2>Pesquisas</h2>
        <button onClick={() => setShowForm((v) => !v)}>{showForm ? 'Cancelar' : 'Nova pesquisa'}</button>
      </div>

      {showForm && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
          <input placeholder="Nome da pesquisa" value={nome} onChange={(e) => setNome(e.target.value)} />
          <button onClick={handleCreate} disabled={!nome.trim()}>
            Criar
          </button>
        </div>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>
            <th>Nome</th>
            <th>Status</th>
            <th>Perguntas</th>
            <th>Respostas</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {surveys.map((s) => (
            <tr key={s.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
              <td>
                <button
                  onClick={() => setSelectedId(s.id)}
                  style={{ background: 'none', border: 'none', color: '#0f172a', textDecoration: 'underline', cursor: 'pointer', padding: 0 }}
                >
                  {s.nome}
                </button>
              </td>
              <td>{s.status}</td>
              <td>{s.total_perguntas}</td>
              <td>{s.total_respostas}</td>
              <td>
                <button onClick={() => toggleStatus(s)}>
                  {s.status === 'rascunho' ? 'Ativar' : s.status === 'ativa' ? 'Encerrar' : 'Reabrir como rascunho'}
                </button>
              </td>
            </tr>
          ))}
          {surveys.length === 0 && (
            <tr>
              <td colSpan={5} style={{ padding: 16, textAlign: 'center', color: '#64748b' }}>
                Nenhuma pesquisa criada ainda.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

function SurveyDetailView({ token, surveyId, onBack }: { token: string; surveyId: string; onBack: () => void }) {
  const [survey, setSurvey] = useState<SurveyDetail | null>(null);
  const [responses, setResponses] = useState<SurveyResponseRow[]>([]);
  const [showQuestionForm, setShowQuestionForm] = useState(false);
  const [qTipo, setQTipo] = useState<QuestionType>('texto');
  const [qTexto, setQTexto] = useState('');
  const [qOpcoes, setQOpcoes] = useState('');

  function reload() {
    getSurvey(token, surveyId).then(setSurvey).catch(() => setSurvey(null));
    listSurveyResponses(token, surveyId).then(setResponses).catch(() => setResponses([]));
  }

  useEffect(reload, [token, surveyId]);

  async function handleAddQuestion() {
    if (!qTexto.trim()) return;
    const opcoes = ['multipla_escolha', 'selecao_unica'].includes(qTipo)
      ? qOpcoes.split(',').map((o) => o.trim()).filter(Boolean)
      : undefined;
    await addSurveyQuestion(token, surveyId, { tipo: qTipo, texto: qTexto, opcoes });
    setQTexto('');
    setQOpcoes('');
    setShowQuestionForm(false);
    reload();
  }

  async function handleDeleteQuestion(id: string) {
    await deleteSurveyQuestion(token, id);
    reload();
  }

  // Agrupa respostas por response_id para exibir uma linha por sessão de resposta.
  const grouped = new Map<string, { pdv: string; promotor: string; criado_em: string; answers: Map<string, string> }>();
  for (const row of responses) {
    if (!grouped.has(row.response_id)) {
      grouped.set(row.response_id, { pdv: row.pdv, promotor: row.promotor, criado_em: row.criado_em, answers: new Map() });
    }
    grouped.get(row.response_id)!.answers.set(row.pergunta, row.valor);
  }

  return (
    <section>
      <button onClick={onBack} style={{ marginBottom: 16 }}>
        ← Voltar
      </button>
      <h2>{survey?.nome}</h2>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
        <h3>Perguntas</h3>
        <button onClick={() => setShowQuestionForm((v) => !v)}>{showQuestionForm ? 'Cancelar' : 'Nova pergunta'}</button>
      </div>

      {showQuestionForm && (
        <div style={{ display: 'grid', gap: 8, marginBottom: 16, maxWidth: 360 }}>
          <select value={qTipo} onChange={(e) => setQTipo(e.target.value as QuestionType)}>
            {Object.entries(TIPO_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <input placeholder="Texto da pergunta" value={qTexto} onChange={(e) => setQTexto(e.target.value)} />
          {['multipla_escolha', 'selecao_unica'].includes(qTipo) && (
            <input
              placeholder="Opções separadas por vírgula"
              value={qOpcoes}
              onChange={(e) => setQOpcoes(e.target.value)}
            />
          )}
          <button onClick={handleAddQuestion} disabled={!qTexto.trim()}>
            Adicionar
          </button>
        </div>
      )}

      <ul style={{ paddingLeft: 18 }}>
        {survey?.questions.map((q) => (
          <li key={q.id} style={{ marginBottom: 4 }}>
            [{TIPO_LABEL[q.tipo]}] {q.texto} {q.obrigatoria && '*'}{' '}
            <button onClick={() => handleDeleteQuestion(q.id)}>Remover</button>
          </li>
        ))}
        {survey?.questions.length === 0 && <p style={{ color: '#64748b' }}>Nenhuma pergunta ainda.</p>}
      </ul>

      <h3 style={{ marginTop: 24 }}>Respostas ({grouped.size})</h3>
      <div style={{ display: 'grid', gap: 12 }}>
        {Array.from(grouped.entries()).map(([responseId, r]) => (
          <div key={responseId} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 12 }}>
            <strong>
              {r.pdv} — {r.promotor}
            </strong>
            <p style={{ fontSize: 12, color: '#64748b' }}>{new Date(r.criado_em).toLocaleString('pt-BR')}</p>
            <ul style={{ paddingLeft: 18, margin: 0 }}>
              {Array.from(r.answers.entries()).map(([pergunta, valor]) => (
                <li key={pergunta}>
                  {pergunta}: {valor}
                </li>
              ))}
            </ul>
          </div>
        ))}
        {grouped.size === 0 && <p style={{ color: '#64748b' }}>Nenhuma resposta ainda.</p>}
      </div>
    </section>
  );
}
