"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

type ScreenBag = Record<string, unknown>;

type AskScreenApi = {
  setPageScreen: (screen: ScreenBag) => void;
  clearPageScreen: () => void;
};

const AskScreenApiContext = createContext<AskScreenApi | null>(null);
const AskScreenDataContext = createContext<ScreenBag>({});

export function AskScreenProvider({ children }: { children: ReactNode }) {
  const [pageScreen, setPageScreenState] = useState<ScreenBag>({});

  const setPageScreen = useCallback((screen: ScreenBag) => {
    setPageScreenState((prev) => {
      const next = screen;
      try {
        if (JSON.stringify(prev) === JSON.stringify(next)) return prev;
      } catch {
        /* fall through */
      }
      return next;
    });
  }, []);

  const clearPageScreen = useCallback(() => {
    setPageScreenState((prev) => (Object.keys(prev).length ? {} : prev));
  }, []);

  const api = useMemo(
    () => ({ setPageScreen, clearPageScreen }),
    [setPageScreen, clearPageScreen]
  );

  return (
    <AskScreenApiContext.Provider value={api}>
      <AskScreenDataContext.Provider value={pageScreen}>
        {children}
      </AskScreenDataContext.Provider>
    </AskScreenApiContext.Provider>
  );
}

/** Pages push extra on-screen data into the global Ask. */
export function useAskScreen(screen: ScreenBag, enabled = true) {
  const api = useContext(AskScreenApiContext);
  const serialized = useMemo(() => {
    try {
      return JSON.stringify(screen);
    } catch {
      return "";
    }
  }, [screen]);
  const latest = useRef(screen);
  latest.current = screen;

  useEffect(() => {
    if (!api || !enabled) return;
    api.setPageScreen(latest.current);
    return () => api.clearPageScreen();
  }, [api, enabled, serialized]);
}

export function useAskPageScreen() {
  return useContext(AskScreenDataContext);
}
