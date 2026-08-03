"use client";

import { useEffect, useState } from "react";
import { useBoot } from "@/lib/boot";

/** 最短展示时长：即使数据瞬间加载完成，启动界面也至少显示这么久，避免一闪而过 */
const MIN_BOOT_MS = 1200;

/**
 * 启动加载界面：展示初始化进度条 + 动效预留区。
 * 常用数据优先加载完成后 phase=ready；为保证可见性，至少展示 MIN_BOOT_MS 后再淡出并卸载。
 */
export function BootLoading() {
  const { progress, phase } = useBoot();
  const [started] = useState(() => Date.now());
  const [leaving, setLeaving] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (phase !== "ready") return;
    const remaining = Math.max(0, MIN_BOOT_MS - (Date.now() - started));
    const t1 = window.setTimeout(() => setLeaving(true), remaining);
    const t2 = window.setTimeout(() => setHidden(true), remaining + 350);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [phase, started]);

  if (hidden) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-paper"
      style={{ opacity: leaving ? 0 : 1, transition: "opacity 0.35s ease" }}
    >
      <div className="w-full max-w-xs px-6 text-center">
        {/* ===== 动效预留区 1：品牌 / Logo 动效 ===== */}
        {/* 在这里放置你的动效（Lottie / CSS 帧动画 / 视频 / 图片），当前为占位符。 */}
        <div className="mb-6 flex h-20 items-center justify-center" aria-hidden>
          <span className="text-4xl">✦</span>
        </div>

        <h1 className="text-xl font-semibold tracking-tight">Ex-Lend</h1>
        <p className="mt-1 font-mono text-[11px] text-muted">员工提成与客户账户管理系统</p>

        {/* 进度条 */}
        <div className="mt-6 h-1 w-full overflow-hidden rounded-full bg-surface2">
          <div
            className="h-full bg-accent transition-[width] duration-300 ease-out"
            style={{ width: progress + "%" }}
          />
        </div>
        <p className="mt-2 font-mono text-[10px] text-muted tabular-nums">{progress}%</p>

        {/* ===== 动效预留区 2：底部装饰 / 粒子动效 ===== */}
        {/* 在这里放置加载中的装饰动效（旋转图标 / 粒子 / 文字动效）。 */}
        <div className="mt-8 flex items-center justify-center gap-2" aria-hidden>
          <span className="font-mono text-[11px] text-muted">正在加载常用数据…</span>
        </div>
      </div>
    </div>
  );
}
