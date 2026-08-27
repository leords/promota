import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useSync } from '../offline/useSync';
import { enqueue } from '../offline/syncQueue';
import {
  fetchTodayRoute,
  fetchProducts,
  checkin,
  checkout,
  collectPrice,
  uploadPhoto,
  createOccurrence,
  createExpirationRecord,
  fetchActiveSurveys,
  markRoutePdvStatus,
  getCurrentPosition,
  PHOTO_CATEGORIES,
  OCCURRENCE_TYPES,
  type TodayRoute,
  type Product,
  type PhotoCategory,
  type OccurrenceType,
  type ActiveSurvey,
} from '../api/operacao';
import { ApiError } from '../api/client';
import { CACHED_ROUTE_KEY } from '../offline/localKeys';
import { loadActiveVisits, saveActiveVisit } from '../offline/activeVisits';
import SurveyAnswerModal from './SurveyAnswerModal';
import MyEvents from './MyEvents';

const STATUS_LABEL: Record<string, string> = {
  pendente: 'Pendente',
  em_atendimento: 'Em atendimento',
  concluido: 'Concluído',
  nao_atendido: 'Não atendido',
};

const CATEGORIA_LABEL: Record<PhotoCategory, string> = {
  antes: 'Antes',
  depois: 'Depois',
  gondola: 'Gôndola',
  ponto_extra: 'Ponto extra',
  merchandising: 'Merchandising',
  ruptura: 'Ruptura',
  livre: 'Livre',
};

const OCORRENCIA_LABEL: Record<OccurrenceType, string> = {
  ruptura: 'Ruptura',
  falta_espaco: 'Falta de espaço',
  material_danificado: 'Material danificado',
  problema_operacional: 'Problema operacional',
  concorrente: 'Concorrente realizando ação',
  problema_atendimento: 'Problema com atendimento',
  outro: 'Outro',
};

// Cache da última rota carregada com sucesso (chave em offline/localKeys.ts, limpa
// no logout) — é o que permite abrir o app já offline (não só continuar depois de
// perder a conexão em sessão) e ainda ver a rota do dia, conforme
// docs/ARCHITECTURE.md ("visualização da rota previamente sincronizada" é
// prioridade explícita do Offline First).
function loadCachedRoute(): TodayRoute | null {
  try {
    const raw = localStorage.getItem(CACHED_ROUTE_KEY);
    return raw ? (JSON.parse(raw) as TodayRoute) : null;
  } catch {
    return null;
  }
}

