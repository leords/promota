import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';

const linkStyle = ({ isActive }: { isActive: boolean }) => ({
  padding: '8px 12px',
  textDecoration: 'none',
  color: isActive ? '#0f172a' : '#475569',
  fontWeight: isActive ? 700 : 400,
  borderBottom: isActive ? '2px solid #0f172a' : '2px solid transparent',
  whiteSpace: 'nowrap' as const,
});

export default function AdminLayout() {
  const { logout } = useAuth();

  return (
    <div style={{ fontFamily: 'system-ui', maxWidth: 1100, margin: '0 auto', padding: '0 1rem' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 0' }}>
        <h1 style={{ fontSize: 20 }}>Promota — Gestão</h1>
        <button onClick={logout}>Sair</button>
      </header>
      <nav style={{ display: 'flex', gap: 8, flexWrap: 'wrap', borderBottom: '1px solid #e2e8f0', marginBottom: 24 }}>
        <NavLink to="/dashboard" style={linkStyle}>
          Dashboard
        </NavLink>
        <NavLink to="/pdvs" style={linkStyle}>
          PDVs
        </NavLink>
        <NavLink to="/produtos" style={linkStyle}>
          Produtos
        </NavLink>
        <NavLink to="/rotas" style={linkStyle}>
          Rotas
        </NavLink>
        <NavLink to="/ocorrencias" style={linkStyle}>
          Ocorrências
        </NavLink>
        <NavLink to="/mapa" style={linkStyle}>
          Mapa
        </NavLink>
        <NavLink to="/validades" style={linkStyle}>
          Validades
        </NavLink>
        <NavLink to="/pesquisas" style={linkStyle}>
          Pesquisas
        </NavLink>
        <NavLink to="/eventos" style={linkStyle}>
          Eventos
        </NavLink>
        <NavLink to="/relatorios" style={linkStyle}>
          Relatórios
        </NavLink>
        <NavLink to="/notificacoes" style={linkStyle}>
          Notificações
        </NavLink>
      </nav>
      <Outlet />
    </div>
  );
}
