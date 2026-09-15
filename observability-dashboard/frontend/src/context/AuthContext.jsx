import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../lib/api.js';

const STORAGE_KEY = 'observability-demo.auth';
const AuthContext = createContext(null);

/**
 * Session state.
 *
 * The token lives in localStorage, which is the pragmatic choice for a demo but
 * not what a production app should do — a token readable by any script on the
 * page is a token an XSS can steal. The right answer is an httpOnly cookie,
 * which needs backend work (CSRF protection, cookie settings) that belongs in
 * its own phase.
 */
export function AuthProvider({ children }) {
  const [session, setSession] = useState(() => read());
  const [checking, setChecking] = useState(Boolean(read()?.token));

  // A stored token may have expired while the tab was closed, so it is
  // verified once on load rather than trusted until the first failed request.
  useEffect(() => {
    const stored = read();
    if (!stored?.token) {
      setChecking(false);
      return;
    }

    let cancelled = false;
    api.auth
      .me(stored.token)
      .then(({ data }) => {
        if (!cancelled) setSession({ token: stored.token, user: data.user });
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) clear();
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const adopt = useCallback((data) => {
    const next = { token: data.token, user: data.user };
    write(next);
    setSession(next);
    return next;
  }, []);

  const login = useCallback(
    async (credentials) => adopt((await api.auth.login(credentials)).data),
    [adopt],
  );

  const register = useCallback(
    async (details) => adopt((await api.auth.register(details)).data),
    [adopt],
  );

  const logout = useCallback(() => {
    clear();
    setSession(null);
  }, []);

  function clear() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* private mode, or storage disabled */
    }
  }

  const value = useMemo(
    () => ({
      user: session?.user ?? null,
      token: session?.token ?? null,
      isAuthenticated: Boolean(session?.token),
      checking,
      login,
      register,
      logout,
    }),
    [session, checking, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside an AuthProvider');
  return context;
}

function read() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
  } catch {
    return null;
  }
}

function write(value) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* nothing to do; the session simply will not survive a reload */
  }
}
