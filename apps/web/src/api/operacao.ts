import { apiFetch, apiUpload } from './client';

export const PHOTO_CATEGORIES = [
  'antes',
  'depois',
  'gondola',
  'ponto_extra',
  'merchandising',
  'ruptura',
  'livre',
] as const;
export type PhotoCategory = (typeof PHOTO_CATEGORIES)[number];

export interface RoutePdv {
  route_pdv_id: string;
  ordem: number;
  status: 'pendente' | 'em_atendimento' | 'concluido' | 'nao_atendido';
  motivo_nao_atendido: string | null;
  pdv_id: string;
  nome: string;
  bairro: string | null;
  cidade: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface TodayRoute {
  id: string;
  nome: string;
  status: string;
  totalPdvs: number;
  concluidos: number;
  naoAtendidos: number;
  pendentes: number;
  pdvs: RoutePdv[];
}

export interface Product {
  id: string;
  nome: string;
  marca: string | null;
}

export function fetchTodayRoute(token: string) {
  return apiFetch<TodayRoute>('/routes/today', { token });
}

export function fetchProducts(token: string) {
  return apiFetch<Product[]>('/products', { token });
}

export function checkin(
  token: string,
  body: { clientId: string; routePdvId: string; latitude?: number; longitude?: number; precisaoM?: number },
) {
  return apiFetch<{ id: string }>('/visits/checkin', { method: 'POST', token, body });
}

export function checkout(
  token: string,
  body: { visitId: string; latitude?: number; longitude?: number; justificativa?: string },
) {
  return apiFetch('/visits/checkout', { method: 'POST', token, body });
}

export function collectPrice(
  token: string,
  body: { clientId: string; visitId: string; productId: string; preco: number; marca?: string },
) {
  return apiFetch('/price-collections', { method: 'POST', token, body });
}

export function markRoutePdvStatus(
  token: string,
  routePdvId: string,
  body: { status: 'nao_atendido'; motivoNaoAtendido: string },
) {
  return apiFetch(`/routes/pdvs/${routePdvId}/status`, { method: 'PATCH', token, body });
}

export function uploadPhoto(
  token: string,
  params: { clientId: string; visitId: string; categoria: PhotoCategory; file: Blob },
) {
  return apiUpload<{ id: string }>('/photos', {
    token,
    fields: { clientId: params.clientId, visitId: params.visitId, categoria: params.categoria },
    file: params.file,
  });
}

export const OCCURRENCE_TYPES = [
  'ruptura',
  'falta_espaco',
  'material_danificado',
  'problema_operacional',
  'concorrente',
  'problema_atendimento',
  'outro',
] as const;
export type OccurrenceType = (typeof OCCURRENCE_TYPES)[number];

export function createOccurrence(
  token: string,
  body: { clientId: string; pdvId: string; visitId?: string; tipo: OccurrenceType; descricao: string; prioridade?: 'baixa' | 'media' | 'alta' },
) {
  return apiFetch<{ id: string; status: string }>('/occurrences', { method: 'POST', token, body });
}

export function createExpirationRecord(
  token: string,
  body: { clientId: string; pdvId: string; productId: string; quantidade: number; dataValidade: string; observacoes?: string },
) {
  return apiFetch<{ id: string }>('/expirations', { method: 'POST', token, body });
}

export interface ActiveSurvey {
  id: string;
  nome: string;
  descricao: string | null;
}

export interface SurveyQuestionForm {
  id: string;
  ordem: number;
  tipo: 'texto' | 'numero' | 'sim_nao' | 'multipla_escolha' | 'selecao_unica' | 'nota' | 'foto';
  texto: string;
  obrigatoria: boolean;
  opcoes: string[] | null;
}

export function fetchActiveSurveys(token: string) {
  return apiFetch<ActiveSurvey[]>('/surveys/active', { token });
}

export function fetchSurveyForm(token: string, surveyId: string) {
  return apiFetch<{ id: string; nome: string; descricao: string | null; questions: SurveyQuestionForm[] }>(`/surveys/${surveyId}`, { token });
}

export function submitSurveyResponse(
  token: string,
  body: { clientId: string; surveyId: string; pdvId: string; visitId?: string; answers: { questionId: string; valor: string }[] },
) {
  return apiFetch<{ id: string }>('/survey-responses', { method: 'POST', token, body });
}

export interface MyEvent {
  id: string;
  nome: string;
  data: string;
  meta: string | null;
  pdv: string;
  pdv_id: string;
  ja_registrou: boolean;
}

export function fetchMyEvents(token: string) {
  return apiFetch<MyEvent[]>('/events/mine', { token });
}

export function submitEventResult(
  token: string,
  eventId: string,
  body: { clientId: string; pessoasAbordadas?: number; degustacoesRealizadas?: number; quantidadeDistribuida?: number; observacoes?: string },
) {
  return apiFetch<{ id: string }>(`/events/${eventId}/results`, { method: 'POST', token, body });
}

export function getCurrentPosition(): Promise<GeolocationPosition | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  });
}
