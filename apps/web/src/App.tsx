import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { decodeTokenRole } from './auth/decodeToken';
import Login from './pages/Login';
import RouteToday from './pages/RouteToday';
import AdminLayout from './pages/admin/AdminLayout';
import DashboardPage from './pages/admin/DashboardPage';
import PdvsPage from './pages/admin/PdvsPage';
import ProductsPage from './pages/admin/ProductsPage';
import RoutesPage from './pages/admin/RoutesPage';
import OccurrencesPage from './pages/admin/OccurrencesPage';
import MapaPage from './pages/admin/MapaPage';
import ExpirationsPage from './pages/admin/ExpirationsPage';
import SurveysPage from './pages/admin/SurveysPage';
import EventsPage from './pages/admin/EventsPage';
import ReportsPage from './pages/admin/ReportsPage';
import NotificationsPage from './pages/admin/NotificationsPage';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  return token ? <>{children}</> : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <HomeRedirect />
            </ProtectedRoute>
          }
        />
        <Route
          element={
            <ProtectedRoute>
              <AdminLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/pdvs" element={<PdvsPage />} />
          <Route path="/produtos" element={<ProductsPage />} />
          <Route path="/rotas" element={<RoutesPage />} />
          <Route path="/ocorrencias" element={<OccurrencesPage />} />
          <Route path="/mapa" element={<MapaPage />} />
          <Route path="/validades" element={<ExpirationsPage />} />
          <Route path="/pesquisas" element={<SurveysPage />} />
          <Route path="/eventos" element={<EventsPage />} />
          <Route path="/relatorios" element={<ReportsPage />} />
          <Route path="/notificacoes" element={<NotificationsPage />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}

// Promotor vê a rota do dia (Seção 2.2 — mobile first para operação em campo);
// outras roles (admin/gerente/supervisor) vão para o dashboard (Seção 16 — "onde o
// gestor precisa olhar agora" é a primeira coisa que ele deve ver ao entrar).
function HomeRedirect() {
  const { token } = useAuth();
  const role = token ? decodeTokenRole(token) : null;
  return role === 'promotor' ? <RouteToday /> : <Navigate to="/dashboard" replace />;
}
