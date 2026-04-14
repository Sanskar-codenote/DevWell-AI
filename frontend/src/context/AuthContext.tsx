import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import api from '../lib/api';
import {
  clearPersistedSession,
  EXTENSION_AUTH_ATTRIBUTE,
} from '../lib/extensionSync';

interface User {
  id: number;
  email: string;
}

interface AuthContextType {
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => void;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);
const initialToken = localStorage.getItem('devwell_token');

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(initialToken);
  const [loading, setLoading] = useState(Boolean(initialToken));

  useEffect(() => {
    if (!token) return;

    let cancelled = false;

    void api.get('/auth/me')
      .then((res) => {
        if (!cancelled) {
          setUser(res.data.user);
        }
      })
      .catch(() => {
        if (!cancelled) {
          localStorage.removeItem('devwell_token');
          clearPersistedSession();
          setToken(null);
          setUser(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    document.documentElement.setAttribute(
      EXTENSION_AUTH_ATTRIBUTE,
      JSON.stringify({
        loggedIn: Boolean(token && user),
        email: user?.email ?? null,
      })
    );

    return () => {
      document.documentElement.removeAttribute(EXTENSION_AUTH_ATTRIBUTE);
    };
  }, [token, user]);

  const login = async (email: string, password: string) => {
    const res = await api.post('/auth/login', { email, password });
    localStorage.setItem('devwell_token', res.data.token);
    setToken(res.data.token);
    setUser(res.data.user);

    clearPersistedSession();
  };

  const register = async (email: string, password: string) => {
    const res = await api.post('/auth/register', { email, password });
    localStorage.setItem('devwell_token', res.data.token);
    setToken(res.data.token);
    setUser(res.data.user);

    clearPersistedSession();
  };

  const logout = () => {
    localStorage.removeItem('devwell_token');
    setToken(null);
    setUser(null);

    clearPersistedSession();
  };

  return (
    <AuthContext.Provider value={{ user, login, register, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
