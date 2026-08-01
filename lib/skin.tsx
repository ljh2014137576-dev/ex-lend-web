"use client";

import { createContext, useContext, useEffect, useState } from "react";

export type SkinName = "editorial" | "monochrome" | "modern";

export const SKINS: { name: SkinName; label: string }[] = [
  { name: "editorial", label: "Editorial 财务" },
  { name: "monochrome", label: "Monochrome 黑白" },
  { name: "modern", label: "Modern 现代" },
];

// 自托管字体（public/fonts/，fonts.net.cn 免费商用）
export const FONTS: { family: string; label: string }[] = [
  { family: "", label: "跟随皮肤默认" },
  { family: "Noto Sans CJK", label: "思源黑体 Noto Sans CJK" },
  { family: "YouSheBiaoTiHei", label: "优设标题黑" },
  { family: "ZitiQuanXinyiGuanheiTi", label: "字体圈欣意冠黑体" },
  { family: "YangRenDongZhuShiTi", label: "杨任东竹石体 Heavy" },
  { family: "AlimamaFangYuanTi", label: "阿里巴巴方圆体" },
  { family: "MaoKenWangXingYuan", label: "猫啃网新圆" },
  { family: "MaoKenShiJinHei", label: "猫啃噬金黑" },
  { family: "JingNanJunJunTi", label: "静南君君体" },
  { family: "MaoMaoPengYouTi", label: "毛毛朋友体" },
  { family: "JyhPhy", label: "极影毁片圆" },
  { family: "UnDotum", label: "UnDotum" },
  { family: "FTMaru400a", label: "FT Maru" },
  { family: "KonatuTohaba", label: "Konatu Tohaba" },
];

const STORAGE_KEY = "exlend-skin";
const FONT_STORAGE_KEY = "exlend-font";
const DEFAULT_SKIN: SkinName = "editorial";

type SkinContextValue = {
  skin: SkinName;
  setSkin: (s: SkinName) => void;
  font: string;
  setFont: (f: string) => void;
};

const SkinContext = createContext<SkinContextValue>({
  skin: DEFAULT_SKIN,
  setSkin: () => {},
  font: "",
  setFont: () => {},
});

export function SkinProvider({ children }: { children: React.ReactNode }) {
  const [skin, setSkin] = useState<SkinName>(DEFAULT_SKIN);
  const [font, setFont] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY) as SkinName | null;
    if (saved && SKINS.some((s) => s.name === saved)) setSkin(saved);
    const savedFont = localStorage.getItem(FONT_STORAGE_KEY);
    if (savedFont) setFont(savedFont);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.skin = skin;
    localStorage.setItem(STORAGE_KEY, skin);
  }, [skin]);

  useEffect(() => {
    if (font) {
      // 所选字体同时作用于主文字与等宽元数据（编号/金额/时间戳）
      const stack = '"' + font + '", "Noto Sans CJK", "Noto Sans SC", sans-serif';
      document.documentElement.style.setProperty("--font-sans-v", stack);
      document.documentElement.style.setProperty("--font-mono-v", stack);
      localStorage.setItem(FONT_STORAGE_KEY, font);
    } else {
      document.documentElement.style.removeProperty("--font-sans-v");
      document.documentElement.style.removeProperty("--font-mono-v");
      localStorage.removeItem(FONT_STORAGE_KEY);
    }
  }, [font]);

  return (
    <SkinContext.Provider value={{ skin, setSkin, font, setFont }}>
      {children}
    </SkinContext.Provider>
  );
}

export function useSkin() {
  return useContext(SkinContext);
}