"use client";

import { useRef, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { DataTable } from "@/components/ui/DataTable";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { StatusDot } from "@/components/ui/StatusDot";
import { GRADE_RULES, VIP_DISCOUNT_RULES, VIP_UPGRADE_RULES, RECHARGE_PACKAGES, type GradeRule, type VipDiscountRule, type VipUpgradeRule, type RechargePackage } from "@/lib/mock-data";
import { apiGradeRules, apiVipDiscountRules, apiVipUpgradeRules, apiRechargePackages, apiUpdateGradeRate, apiUpdateRechargePackageStatus } from "@/lib/supabase-api";
import { supabase } from "@/lib/supabase";
import { useResource } from "@/lib/data-store";
import { useAuth } from "@/lib/auth";
import { NoPermission } from "@/components/business/RequireRole";

const money = (n: number) => "¥" + n.toLocaleString("zh-CN", { minimumFractionDigits: 2 });
const pct = (n: number) => (n * 100).toFixed(0) + "%";

export default function RulesPage() {
  const { data: grades, real, mutate: setGrades } = useResource<GradeRule>("gradeRules", apiGradeRules, GRADE_RULES);
  const { data: vipDiscounts, mutate: setVipDiscounts } = useResource<VipDiscountRule>("vipDiscounts", apiVipDiscountRules, VIP_DISCOUNT_RULES);
  const { data: upgrades, mutate: setUpgrades } = useResource<VipUpgradeRule>("vipUpgrades", apiVipUpgradeRules, VIP_UPGRADE_RULES);
  const { data: packages, real: packagesReal, mutate: setPackages } = useResource<RechargePackage>("rechargePackages", apiRechargePackages, RECHARGE_PACKAGES);

  const [newGrade, setNewGrade] = useState({ grade: 4, rate: 0.12 });
  const [newVip, setNewVip] = useState({ vipLevel: 2, category: "正常单", discount: 0.92 });
  const [newUpgrade, setNewUpgrade] = useState({ vipLevel: 4, threshold: 100000 });
  const [newPkg, setNewPkg] = useState({ amount: 3000, bonus: 500 });
  const { session, isBoss } = useAuth();
  const [gradeDrafts, setGradeDrafts] = useState<Record<number, string>>({});
  const [gradeSaving, setGradeSaving] = useState<Record<number, boolean>>({});
  const [gradeFeedback, setGradeFeedback] = useState<Record<number, { error: boolean; message: string }>>({});
  const [packageSaving, setPackageSaving] = useState<Record<string, boolean>>({});
  const [packageErrors, setPackageErrors] = useState<Record<string, string>>({});
  const gradeRequests = useRef(new Set<number>());
  const packageRequests = useRef(new Set<string>());
  if (!isBoss) return <NoPermission />;

  const saveGrade = async (rule: GradeRule) => {
    if (!isBoss || gradeRequests.current.has(rule.grade)) return;
    const draft = gradeDrafts[rule.grade] ?? String(rule.rate);
    const rate = Number(draft);
    if (!draft.trim() || !Number.isFinite(rate) || rate < 0 || rate > 1) {
      setGradeFeedback((previous) => ({ ...previous, [rule.grade]: { error: true, message: "请输入 0 到 1 之间的数字" } }));
      return;
    }
    if (session && !real) {
      setGradeFeedback((previous) => ({ ...previous, [rule.grade]: { error: true, message: "规则数据未加载，请刷新后重试" } }));
      return;
    }
    gradeRequests.current.add(rule.grade);
    setGradeSaving((previous) => ({ ...previous, [rule.grade]: true }));
    setGradeFeedback((previous) => ({ ...previous, [rule.grade]: { error: false, message: "" } }));
    try {
      const saved = session ? await apiUpdateGradeRate(rule.grade, rate) : { grade: rule.grade, rate };
      setGrades((previous) => previous.map((row) => row.grade === saved.grade ? { ...row, rate: saved.rate } : row));
      setGradeDrafts((previous) => {
        if (previous[rule.grade] !== draft) return previous;
        const next = { ...previous };
        delete next[rule.grade];
        return next;
      });
      setGradeFeedback((previous) => ({ ...previous, [rule.grade]: { error: false, message: session ? "已保存" : "已更新本地演示" } }));
    } catch (error) {
      setGradeFeedback((previous) => ({ ...previous, [rule.grade]: { error: true, message: "保存失败：" + (error instanceof Error ? error.message : "请稍后重试") } }));
    } finally {
      gradeRequests.current.delete(rule.grade);
      setGradeSaving((previous) => ({ ...previous, [rule.grade]: false }));
    }
  };

  const togglePkg = async (id: string) => {
    if (!isBoss || packageRequests.current.has(id)) return;
    const current = packages.find((row) => row.id === id);
    if (!current) return;
    if (session && !packagesReal) {
      setPackageErrors((previous) => ({ ...previous, [id]: "套餐数据未加载，请刷新后重试" }));
      return;
    }
    const status: RechargePackage["status"] = current.status === "enabled" ? "disabled" : "enabled";
    packageRequests.current.add(id);
    setPackageSaving((previous) => ({ ...previous, [id]: true }));
    setPackageErrors((previous) => ({ ...previous, [id]: "" }));
    try {
      const saved = session ? await apiUpdateRechargePackageStatus(id, status) : { id, status };
      setPackages((previous) => previous.map((row) => row.id === saved.id ? { ...row, status: saved.status } : row));
    } catch (error) {
      setPackageErrors((previous) => ({ ...previous, [id]: "保存失败：" + (error instanceof Error ? error.message : "请稍后重试") }));
    } finally {
      packageRequests.current.delete(id);
      setPackageSaving((previous) => ({ ...previous, [id]: false }));
    }
  };

  // 添加等级：乐观插入 → 真实会话写库 → 失败回滚并提示，成功用 data.id 替换乐观项
  const addGrade = async () => {
    const optimisticId = "tmp-" + Date.now();
    const optimistic: GradeRule = { id: optimisticId, grade: newGrade.grade, rate: newGrade.rate };
    setGrades((p) => [...p, optimistic]);
    setNewGrade({ grade: 4, rate: 0.12 });

    if (session) {
      const { data, error } = await supabase
        .from("grade_commission_rule")
        .insert([{ grade: optimistic.grade, rate: optimistic.rate }])
        .select("id")
        .single();
      if (error || !data) {
        setGrades((prev) => prev.filter((x) => x.id !== optimisticId));
        window.alert("创建失败：" + (error?.message ?? "未知错误"));
        return;
      }
      setGrades((prev) => prev.map((x) => (x.id === optimisticId ? { ...x, id: data.id } : x)));
    }
  };

  // 添加 VIP 折扣规则：乐观插入 → 真实会话写库 → 失败回滚并提示，成功用 data.id 替换乐观项
  const addVip = async () => {
    const optimisticId = "tmp-" + Date.now();
    const optimistic: VipDiscountRule = { id: optimisticId, vipLevel: newVip.vipLevel, category: newVip.category, discount: newVip.discount };
    setVipDiscounts((p) => [...p, optimistic]);
    setNewVip({ vipLevel: 2, category: "正常单", discount: 0.92 });

    if (session) {
      const { data, error } = await supabase
        .from("vip_discount_rule")
        .insert([{ vip_level: optimistic.vipLevel, category: optimistic.category, discount: optimistic.discount }])
        .select("id")
        .single();
      if (error || !data) {
        setVipDiscounts((prev) => prev.filter((x) => x.id !== optimisticId));
        window.alert("创建失败：" + (error?.message ?? "未知错误"));
        return;
      }
      setVipDiscounts((prev) => prev.map((x) => (x.id === optimisticId ? { ...x, id: data.id } : x)));
    }
  };

  // 添加升级门槛：乐观插入 → 真实会话写库 → 失败回滚并提示，成功用 data.id 替换乐观项
  const addUpgrade = async () => {
    const optimisticId = "tmp-" + Date.now();
    const optimistic: VipUpgradeRule = { id: optimisticId, vipLevel: newUpgrade.vipLevel, threshold: newUpgrade.threshold };
    setUpgrades((p) => [...p, optimistic]);
    setNewUpgrade({ vipLevel: 4, threshold: 100000 });

    if (session) {
      const { data, error } = await supabase
        .from("vip_upgrade_rule")
        .insert([{ vip_level: optimistic.vipLevel, consumption_threshold: optimistic.threshold }])
        .select("id")
        .single();
      if (error || !data) {
        setUpgrades((prev) => prev.filter((x) => x.id !== optimisticId));
        window.alert("创建失败：" + (error?.message ?? "未知错误"));
        return;
      }
      setUpgrades((prev) => prev.map((x) => (x.id === optimisticId ? { ...x, id: data.id } : x)));
    }
  };

  // 添加充值套餐：乐观插入 → 真实会话写库 → 失败回滚并提示，成功用 data.id 替换乐观项
  const addPkg = async () => {
    const optimisticId = "tmp-" + Date.now();
    const optimistic: RechargePackage = { id: optimisticId, amount: newPkg.amount, bonus: newPkg.bonus, status: "enabled" };
    setPackages((p) => [...p, optimistic]);
    setNewPkg({ amount: 3000, bonus: 500 });

    if (session) {
      const { data, error } = await supabase
        .from("recharge_package")
        .insert([{ amount: optimistic.amount, bonus: optimistic.bonus, status: optimistic.status }])
        .select("id")
        .single();
      if (error || !data) {
        setPackages((prev) => prev.filter((x) => x.id !== optimisticId));
        window.alert("创建失败：" + (error?.message ?? "未知错误"));
        return;
      }
      setPackages((prev) => prev.map((x) => (x.id === optimisticId ? { ...x, id: data.id } : x)));
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="规则配置" meta={`/rules · ${real ? "真实数据" : "Mock"} · 仅老板可修改`} />

      <Panel title="等级提成规则" meta="grade_commission_rule">
        <div className="space-y-4">
          <DataTable<GradeRule>
            rowKey={(r) => String(r.grade)}
            columns={[
              { key: "grade", label: "等级", align: "right", mono: true, render: (r) => `Lv${r.grade}` },
              {
                key: "rate", label: "提成比例", align: "right",
                render: (r) => (
                  <div className="space-y-1">
                    <div className="flex items-center justify-end gap-2">
                      <input
                        type="number" step="0.01" min="0" max="1"
                        aria-label={`Lv${r.grade} 提成比例`}
                        value={gradeDrafts[r.grade] ?? String(r.rate)}
                        disabled={gradeSaving[r.grade]}
                        onChange={(e) => {
                          if (gradeRequests.current.has(r.grade)) return;
                          const value = e.target.value;
                          setGradeDrafts((previous) => ({ ...previous, [r.grade]: value }));
                          setGradeFeedback((previous) => ({ ...previous, [r.grade]: { error: false, message: "" } }));
                        }}
                        className="w-20 rounded-md border border-line bg-paper px-2 py-1 text-right font-mono text-xs outline-none focus:border-ink"
                      />
                      <Button size="sm" variant="secondary" disabled={gradeSaving[r.grade] || (gradeDrafts[r.grade] ?? String(r.rate)) === String(r.rate)} onClick={() => saveGrade(r)}>
                        {gradeSaving[r.grade] ? "保存中…" : "保存"}
                      </Button>
                    </div>
                    {gradeFeedback[r.grade]?.message && <p role={gradeFeedback[r.grade].error ? "alert" : "status"} className={`text-[11px] ${gradeFeedback[r.grade].error ? "text-danger" : "text-muted"}`}>{gradeFeedback[r.grade].message}</p>}
                  </div>
                ),
              },
            ]}
            rows={grades}
          />
          <div className="flex items-end gap-2">
            <label className="space-y-1"><span className="font-mono text-[10px] text-muted">等级</span><Input type="number" value={newGrade.grade} onChange={(e) => setNewGrade({ ...newGrade, grade: Number(e.target.value) })} /></label>
            <label className="space-y-1"><span className="font-mono text-[10px] text-muted">比例</span><Input type="number" step="0.01" value={newGrade.rate} onChange={(e) => setNewGrade({ ...newGrade, rate: Number(e.target.value) })} /></label>
            <Button size="sm" variant="secondary" onClick={addGrade}>添加等级</Button>
          </div>
        </div>
      </Panel>

      <Panel title="VIP 折扣规则" meta="vip_discount_rule · 等级 × 分类">
        <div className="space-y-4">
          <DataTable<VipDiscountRule>
            rowKey={(r) => r.id}
            columns={[
              { key: "vip", label: "VIP 等级", align: "right", mono: true, render: (r) => `VIP${r.vipLevel}` },
              { key: "category", label: "分类", mono: true, render: (r) => r.category },
              { key: "discount", label: "折扣", align: "right", mono: true, render: (r) => pct(r.discount) },
            ]}
            rows={vipDiscounts}
          />
          <div className="flex items-end gap-2">
            <label className="space-y-1"><span className="font-mono text-[10px] text-muted">等级</span><Input type="number" value={newVip.vipLevel} onChange={(e) => setNewVip({ ...newVip, vipLevel: Number(e.target.value) })} /></label>
            <label className="space-y-1"><span className="font-mono text-[10px] text-muted">分类</span><Input value={newVip.category} onChange={(e) => setNewVip({ ...newVip, category: e.target.value })} /></label>
            <label className="space-y-1"><span className="font-mono text-[10px] text-muted">折扣</span><Input type="number" step="0.01" value={newVip.discount} onChange={(e) => setNewVip({ ...newVip, discount: Number(e.target.value) })} /></label>
            <Button size="sm" variant="secondary" onClick={addVip}>添加规则</Button>
          </div>
        </div>
      </Panel>

      <Panel title="VIP 升级门槛" meta="vip_upgrade_rule · 累计消费">
        <DataTable<VipUpgradeRule>
          rowKey={(r) => String(r.vipLevel)}
          columns={[
            { key: "vip", label: "VIP 等级", align: "right", mono: true, render: (r) => `VIP${r.vipLevel}` },
            { key: "threshold", label: "累计消费门槛", align: "right", mono: true, render: (r) => money(r.threshold) },
          ]}
          rows={upgrades}
        />
        <div className="mt-4 flex items-end gap-2">
          <label className="space-y-1"><span className="font-mono text-[10px] text-muted">等级</span><Input type="number" value={newUpgrade.vipLevel} onChange={(e) => setNewUpgrade({ ...newUpgrade, vipLevel: Number(e.target.value) })} /></label>
          <label className="space-y-1"><span className="font-mono text-[10px] text-muted">门槛</span><Input type="number" value={newUpgrade.threshold} onChange={(e) => setNewUpgrade({ ...newUpgrade, threshold: Number(e.target.value) })} /></label>
          <Button size="sm" variant="secondary" onClick={addUpgrade}>添加门槛</Button>
        </div>
      </Panel>

      <Panel title="充值套餐" meta="recharge_package">
        <DataTable<RechargePackage>
          rowKey={(r) => r.id}
          columns={[
            { key: "amount", label: "金额", align: "right", mono: true, render: (r) => money(r.amount) },
            { key: "bonus", label: "赠送", align: "right", mono: true, render: (r) => money(r.bonus) },
            { key: "status", label: "状态", render: (r) => (r.status === "enabled" ? <StatusDot tone="active" label="启用" /> : <StatusDot tone="neutral" label="停用" />) },
            { key: "actions", label: "操作", render: (r) => (
              <div className="space-y-1">
                <Button size="sm" variant="secondary" disabled={packageSaving[r.id]} onClick={() => togglePkg(r.id)}>{packageSaving[r.id] ? "保存中…" : r.status === "enabled" ? "停用" : "启用"}</Button>
                {packageErrors[r.id] && <p role="alert" className="text-[11px] text-danger">{packageErrors[r.id]}</p>}
              </div>
            ) },
          ]}
          rows={packages}
        />
        <div className="mt-4 flex items-end gap-2">
          <label className="space-y-1"><span className="font-mono text-[10px] text-muted">金额</span><Input type="number" value={newPkg.amount} onChange={(e) => setNewPkg({ ...newPkg, amount: Number(e.target.value) })} /></label>
          <label className="space-y-1"><span className="font-mono text-[10px] text-muted">赠送</span><Input type="number" value={newPkg.bonus} onChange={(e) => setNewPkg({ ...newPkg, bonus: Number(e.target.value) })} /></label>
          <Button size="sm" variant="secondary" onClick={addPkg}>添加套餐</Button>
        </div>
      </Panel>
    </div>
  );
}
