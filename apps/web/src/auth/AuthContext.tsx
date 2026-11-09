import { createContext, ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react";
import { Api, createApi, Learner } from "../api/client";

const KEY = "marketlab.session";

/** The token lives in memory and sessionStorage only (never localStorage, never in a URL); signing out clears both. */
function readSession(): { token: string; learner: Learner } | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

interface AuthValue {
  api: Api;
  learner: Learner | null;
  notice: string | null;
  signIn: (name: string, password: string) => Promise<void>;
  register: (name: string, password: string) => Promise<void>;
  signOut: (notice?: string) => void;
}

const Ctx = createContext<AuthValue | null>(null);

export function AuthProvider({ children, apiOverride }: { children: ReactNode; apiOverride?: Api }) {
  const initial = useMemo(readSession, []);
  const tokenRef = useRef<string | null>(initial?.token ?? null);
  const [learner, setLearner] = useState<Learner | null>(initial?.learner ?? null);
  const [notice, setNotice] = useState<string | null>(null);

  const signOut = useCallback((message?: string) => {
    tokenRef.current = null;
    setLearner(null);
    setNotice(message ?? null);
    try { sessionStorage.removeItem(KEY); } catch { /* private mode */ }
  }, []);

  const api = useMemo<Api>(
    () => apiOverride ?? createApi({ getToken: () => tokenRef.current, onUnauthorized: () => signOut("Your session ended. Please sign in again.") }),
    [apiOverride, signOut],
  );

  const accept = useCallback((r: { token: string; learner: Learner }) => {
    tokenRef.current = r.token;
    setLearner(r.learner);
    setNotice(null);
    try { sessionStorage.setItem(KEY, JSON.stringify(r)); } catch { /* private mode */ }
  }, []);

  const value = useMemo<AuthValue>(() => ({
    api, learner, notice, signOut,
    signIn: async (n, p) => accept(await api.login(n, p)),
    register: async (n, p) => accept(await api.register(n, p)),
  }), [api, learner, notice, signOut, accept]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside AuthProvider");
  return v;
}
