"use client";

import { ReactNode } from "react";

export function Modal({
  open,
  title,
  onClose,
  children,
  wide,
  xwide,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  xwide?: boolean;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center p-4 pt-[8vh]" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 bg-overlay"
        style={{ animation: "ex-fade-in var(--transition-fast-v) ease-out" }}
        onClick={onClose}
      />
      <div
        className={[
          "ui-modal ui-modal-anim glass relative w-full max-h-[calc(100dvh-4rem)] overflow-y-auto rounded-md border border-line p-5 shadow-lg",
          xwide ? "max-w-4xl" : wide ? "max-w-2xl" : "max-w-md",
        ].join(" ")}
      >
        <header className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-sm font-medium">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-line px-2 py-1 font-mono text-xs transition-colors hover:bg-surface2"
          >
            鍏抽棴
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}


