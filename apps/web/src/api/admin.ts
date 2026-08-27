import { apiFetch, ApiError, API_BASE_URL } from './client';

export interface Pdv {
  id: string;
  nome: string;
  cidade: string | null;
  bairro: string | null;
  rede: string | null;
  tipo_estabelecimento: string | null;
  promotor_responsavel_id: string | null;
  ativo: boolean;
  notificar_email: boolean;
  email: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface Product {
  id: string;
  nome: string;
  marca: string | null;
  categoria: string | null;
  ativo: boolean;
}

export interface UserSummary {
  id: string;
  nome: string;
  email: string;
  role: string;
  ativo: boolean;
}

export interface RouteSummary {
  id: string;
  nome: string;
  data: string;
  status: string;
  promotor: string;
  total_pdvs: string;
  concluidos: string;
}

export interface PdvDetail extends Pdv {
  razao_social: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  uf: string | null;
  cep: string | null;
  telefone: string | null;
  email: string | null;
  contato_responsavel: string | null;
  promotor_responsavel_id: string | null;
  observacoes: string | null;
  ultimasVisitas: { id: string; checkin_em: string; checkout_em: string | null; duracao_segundos: number | null; promotor: string }[];
  precos: { id: string; preco: string; marca: string | null; concorrente: string | null; coletado_em: string; produto: string }[];
}

export interface Photo {
  id: string;
  categoria: string;
  storage_key: string;
  criado_em: string;
}

// Fotos NUNCA são servidas por URL pública — /photos/:id/file exige o Bearer token
// do tenant dono da foto (ver apps/api/src/routes/photos.ts). Um <img src> normal
// não manda esse header, então buscamos autenticado e criamos um blob URL local;
// quem chama isto é responsável por revogar a URL com URL.revokeObjectURL quando
// não precisar mais (ver PdvDetail.tsx).
export async function fetchPhotoBlobUrl(token: string, photoId: string): Promise<string> {
  const res = await fetch(`${API_BASE_URL}/photos/${photoId}/file`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new ApiError(res.status, undefined);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export const listPdvs = (token: string) => apiFetch<Pdv[]>('/pdvs', { token });

export const createPdv = (
  token: string,
  body: {
    nome: string;
    cidade?: string;
    bairro?: string;
    rede?: string;
    tipoEstabelecimento?: string;
    latitude?: number;
    longitude?: number;
    frequenciaEsperadaDias?: number;
    promotorResponsavelId?: string;
    notificarEmail?: boolean;
    email?: string;
  },
) => apiFetch<{ id: string }>('/pdvs', { method: 'POST', token, body });

export const listProducts = (token: string) => apiFetch<Product[]>('/products?includeInactive=true', { token });

export const createProduct = (token: string, body: { nome: string; marca?: string; categoria?: string }) =>
  apiFetch<{ id: string }>('/products', { method: 'POST', token, body });

export const getPdv = (token: string, id: string) => apiFetch<PdvDetail>(`/pdvs/${id}`, { token });

export const updatePdv = (
  token: string,
  id: string,
  body: {
    nome?: string;
    cidade?: string;
    bairro?: string;
    rede?: string;
    tipoEstabelecimento?: string;
    observacoes?: string;
    frequenciaEsperadaDias?: number;
    promotorResponsavelId?: string;
    notificarEmail?: boolean;
    email?: string;
  },
) => apiFetch<{ id: string }>(`/pdvs/${id}`, { method: 'PATCH', token, body });

export const setPdvStatus = (token: string, id: string, ativo: boolean) =>
  apiFetch<{ id: string; ativo: boolean }>(`/pdvs/${id}/status`, { method: 'PATCH', token, body: { ativo } });

export const updateProduct = (
  token: string,
  id: string,
  body: { nome?: string; marca?: string; categoria?: string; ativo?: boolean },
) => apiFetch<{ id: string }>(`/products/${id}`, { method: 'PATCH', token, body });

export const listPhotosByPdv = (token: string, pdvId: string) =>
  apiFetch<Photo[]>(`/photos?pdvId=${pdvId}`, { token });

export const listUsers = (token: string, role?: string) =>
  apiFetch<UserSummary[]>(`/users${role ? `?role=${role}` : ''}`, { token });

export const listRoutes = (token: string) => apiFetch<RouteSummary[]>('/routes', { token });

export const createRoute = (
  token: string,
  body: { nome: string; data: string; promotorId: string; pdvIds: string[] },
) => apiFetch<{ id: string }>('/routes', { method: 'POST', token, body });

export interface Occurrence {
  id: string;
  tipo: string;
  descricao: string;
  prioridade: 'baixa' | 'media' | 'alta';
  status: 'aberta' | 'em_acompanhamento' | 'resolvida';
  criado_em: string;
  pdv: string;
  promotor: string;
}

export const listOccurrences = (token: string, status?: string) =>
  apiFetch<Occurrence[]>(`/occurrences${status ? `?status=${status}` : ''}`, { token });

export const setOccurrenceStatus = (token: string, id: string, status: Occurrence['status']) =>
  apiFetch<{ id: string; status: string }>(`/occurrences/${id}/status`, { method: 'PATCH', token, body: { status } });

export interface DashboardToday {
  operacional: {
    promotores_programados: string;
    promotores_que_trabalharam: string;
    pdvs_planejados: string;
    pdvs_atendidos: string;
    pdvs_nao_atendidos: string;
    pdvs_pendentes: string;
    rotas_pendentes: string;
  };
  tempoMedioSegundos: number | null;
  ocorrenciasAbertas: number;
  produtosCriticos: number;
  promotoresSemAtividade: { id: string; nome: string }[];
  pdvsSemCobertura: { id: string; nome: string; frequencia_esperada_dias: number; ultima_visita: string | null }[];
}

export const getDashboardToday = (token: string) => apiFetch<DashboardToday>('/dashboard/today', { token });

// ---- Controle de validades (Seção 14) ----

export interface ExpirationRecord {
  id: string;
  quantidade: number;
  data_validade: string;
  observacoes: string | null;
  pdv: string;
  produto: string;
  dias_restantes: number;
  classificacao: 'critico' | 'atencao' | 'regular';
}

export const listExpirations = (token: string) => apiFetch<ExpirationRecord[]>('/expirations', { token });

export interface ExpirationSettings {
  dias_critico: number;
  dias_atencao: number;
}

export const getExpirationSettings = (token: string) => apiFetch<ExpirationSettings>('/expirations/settings', { token });

export const setExpirationSettings = (token: string, diasCritico: number, diasAtencao: number) =>
  apiFetch<{ diasCritico: number; diasAtencao: number }>('/expirations/settings', {
    method: 'PUT',
    token,
    body: { diasCritico, diasAtencao },
  });

// ---- Pesquisas dinâmicas (Seção 11) ----

export type QuestionType = 'texto' | 'numero' | 'sim_nao' | 'multipla_escolha' | 'selecao_unica' | 'nota' | 'foto';

export interface SurveySummary {
  id: string;
  nome: string;
  status: 'rascunho' | 'ativa' | 'encerrada';
  disponivel_de: string | null;
  disponivel_ate: string | null;
  total_perguntas: string;
  total_respostas: string;
}

export interface SurveyQuestion {
  id: string;
  ordem: number;
  tipo: QuestionType;
  texto: string;
  obrigatoria: boolean;
  opcoes: string[] | null;
}

export interface SurveyDetail {
  id: string;
  nome: string;
  descricao: string | null;
  status: SurveySummary['status'];
  questions: SurveyQuestion[];
}

export const listSurveys = (token: string) => apiFetch<SurveySummary[]>('/surveys', { token });

export const createSurvey = (token: string, body: { nome: string; descricao?: string }) =>
  apiFetch<{ id: string }>('/surveys', { method: 'POST', token, body });

export const getSurvey = (token: string, id: string) => apiFetch<SurveyDetail>(`/surveys/${id}`, { token });

export const setSurveyStatus = (token: string, id: string, status: SurveySummary['status']) =>
  apiFetch<{ id: string; status: string }>(`/surveys/${id}/status`, { method: 'PATCH', token, body: { status } });

export const addSurveyQuestion = (
  token: string,
  surveyId: string,
  body: { tipo: QuestionType; texto: string; obrigatoria?: boolean; opcoes?: string[] },
) => apiFetch<{ id: string }>(`/surveys/${surveyId}/questions`, { method: 'POST', token, body });

export const deleteSurveyQuestion = (token: string, questionId: string) =>
  apiFetch<void>(`/surveys/questions/${questionId}`, { method: 'DELETE', token });

export interface SurveyResponseRow {
  response_id: string;
  criado_em: string;
  pdv: string;
  promotor: string;
  question_id: string;
  valor: string;
  pergunta: string;
  tipo: QuestionType;
}

export const listSurveyResponses = (token: string, surveyId: string) =>
  apiFetch<SurveyResponseRow[]>(`/surveys/${surveyId}/responses`, { token });

// ---- Eventos e degustações (Seção 12) ----

export interface EventSummary {
  id: string;
  nome: string;
  data: string;
  meta: string | null;
  pdv: string;
  total_resultados: string;
  total_pessoas_abordadas: string;
  total_distribuido: string;
}

export const listEvents = (token: string) => apiFetch<EventSummary[]>('/events', { token });

export const createEvent = (
  token: string,
  body: { nome: string; descricao?: string; pdvId: string; data: string; meta?: string; promotorIds: string[]; productIds?: string[] },
) => apiFetch<{ id: string }>('/events', { method: 'POST', token, body });

export interface EventDetail {
  id: string;
  nome: string;
  descricao: string | null;
  data: string;
  meta: string | null;
  observacoes: string | null;
  pdv: string;
  promotores: { id: string; nome: string }[];
  produtos: { id: string; nome: string }[];
  resultados: {
    id: string;
    pessoas_abordadas: number | null;
    degustacoes_realizadas: number | null;
    quantidade_distribuida: number | null;
    observacoes: string | null;
    promotor: string;
  }[];
}

export const getEvent = (token: string, id: string) => apiFetch<EventDetail>(`/events/${id}`, { token });

// ---- Notificações (Seção 14) ----

export interface NotificationLogEntry {
  id: string;
  tipo: string;
  assunto: string;
  canal: 'email' | 'sistema';
  status: 'enviada' | 'falha' | 'pulada';
  erro: string | null;
  criado_em: string;
  destinatario: string | null;
}

export const listNotifications = (token: string) => apiFetch<NotificationLogEntry[]>('/notifications', { token });
