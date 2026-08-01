import type { Metadata } from "next";
import { SkinProvider } from "@/lib/skin";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ex-Lend",
  description: "员工提成与客户账户管理系统",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" data-skin="editorial">
      <body className="min-h-screen bg-paper text-ink antialiased">
        <SkinProvider>{children}</SkinProvider>
      </body>
    </html>
  );
}