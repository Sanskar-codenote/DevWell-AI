import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import api from '../lib/api';

interface User {
  id: number;
  email: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => void;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('devwell_token'));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (token) {
      api.get('/auth/me')
        .then((res) => setUser(res.data.user))
        .catch(() => {
          // Token is invalid or expired
          localStorage.removeItem('devwell_token');
          setToken(null);
          setUser(null);
          // Don't clear session data here - let SessionContext handle it
          // Session data will be cleared on next explicit login/logout
          console.log('[Auth] Token invalid, user logged out');
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [token]);

  const login = async (email: string, password: string) => {
    const res = await api.post('/auth/login', { email, password });
    localStorage.setItem('devwell_token', res.data.token);
    setToken(res.data.token);
    setUser(res.data.user);
    
    // Clear any stale session data from previous user
    sessionStorage.removeItem('devwell_active_session');
    sessionStorage.removeItem('devwell_session_data');
    console.log('[Auth] User logged in, cleared stale session data');
  };

  const register = async (email: string, password: string) => {
    const res = await api.post('/auth/register', { email, password });
    localStorage.setItem('devwell_token', res.data.token);
    setToken(res.data.token);
    setUser(res.data.user);
    
    // Clear any stale session data (new user shouldn't have session data)
    sessionStorage.removeItem('devwell_active_session');
    sessionStorage.removeItem('devwell_session_data');
    console.log('[Auth] User registered, cleared session data');
  };

  const logout = () => {
    // Clear authentication data
    localStorage.removeItem('devwell_token');
    setToken(null);
    setUser(null);
    
    // Clear all session-related data to prevent cross-user data leakage
    sessionStorage.removeItem('devwell_active_session');
    sessionStorage.removeItem('devwell_session_data');
    
    console.log('[Auth] User logged out, cleared all session data');
  };

  return (
    <AuthContext.Provider value={{ user, token, login, register, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
