// Chaves de localStorage usadas para cache/estado offline do promotor (ver
// pages/RouteToday.tsx). Centralizadas aqui só para que AuthContext possa limpá-las
// no logout sem criar um import circular com a página.
export const CACHED_ROUTE_KEY = 'promota_cached_route';
export const ACTIVE_VISIT_KEY = 'promota_active_visits';
