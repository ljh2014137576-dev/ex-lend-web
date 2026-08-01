import type { Metadata } from "next";
import "@fontsource/noto-sans-sc/400.css";
import "@fontsource/noto-sans-sc/500.css";
import "@fontsource/noto-sans-sc/600.css";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource-variable/inter";
import { SkinProvider } from "@/lib/skin";
import { ProfileProvider } from "@/lib/profile";
import { AuthProvider } from "@/lib/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ex-Lend",
  description: "员工提成与客户账户管理系统",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" data-skin="editorial">
      <body className="min-h-screen bg-paper text-ink antialiased">
        <SkinProvider><AuthProvider><ProfileProvider>{children}</ProfileProvider></AuthProvider></SkinProvider>
      </body>
    </html>
  );
}