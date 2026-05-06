import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import api from '../lib/api';
import {
  clearPersistedSession,
  EXTENSION_AUTH_ATTRIBUTE,
  EXTENSION_STATE_ATTRIBUTE,
} from '../lib/extensionSync';

interface User {
  id: number;
  email: string;
}

interface AuthContextType {
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, otp: string) => Promise<void>;
  sendOtp: (email: string) => Promise<void>;
  sendForgotPasswordOtp: (email: string) => Promise<void>;
  resetPassword: (email: string, otp: string, password: string) => Promise<void>;
  logout: () => void;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);
const initialToken = localStorage.getItem('devwell_token');

function getExtensionEmailMismatchMessage(nextEmail: string): string | null {
  if (typeof document === 'undefined') return null;

  const rawState = document.documentElement.getAttribute(EXTENSION_STATE_ATTRIBUTE);
  if (!rawState) return null;

  try {
    const parsed = JSON.parse(rawState);
    if (parsed?.source !== 'extension') return null;

    const extensionLoggedIn = Boolean(parsed?.extensionAuth?.loggedIn);
    const extensionEmail = typeof parsed?.extensionAuth?.email === 'string'
      ? parsed.extensionAuth.email.trim().toLowerCase()
      : '';
    const websiteEmail = nextEmail.trim().toLowerCase();

    if (!extensionLoggedIn || !extensionEmail || !websiteEmail || extensionEmail === websiteEmail) {
      return null;
    }

    return `Website login blocked: extension is logged in as ${parsed.extensionAuth.email}. Please use the same email or log out from extension first.`;
  } catch {
    return null;
  }
}

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
    const mismatchMessage = getExtensionEmailMismatchMessage(email);
    if (mismatchMessage) {
      throw new Error(mismatchMessage);
    }

    const res = await api.post('/auth/login', { email, password });
    localStorage.setItem('devwell_token', res.data.token);
    setToken(res.data.token);
    setUser(res.data.user);

    clearPersistedSession();
  };

  const register = async (email: string, password: string, otp: string) => {
    const mismatchMessage = getExtensionEmailMismatchMessage(email);
    if (mismatchMessage) {
      throw new Error(mismatchMessage);
    }

    const res = await api.post('/auth/register', { email, password, otp });
    localStorage.setItem('devwell_token', res.data.token);
    setToken(res.data.token);
    setUser(res.data.user);

    clearPersistedSession();
  };

  const sendOtp = async (email: string) => {
    await api.post('/auth/send-otp', { email });
  };

  const sendForgotPasswordOtp = async (email: string) => {
    await api.post('/auth/forgot-password', { email });
  };

  const resetPassword = async (email: string, otp: string, password: string) => {
    await api.post('/auth/reset-password', { email, otp, password });
  };

  const logout = () => {
    localStorage.removeItem('devwell_token');
    setToken(null);
    setUser(null);

    clearPersistedSession();
  };

  return (
    <AuthContext.Provider value={{ user, login, register, sendOtp, sendForgotPasswordOtp, resetPassword, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
