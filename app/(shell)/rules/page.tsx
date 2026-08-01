"use client";

import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { DataTable } from "@/components/ui/DataTable";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { StatusDot } from "@/components/ui/StatusDot";
import { GRADE_RULES, VIP_DISCOUNT_RULES, VIP_UPGRADE_RULES, RECHARGE_PACKAGES, type GradeRule, type VipDiscountRule, type VipUpgradeRule, type RechargePackage } from "@/lib/mock-data";
import { apiGradeRules, apiVipDiscountRules, apiVipUpgradeRules, apiRechargePackages } from "@/lib/supabase-api";
import { useResource } from "@/lib/data-store";
import { useAuth } from "@/lib/auth";
import { NoPermission } from "@/components/business/RequireRole";

const money = (n: number) => "¥" + n.toLocaleString("zh-CN", { minimumFractionDigits: 2 });
const pct = (n: number) => (n * 100).toFixed(0) + "%";

export default function RulesPage() {
  const { data: grades, mutate: setGrades } = useResource<GradeRule>("gradeRules", apiGradeRules, GRADE_RULES);
  const { data: vipDiscounts, mutate: setVipDiscounts } = useResource<VipDiscountRule>("vipDiscounts", apiVipDiscountRules, VIP_DISCOUNT_RULES);
  const { data: upgrades, mutate: setUpgrades } = useResource<VipUpgradeRule>("vipUpgrades", apiVipUpgradeRules, VIP_UPGRADE_RULES);
  const { data: packages, mutate: setPackages } = useResource<RechargePackage>("rechargePackages", apiRechargePackages, RECHARGE_PACKAGES);

  const [newGrade, setNewGrade] = useState({ grade: 4, rate: 0.12 });
  const [newVip, setNewVip] = useState({ vipLevel: 2, category: "正常单", discount: 0.92 });
  const [newUpgrade, setNewUpgrade] = useState({ vipLevel: 4, threshold: 100000 });
  const [newPkg, setNewPkg] = useState({ amount: 3000, bonus: 500 });
  const { isBoss } = useAuth();
  if (!isBoss) return <NoPermission />;

  const updateGrade = (grade: number, rate: number) =>
    setGrades((p) => p.map((g) => (g.grade === grade ? { ...g, rate } : g)));

  const togglePkg = (id: string) =>
    setPackages((p) => p.map((x) => (x.id === id ? { ...x, status: x.status === "enabled" ? "disabled" : "enabled" } : x)));

  return (
    <div className="space-y-6">
      <PageHeader title="规则配置" meta="/rules · Mock · 仅老板可修改" />

      <Panel title="等级提成规则" meta="grade_commission_rule">
        <div className="space-y-4">
          <DataTable<GradeRule>
            rowKey={(r) => String(r.grade)}
            columns={[
              { key: "grade", label: "等级", align: "right", mono: true, render: (r) => `Lv${r.grade}` },
              {
                key: "rate", label: "提成比例", align: "right",
                render: (r) => (
                  <input
                    type="number" step="0.01" min="0" max="1"
                    value={r.rate}
                    onChange={(e) => updateGrade(r.grade, Math.min(1, Math.max(0, Number(e.target.value))))}
                    className="w-20 rounded-md border border-line bg-paper px-2 py-1 text-right font-mono text-xs outline-none focus:border-ink"
                  />
                ),
              },
            ]}
            rows={grades}
          />
          <div className="flex items-end gap-2">
            <label className="space-y-1"><span className="font-mono text-[10px] text-muted">等级</span><Input type="number" value={newGrade.grade} onChange={(e) => setNewGrade({ ...newGrade, grade: Number(e.target.value) })} /></label>
            <label className="space-y-1"><span className="font-mono text-[10px] text-muted">比例</span><Input type="number" step="0.01" value={newGrade.rate} onChange={(e) => setNewGrade({ ...newGrade, rate: Number(e.target.value) })} /></label>
            <Button size="sm" variant="secondary" onClick={() => { setGrades((p) => [...p, { grade: newGrade.grade, rate: newGrade.rate }]); }}>添加等级</Button>
          </div>
        </div>
      </Panel>

      <Panel title="VIP 折扣规则" meta="vip_discount_rule · 等级 × 分类">
        <div className="space-y-4">
          <DataTable<VipDiscountRule>
            rowKey={(r) => r.id}
            columns={[
              { key: "vip", label: "VIP 等级", align: "right", mono: true, render: (r) => `VIP${r.vipLevel}` },
              { key: "cat", label: "分类", mono: true },
              { key: "discount", label: "折扣", align: "right", mono: true, render: (r) => pct(r.discount) },
            ]}
            rows={vipDiscounts}
          />
          <div className="flex items-end gap-2">
            <label className="space-y-1"><span className="font-mono text-[10px] text-muted">等级</span><Input type="number" value={newVip.vipLevel} onChange={(e) => setNewVip({ ...newVip, vipLevel: Number(e.target.value) })} /></label>
            <label className="space-y-1"><span className="font-mono text-[10px] text-muted">分类</span><Input value={newVip.category} onChange={(e) => setNewVip({ ...newVip, category: e.target.value })} /></label>
            <label className="space-y-1"><span className="font-mono text-[10px] text-muted">折扣</span><Input type="number" step="0.01" value={newVip.discount} onChange={(e) => setNewVip({ ...newVip, discount: Number(e.target.value) })} /></label>
            <Button size="sm" variant="secondary" onClick={() => { setVipDiscounts((p) => [...p, { id: "vd" + Date.now(), ...newVip }]); }}>添加规则</Button>
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
          <Button size="sm" variant="secondary" onClick={() => { setUpgrades((p) => [...p, newUpgrade]); }}>添加门槛</Button>
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
              <Button size="sm" variant="secondary" onClick={() => togglePkg(r.id)}>{r.status === "enabled" ? "停用" : "启用"}</Button>
            ) },
          ]}
          rows={packages}
        />
        <div className="mt-4 flex items-end gap-2">
          <label className="space-y-1"><span className="font-mono text-[10px] text-muted">金额</span><Input type="number" value={newPkg.amount} onChange={(e) => setNewPkg({ ...newPkg, amount: Number(e.target.value) })} /></label>
          <label className="space-y-1"><span className="font-mono text-[10px] text-muted">赠送</span><Input type="number" value={newPkg.bonus} onChange={(e) => setNewPkg({ ...newPkg, bonus: Number(e.target.value) })} /></label>
          <Button size="sm" variant="secondary" onClick={() => { setPackages((p) => [...p, { id: "rp" + Date.now(), ...newPkg, status: "enabled" }]); }}>添加套餐</Button>
        </div>
      </Panel>
    </div>
  );
}