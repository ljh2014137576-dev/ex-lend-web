"use client";

import { createContext, useContext, useEffect, useState } from "react";

export type SkinName = "editorial" | "monochrome" | "modern";

export const SKINS: { name: SkinName; label: string }[] = [
  { name: "editorial", label: "Editorial 财务" },
  { name: "monochrome", label: "Monochrome 黑白" },
  { name: "modern", label: "Modern 现代" },
];

const STORAGE_KEY = "exlend-skin";
const DEFAULT_SKIN: SkinName = "editorial";

type SkinContextValue = {
  skin: SkinName;
  setSkin: (s: SkinName) => void;
};

const SkinContext = createContext<SkinContextValue>({
  skin: DEFAULT_SKIN,
  setSkin: () => {},
});

export function SkinProvider({ children }: { children: React.ReactNode }) {
  const [skin, setSkin] = useState<SkinName>(DEFAULT_SKIN);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY) as SkinName | null;
    if (saved && SKINS.some((s) => s.name === saved)) {
      setSkin(saved);
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.skin = skin;
    localStorage.setItem(STORAGE_KEY, skin);
  }, [skin]);

  return <SkinContext.Provider value={{ skin, setSkin }}>{children}</SkinContext.Provider>;
}

export function useSkin() {
  return useContext(SkinContext);
}