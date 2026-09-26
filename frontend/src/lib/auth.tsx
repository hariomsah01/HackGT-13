"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { SessionUser } from "./types";

type AuthCtx = {
  token: string | null;
  user: SessionUser | null;
  ready: boolean;
  login: (token: string, user: SessionUser) => void;
  logout: () => void;
};

const Ctx = createContext<AuthCtx | null>(null);
const T = "cp_token";
const U = "cp_user";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const t = localStorage.getItem(T);
    const u = localStorage.getItem(U);
    if (t && u) {
      setToken(t);
      setUser(JSON.parse(u));
    }
    setReady(true);
  }, []);

  const value = useMemo(
    () => ({
      token,
      user,
      ready,
      login: (t: string, u: SessionUser) => {
        localStorage.setItem(T, t);
        localStorage.setItem(U, JSON.stringify(u));
        setToken(t);
        setUser(u);
      },
      logout: () => {
        localStorage.removeItem(T);
        localStorage.removeItem(U);
        setToken(null);
        setUser(null);
      },
    }),
    [token, user, ready]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("Auth missing");
  return v;
}
