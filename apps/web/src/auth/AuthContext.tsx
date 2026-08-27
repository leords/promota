import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { apiFetch } from '../api/client';
import { ACTIVE_VISIT_KEY, CACHED_ROUTE_KEY } from '../offline/localKeys';

interface AuthState {
  token: string | null;
  login: (tenantSlug: string, email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | undefined>(undefined);
const STORAGE_KEY = 'promota_token';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY));

  const value = useMemo<AuthState>(
    () => ({
      token,
      async login(tenantSlug, email, password) {
        const { token: newToken } = await apiFetch<{ token: string }>('/auth/login', {
          method: 'POST',
          body: { tenantSlug, email, password },
        });
        localStorage.setItem(STORAGE_KEY, newToken);
        setToken(newToken);
      },
      logout() {
        localStorage.removeItem(STORAGE_KEY);
        // Evita que a rota/visitas em cache de um tenant vazem para o próximo login
        // no mesmo dispositivo (ver offline/localKeys.ts).
        localStorage.removeItem(CACHED_ROUTE_KEY);
        localStorage.removeItem(ACTIVE_VISIT_KEY);
        setToken(null);
      },
    }),
    [token],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
