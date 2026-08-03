"use client";

import { createContext, useContext, useState } from "react";

type BootPhase = "loading" | "ready";

type BootContextValue = {
  progress: number; // 0-100
  phase: BootPhase;
  setProgress: (n: number) => void;
  markReady: () => void;
};

const BootContext = createContext<BootContextValue | null>(null);

export function BootProvider({ children }: { children: React.ReactNode }) {
  const [progress, setProgressState] = useState(0);
  const [phase, setPhase] = useState<BootPhase>("loading");

  const setProgress = (n: number) => setProgressState(Math.max(0, Math.min(100, Math.round(n))));
  const markReady = () => setPhase("ready");

  return (
    <BootContext.Provider value={{ progress, phase, setProgress, markReady }}>
      {children}
    </BootContext.Provider>
  );
}

export function useBoot() {
  const ctx = useContext(BootContext);
  if (!ctx) throw new Error("useBoot must be used within BootProvider");
  return ctx;
}