export default function RouteToday() {
  const { token, logout } = useAuth();
  const { online, pending, failed, retry } = useSync(token);
  const [route, setRoute] = useState<TodayRoute | null>(loadCachedRoute);
  const [products, setProducts] = useState<Product[]>([]);
  const [priceForm, setPriceForm] = useState<{ routePdvId: string; productId: string; preco: string } | null>(null);
  const [photoForm, setPhotoForm] = useState<{ routePdvId: string; categoria: PhotoCategory } | null>(null);
  const [occurrenceForm, setOccurrenceForm] = useState<{ routePdvId: string; pdvId: string; tipo: OccurrenceType; descricao: string } | null>(null);
  const [notAttendedForm, setNotAttendedForm] = useState<{ routePdvId: string; motivo: string } | null>(null);
  const [expirationForm, setExpirationForm] = useState<{ routePdvId: string; pdvId: string; productId: string; quantidade: string; dataValidade: string } | null>(null);
  const [surveyPicker, setSurveyPicker] = useState<{ routePdvId: string; pdvId: string; surveys: ActiveSurvey[] } | null>(null);
  const [answeringSurvey, setAnsweringSurvey] = useState<{ surveyId: string; pdvId: string; visitId?: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [stale, setStale] = useState(false);

  function reload() {
    if (!token) return;
    fetchTodayRoute(token)
      .then((data) => {
        setRoute(data);
        setStale(false);
        localStorage.setItem(CACHED_ROUTE_KEY, JSON.stringify(data));
      })
      .catch((err) => {
        // 404 = confirmado pelo servidor que não há rota hoje. Qualquer outro erro
        // (offline, servidor fora do ar) NÃO deve apagar a rota já carregada/cacheada
        // — é exatamente o cenário que o Offline First existe para cobrir (ver
        // docs/RISKS.md). Encontrado num teste real de rede cortada: sem essa
        // checagem, o promotor perdia a tela da rota ao ficar offline mesmo já tendo
        // os dados localmente.
        if (err instanceof ApiError && err.status === 404) {
          setRoute(null);
          localStorage.removeItem(CACHED_ROUTE_KEY);
        } else {
          setStale(true);
        }
      });
  }

  useEffect(() => {
    if (!token) return;
    reload();
    fetchProducts(token).then(setProducts).catch(() => setProducts([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function handleCheckin(routePdvId: string) {
    if (!token) return;
    const clientId = crypto.randomUUID();
    const position = await getCurrentPosition();
    const body = {
      clientId,
      routePdvId,
      latitude: position?.coords.latitude,
      longitude: position?.coords.longitude,
      precisaoM: position?.coords.accuracy,
    };
    try {
      const result = await checkin(token, body);
      saveActiveVisit(routePdvId, { visitId: result.id, clientId });
      setMessage('Check-in registrado.');
    } catch {
      await enqueue('checkin', body);
      // Sem rede, ainda não temos o visitId real (só o servidor gera) — usamos o
      // clientId como referência local até sincronizar; check-out/preço offline
      // ficam bloqueados para este PDV até a próxima sincronização.
      saveActiveVisit(routePdvId, { visitId: '', clientId });
      setMessage('Sem conexão — check-in salvo localmente, será enviado ao reconectar.');
    }
    reload();
  }

  async function handleCheckout(routePdvId: string) {
    if (!token) return;
    const active = loadActiveVisits()[routePdvId];
    if (!active?.visitId) {
      setMessage('Aguardando sincronizar o check-in antes de finalizar.');
      return;
    }
    const position = await getCurrentPosition();
    const body = { visitId: active.visitId, latitude: position?.coords.latitude, longitude: position?.coords.longitude };
    try {
      await checkout(token, body);
      setMessage('Check-out registrado.');
    } catch {
      await enqueue('checkout', body);
      setMessage('Sem conexão — check-out salvo localmente.');
    }
    reload();
  }

  async function handlePriceSubmit() {
    if (!token || !priceForm) return;
    const active = loadActiveVisits()[priceForm.routePdvId];
    if (!active?.visitId) {
      setMessage('Aguardando sincronizar o check-in antes de coletar preço.');
      return;
    }
    const body = {
      clientId: crypto.randomUUID(),
      visitId: active.visitId,
      productId: priceForm.productId,
      preco: Number(priceForm.preco),
    };
    try {
      await collectPrice(token, body);
      setMessage('Preço registrado.');
    } catch {
      await enqueue('price_collection', body);
      setMessage('Sem conexão — preço salvo localmente.');
    }
    setPriceForm(null);
  }

  async function handlePhotoSubmit(file: File) {
    if (!token || !photoForm) return;
    const active = loadActiveVisits()[photoForm.routePdvId];
    if (!active?.visitId) {
      setMessage('Aguardando sincronizar o check-in antes de enviar foto.');
      return;
    }
    const clientId = crypto.randomUUID();
    const visitId = active.visitId;
    const categoria = photoForm.categoria;
    try {
      await uploadPhoto(token, { clientId, visitId, categoria, file });
      setMessage('Foto enviada.');
    } catch {
      // Fica em fila com o Blob mesmo sem rede — enviado assim que reconectar (ver
      // offline/syncManager.ts). Fotos nunca bloqueiam o resto da fila.
      await enqueue('photo', { clientId, visitId, categoria, blob: file });
      setMessage('Sem conexão — foto salva localmente, será enviada ao reconectar.');
    }
    setPhotoForm(null);
  }

  async function handleOccurrenceSubmit() {
    if (!token || !occurrenceForm || !occurrenceForm.descricao.trim()) return;
    const active = loadActiveVisits()[occurrenceForm.routePdvId];
    const body = {
      clientId: crypto.randomUUID(),
      pdvId: occurrenceForm.pdvId,
      visitId: active?.visitId || undefined,
      tipo: occurrenceForm.tipo,
      descricao: occurrenceForm.descricao,
    };
    try {
      await createOccurrence(token, body);
      setMessage('Ocorrência registrada.');
    } catch {
      await enqueue('occurrence', body);
      setMessage('Sem conexão — ocorrência salva localmente.');
    }
    setOccurrenceForm(null);
  }

  async function handleNotAttendedSubmit() {
    if (!token || !notAttendedForm || !notAttendedForm.motivo.trim()) return;
    try {
      await markRoutePdvStatus(token, notAttendedForm.routePdvId, {
        status: 'nao_atendido',
        motivoNaoAtendido: notAttendedForm.motivo,
      });
      setMessage('PDV marcado como não atendido.');
    } catch {
      // Não entra na fila offline por enquanto — é uma ação rara e feita antes do
      // check-in (ainda sem visitId para amarrar), diferente de check-in/preço/foto
      // que já têm o padrão de fila pronto. Registrar e avisar o promotor a tentar
      // de novo com conexão é aceitável para o MVP.
      setMessage('Sem conexão — não foi possível marcar agora. Tente novamente ao reconectar.');
    }
    setNotAttendedForm(null);
    reload();
  }

  async function handleExpirationSubmit() {
    if (!token || !expirationForm || !expirationForm.productId || !expirationForm.quantidade || !expirationForm.dataValidade) return;
    const body = {
      clientId: crypto.randomUUID(),
      pdvId: expirationForm.pdvId,
      productId: expirationForm.productId,
      quantidade: Number(expirationForm.quantidade),
      dataValidade: expirationForm.dataValidade,
    };
    try {
      await createExpirationRecord(token, body);
      setMessage('Validade registrada.');
    } catch {
      await enqueue('expiration', body);
      setMessage('Sem conexão — validade salva localmente.');
    }
    setExpirationForm(null);
  }

  async function openSurveyPicker(routePdvId: string, pdvId: string) {
    if (!token) return;
    try {
      const surveys = await fetchActiveSurveys(token);
      if (surveys.length === 0) {
        setMessage('Nenhuma pesquisa ativa no momento.');
        return;
      }
      setSurveyPicker({ routePdvId, pdvId, surveys });
    } catch {
      setMessage('Sem conexão — não foi possível carregar as pesquisas disponíveis.');
    }
  }

  return (
    <main style={{ maxWidth: 480, margin: '1rem auto', fontFamily: 'system-ui', padding: '0 1rem' }}>
      <p style={{ color: online ? 'seagreen' : 'crimson' }}>
        {online ? '● Online' : '● Offline'} — {pending} registro(s) aguardando sincronização
      </p>
      {failed > 0 && (
        <p style={{ color: '#b91c1c', display: 'flex', gap: 8, alignItems: 'center' }}>
          {failed} registro(s) não sincronizaram
          <button onClick={retry}>Tentar novamente</button>
        </p>
      )}
      {message && <p style={{ background: '#eef', padding: 8, borderRadius: 6 }}>{message}</p>}
      {stale && route && (
        <p style={{ color: '#92400e', fontSize: 14 }}>
          Sem conexão — mostrando a última rota sincronizada, pode estar desatualizada.
        </p>
      )}

      {!route && <p>Nenhuma rota para hoje{stale ? ' (sem conexão para confirmar)' : ''}.</p>}

      {route && (
        <>
          <h1>{route.nome}</h1>
          <p>
            {route.concluidos}/{route.totalPdvs} atendidos · {route.pendentes} pendente(s)
          </p>
          <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 12 }}>
            {route.pdvs.map((pdv) => (
              <li key={pdv.route_pdv_id} style={{ border: '1px solid #ccc', borderRadius: 8, padding: 12 }}>
                <strong>{pdv.nome}</strong>
                <p>
                  {pdv.bairro}, {pdv.cidade} — {STATUS_LABEL[pdv.status]}
                </p>
                {pdv.status === 'pendente' && (
                  <div style={{ display: 'grid', gap: 8 }}>
                    <button onClick={() => handleCheckin(pdv.route_pdv_id)}>Fazer check-in</button>
                    <button onClick={() => setNotAttendedForm({ routePdvId: pdv.route_pdv_id, motivo: '' })}>
                      Não foi possível atender
                    </button>
                  </div>
                )}
                {pdv.status === 'em_atendimento' && (
                  <div style={{ display: 'grid', gap: 8 }}>
                    <button onClick={() => setPriceForm({ routePdvId: pdv.route_pdv_id, productId: products[0]?.id ?? '', preco: '' })}>
                      Registrar preço
                    </button>
                    <button onClick={() => setPhotoForm({ routePdvId: pdv.route_pdv_id, categoria: 'gondola' })}>
                      Enviar foto
                    </button>
                    <button
                      onClick={() =>
                        setOccurrenceForm({ routePdvId: pdv.route_pdv_id, pdvId: pdv.pdv_id, tipo: 'ruptura', descricao: '' })
                      }
                    >
                      Registrar ocorrência
                    </button>
                    <button
                      onClick={() =>
                        setExpirationForm({
                          routePdvId: pdv.route_pdv_id,
                          pdvId: pdv.pdv_id,
                          productId: products[0]?.id ?? '',
                          quantidade: '',
                          dataValidade: '',
                        })
                      }
                    >
                      Registrar validade
                    </button>
                    <button onClick={() => openSurveyPicker(pdv.route_pdv_id, pdv.pdv_id)}>Responder pesquisa</button>
                    <button onClick={() => handleCheckout(pdv.route_pdv_id)}>Fazer check-out</button>
                  </div>
                )}
                {pdv.status === 'nao_atendido' && pdv.motivo_nao_atendido && (
                  <p style={{ color: '#92400e', fontSize: 14 }}>Motivo: {pdv.motivo_nao_atendido}</p>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {priceForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'grid', placeItems: 'center' }}>
          <div style={{ background: 'white', padding: 16, borderRadius: 8, display: 'grid', gap: 8, width: 280 }}>
            <h3>Registrar preço</h3>
            <select value={priceForm.productId} onChange={(e) => setPriceForm({ ...priceForm, productId: e.target.value })}>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
            <input
              placeholder="Preço"
              type="number"
              step="0.01"
              value={priceForm.preco}
              onChange={(e) => setPriceForm({ ...priceForm, preco: e.target.value })}
            />
            <button onClick={handlePriceSubmit}>Salvar</button>
            <button onClick={() => setPriceForm(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {photoForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'grid', placeItems: 'center' }}>
          <div style={{ background: 'white', padding: 16, borderRadius: 8, display: 'grid', gap: 8, width: 280 }}>
            <h3>Enviar foto</h3>
            <select
              value={photoForm.categoria}
              onChange={(e) => setPhotoForm({ ...photoForm, categoria: e.target.value as PhotoCategory })}
            >
              {PHOTO_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORIA_LABEL[c]}
                </option>
              ))}
            </select>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handlePhotoSubmit(file);
              }}
            />
            <button onClick={() => setPhotoForm(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {occurrenceForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'grid', placeItems: 'center' }}>
          <div style={{ background: 'white', padding: 16, borderRadius: 8, display: 'grid', gap: 8, width: 300 }}>
            <h3>Registrar ocorrência</h3>
            <select
              value={occurrenceForm.tipo}
              onChange={(e) => setOccurrenceForm({ ...occurrenceForm, tipo: e.target.value as OccurrenceType })}
            >
              {OCCURRENCE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {OCORRENCIA_LABEL[t]}
                </option>
              ))}
            </select>
            <textarea
              placeholder="Descrição"
              rows={3}
              value={occurrenceForm.descricao}
              onChange={(e) => setOccurrenceForm({ ...occurrenceForm, descricao: e.target.value })}
            />
            <button onClick={handleOccurrenceSubmit} disabled={!occurrenceForm.descricao.trim()}>
              Salvar
            </button>
            <button onClick={() => setOccurrenceForm(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {notAttendedForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'grid', placeItems: 'center' }}>
          <div style={{ background: 'white', padding: 16, borderRadius: 8, display: 'grid', gap: 8, width: 300 }}>
            <h3>Por que não foi possível atender?</h3>
            <textarea
              placeholder="Motivo (ex.: PDV fechado, responsável indisponível)"
              rows={3}
              value={notAttendedForm.motivo}
              onChange={(e) => setNotAttendedForm({ ...notAttendedForm, motivo: e.target.value })}
            />
            <button onClick={handleNotAttendedSubmit} disabled={!notAttendedForm.motivo.trim()}>
              Salvar
            </button>
            <button onClick={() => setNotAttendedForm(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {expirationForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'grid', placeItems: 'center' }}>
          <div style={{ background: 'white', padding: 16, borderRadius: 8, display: 'grid', gap: 8, width: 300 }}>
            <h3>Registrar validade</h3>
            <select
              value={expirationForm.productId}
              onChange={(e) => setExpirationForm({ ...expirationForm, productId: e.target.value })}
            >
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
            <input
              placeholder="Quantidade"
              type="number"
              value={expirationForm.quantidade}
              onChange={(e) => setExpirationForm({ ...expirationForm, quantidade: e.target.value })}
            />
            <input
              type="date"
              value={expirationForm.dataValidade}
              onChange={(e) => setExpirationForm({ ...expirationForm, dataValidade: e.target.value })}
            />
            <button
              onClick={handleExpirationSubmit}
              disabled={!expirationForm.productId || !expirationForm.quantidade || !expirationForm.dataValidade}
            >
              Salvar
            </button>
            <button onClick={() => setExpirationForm(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {surveyPicker && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'grid', placeItems: 'center' }}>
          <div style={{ background: 'white', padding: 16, borderRadius: 8, display: 'grid', gap: 8, width: 300 }}>
            <h3>Qual pesquisa?</h3>
            {surveyPicker.surveys.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  const active = loadActiveVisits()[surveyPicker.routePdvId];
                  setAnsweringSurvey({ surveyId: s.id, pdvId: surveyPicker.pdvId, visitId: active?.visitId || undefined });
                  setSurveyPicker(null);
                }}
              >
                {s.nome}
              </button>
            ))}
            <button onClick={() => setSurveyPicker(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {answeringSurvey && token && (
        <SurveyAnswerModal
          token={token}
          surveyId={answeringSurvey.surveyId}
          pdvId={answeringSurvey.pdvId}
          visitId={answeringSurvey.visitId}
          onDone={(msg) => {
            setMessage(msg);
            setAnsweringSurvey(null);
          }}
          onCancel={() => setAnsweringSurvey(null)}
        />
      )}

      {token && <MyEvents token={token} />}

      <button onClick={logout} style={{ marginTop: 24 }}>
        Sair
      </button>
    </main>
  );
}
