import { SkinSwitcher } from "@/components/ui/SkinSwitcher";

export default function Home() {
  return (
    <main className="mx-auto max-w-4xl p-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Ex-Lend</h1>
          <p className="mt-1 font-mono text-sm text-muted">
            员工提成与客户账户管理系统 · 脚手架 v0.1
          </p>
        </div>
        <SkinSwitcher />
      </header>

      <hr className="my-8 border-line" />

      <section className="space-y-2 font-mono text-sm text-muted">
        <p>01 登录页 /login —— 待实现</p>
        <p>02 收银台 /cashier —— 待实现</p>
        <p>03 订单目录 /orders —— 待实现</p>
        <p>04 提成审核台 /audit —— 待实现</p>
        <p>05 财务 /finance —— 待实现</p>
      </section>
    </main>
  );
}