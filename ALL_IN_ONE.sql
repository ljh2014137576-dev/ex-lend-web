-- ============================================================================
-- Ex-Lend Supabase 一键初始化 SQL（重建版 v3 - 已去重）
-- 由恢复文件合并生成：01_schema + 02_rpcs(恢复) + 03_seed(恢复) + 04_employee_ext(恢复) + 07~31
-- ============================================================================

-- BEGIN SOURCE: 01_schema.sql
-- ============================================================================
-- ============================================================================
-- Ex-Lend 员工提成与客户账户管理系统 - Supabase 建库脚本
-- 使用方法：Supabase Dashboard → SQL Editor → 粘贴本脚本 → Run
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. 扩展与枚举类型
-- ----------------------------------------------------------------------------
create extension if not exists "pgcrypto";

do $$ begin
  create type user_role as enum ('boss', 'manager');
exception when duplicate_object then null; end $$;

do $$ begin
  create type user_status as enum ('active', 'disabled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type employee_status as enum ('active', 'resigned');
exception when duplicate_object then null; end $$;

do $$ begin
  create type product_status as enum ('on_sale', 'off_shelf');
exception when duplicate_object then null; end $$;

do $$ begin
  create type commission_type as enum ('fixed', 'grade');
exception when duplicate_object then null; end $$;

do $$ begin
  create type customer_type as enum ('normal', 'vip');
exception when duplicate_object then null; end $$;

do $$ begin
  create type customer_status as enum ('active', 'blocked');
exception when duplicate_object then null; end $$;

do $$ begin
  create type package_status as enum ('enabled', 'disabled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type order_status as enum ('booking', 'in_progress', 'completed', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type audit_status as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type pay_method as enum ('wallet', 'cash');
exception when duplicate_object then null; end $$;

do $$ begin
  create type wallet_ledger_type as enum ('commission', 'payout', 'refund_deduct', 'adjust');
exception when duplicate_object then null; end $$;

do $$ begin
  create type customer_ledger_type as enum ('recharge_principal', 'recharge_bonus', 'consume_principal', 'consume_bonus', 'consume_from_pending', 'refund', 'adjust', 'cash_received', 'cash_refund');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payout_status as enum ('processing', 'completed');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- 1. 基础规则表（无外键依赖）
-- ----------------------------------------------------------------------------

-- 1.1 系统用户（老板/管理岗）
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  password_hash text not null,
  name text not null,
  role user_role not null default 'manager',
  status user_status not null default 'active',
  created_at timestamptz not null default now()
);

-- 1.2 等级提成规则（全局一份）
create table if not exists grade_commission_rule (
  id uuid primary key default gen_random_uuid(),
  grade int not null unique,
  rate numeric(6,4) not null check (rate >= 0 and rate <= 1),
  created_at timestamptz not null default now()
);

-- 1.3 VIP 折扣规则（全局，等级×类别二维）
create table if not exists vip_discount_rule (
  id uuid primary key default gen_random_uuid(),
  vip_level int not null,
  category text not null,
  discount numeric(4,2) not null check (discount > 0 and discount <= 1),
  unique (vip_level, category),
  created_at timestamptz not null default now()
);

-- 1.4 VIP 升级规则（全局）
create table if not exists vip_upgrade_rule (
  id uuid primary key default gen_random_uuid(),
  vip_level int not null unique,
  consumption_threshold numeric(12,2) not null check (consumption_threshold >= 0),
  created_at timestamptz not null default now()
);

-- 1.5 充值套餐
create table if not exists recharge_package (
  id uuid primary key default gen_random_uuid(),
  amount numeric(12,2) not null check (amount > 0),
  bonus numeric(12,2) not null default 0 check (bonus >= 0),
  status package_status not null default 'enabled',
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 2. 主体表
-- ----------------------------------------------------------------------------

-- 2.1 员工档案 + 钱包
create table if not exists employee (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  id_card text,
  hire_date date,
  bank_card text,
  grade int not null default 1 check (grade >= 1),
  status employee_status not null default 'active',
  wallet_balance numeric(12,2) not null default 0,
  is_debt boolean not null default false,
  is_bad_debt boolean not null default false,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2.2 产品
create table if not exists product (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  name text not null,
  description text,
  price numeric(12,2) not null check (price >= 0),
  image_url text,
  commission_type commission_type not null default 'fixed',
  fixed_rate numeric(6,4) check (fixed_rate is null or (fixed_rate >= 0 and fixed_rate <= 1)),
  status product_status not null default 'on_sale',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2.3 客户 + 双负债 + 预收
create table if not exists customer (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  type customer_type not null default 'normal',
  vip_level int not null default 0,
  principal_balance numeric(12,2) not null default 0,
  bonus_balance numeric(12,2) not null default 0,
  pending_balance numeric(12,2) not null default 0,
  overdraft_limit numeric(12,2) not null default 0,
  total_consumption numeric(12,2) not null default 0,
  status customer_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 3. 流水表
-- ----------------------------------------------------------------------------

-- 3.1 员工钱包流水
create table if not exists wallet_ledger (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employee(id) on delete restrict,
  type wallet_ledger_type not null,
  amount numeric(12,2) not null,
  balance_after numeric(12,2) not null,
  order_id uuid,
  payout_id uuid,
  operator_id uuid references users(id),
  remark text,
  created_at timestamptz not null default now()
);
create index if not exists idx_wallet_ledger_employee on wallet_ledger(employee_id);
create index if not exists idx_wallet_ledger_order on wallet_ledger(order_id);
create index if not exists idx_wallet_ledger_payout on wallet_ledger(payout_id);
create index if not exists idx_wallet_ledger_created on wallet_ledger(created_at);

-- 3.2 客户钱包流水
create table if not exists customer_wallet_ledger (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customer(id) on delete restrict,
  type customer_ledger_type not null,
  amount numeric(12,2) not null,
  principal_after numeric(12,2) not null,
  bonus_after numeric(12,2) not null,
  order_id uuid,
  operator_id uuid references users(id),
  remark text,
  created_at timestamptz not null default now()
);
create index if not exists idx_cwledger_customer on customer_wallet_ledger(customer_id);
create index if not exists idx_cwledger_order on customer_wallet_ledger(order_id);
create index if not exists idx_cwledger_created on customer_wallet_ledger(created_at);

-- ----------------------------------------------------------------------------
-- 4. 订单与发放表
-- ----------------------------------------------------------------------------

-- 4.1 订单
create table if not exists "order" (
  id uuid primary key default gen_random_uuid(),
  order_no text unique not null,
  customer_id uuid references customer(id) on delete restrict,
  product_id uuid references product(id) on delete restrict,
  customer_type_snapshot customer_type,
  vip_level_snapshot int,
  pay_method pay_method not null default 'cash',
  original_amount numeric(12,2) not null check (original_amount >= 0),
  paid_amount numeric(12,2) not null check (paid_amount >= 0),
  discount_amount numeric(12,2) not null default 0 check (discount_amount >= 0),
  pending_amount numeric(12,2) not null default 0,
  total_commission numeric(12,2) not null default 0,
  gross_profit numeric(12,2) not null default 0,
  status order_status not null default 'booking',
  audit_status audit_status not null default 'pending',
  auditor_id uuid references users(id),
  audited_at timestamptz,
  operator_id uuid references users(id),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_order_customer on "order"(customer_id);
create index if not exists idx_order_status on "order"(status);
create index if not exists idx_order_audit on "order"(audit_status);
create index if not exists idx_order_created on "order"(created_at);

-- 补流水表的外键（order 表建好后）
alter table wallet_ledger add constraint fk_wallet_ledger_order
  foreign key (order_id) references "order"(id) on delete set null;
alter table customer_wallet_ledger add constraint fk_cwledger_order
  foreign key (order_id) references "order"(id) on delete set null;

-- 4.2 订单参与员工（含快照）
create table if not exists order_member (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references "order"(id) on delete cascade,
  employee_id uuid not null references employee(id) on delete restrict,
  grade_snapshot int,
  base_amount numeric(12,2),
  applied_rate numeric(6,4),
  commission_amount numeric(12,2) not null default 0,
  commission_type_snapshot commission_type,
  created_at timestamptz not null default now(),
  unique (order_id, employee_id)
);
create index if not exists idx_order_member_order on order_member(order_id);
create index if not exists idx_order_member_employee on order_member(employee_id);

-- 4.3 发放批次
create table if not exists payout (
  id uuid primary key default gen_random_uuid(),
  batch_no text not null,
  operator_id uuid references users(id),
  total_amount numeric(12,2) not null default 0,
  detail_count int not null default 0,
  status payout_status not null default 'processing',
  proof_path text,
  created_at timestamptz not null default now()
));
create index if not exists idx_payout_operator on payout(operator_id);

-- 补员工流水的外键（payout 表建好后）
alter table wallet_ledger add constraint fk_wallet_ledger_payout
  foreign key (payout_id) references payout(id) on delete set null;

-- 4.4 发放明细
create table if not exists payout_detail (
  id uuid primary key default gen_random_uuid(),
  payout_id uuid not null references payout(id) on delete cascade,
  employee_id uuid not null references employee(id) on delete restrict,
  amount numeric(12,2) not null check (amount >= 0),
  balance_before numeric(12,2) not null,
  balance_after numeric(12,2) not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_payout_detail_payout on payout_detail(payout_id);
create index if not exists idx_payout_detail_employee on payout_detail(employee_id);

-- ----------------------------------------------------------------------------
-- 5. updated_at 自动更新触发器
-- ----------------------------------------------------------------------------
create or replace function trigger_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

do $$ begin
  create trigger set_updated_at_employee before update on employee
    for each row execute function trigger_set_updated_at();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger set_updated_at_product before update on product
    for each row execute function trigger_set_updated_at();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger set_updated_at_customer before update on customer
    for each row execute function trigger_set_updated_at();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger set_updated_at_order before update on "order"
    for each row execute function trigger_set_updated_at();
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- 6. 行级安全（RLS）- 老板/管理岗权限
-- ----------------------------------------------------------------------------
-- 策略：通过 custom claim 里的 role 判断（Supabase Auth + custom claims）
-- boss: 全部读写；manager: 受限读写

alter table users enable row level security;
alter table employee enable row level security;
alter table product enable row level security;
alter table customer enable row level security;
alter table wallet_ledger enable row level security;
alter table customer_wallet_ledger enable row level security;
alter table "order" enable row level security;
alter table order_member enable row level security;
alter table payout enable row level security;
alter table payout_detail enable row level security;
alter table grade_commission_rule enable row level security;
alter table vip_discount_rule enable row level security;
alter table vip_upgrade_rule enable row level security;
alter table recharge_package enable row level security;

-- 角色判断函数：从 JWT claim 读 role
create or replace function is_boss()
returns boolean as $$
  select coalesce((auth.jwt() -> 'user_role' ->> 'role') = 'boss', false);
$$ language sql stable;

create or replace function is_manager()
returns boolean as $$
  select coalesce((auth.jwt() -> 'user_role' ->> 'role') = 'manager', false);
$$ language sql stable;

create or replace function is_staff()
returns boolean as $$
  select is_boss() or is_manager();
$$ language sql stable;

-- 基础规则表：老板读写，管理岗只读
create policy "rule_read_staff" on grade_commission_rule for select to authenticated using (is_staff());
create policy "rule_write_boss" on grade_commission_rule for all to authenticated using (is_boss()) with check (is_boss());
create policy "vipdiscount_read_staff" on vip_discount_rule for select to authenticated using (is_staff());
create policy "vipdiscount_write_boss" on vip_discount_rule for all to authenticated using (is_boss()) with check (is_boss());
create policy "vipupgrade_read_staff" on vip_upgrade_rule for select to authenticated using (is_staff());
create policy "vipupgrade_write_boss" on vip_upgrade_rule for all to authenticated using (is_boss()) with check (is_boss());
create policy "pkg_read_staff" on recharge_package for select to authenticated using (is_staff());
create policy "pkg_write_boss" on recharge_package for all to authenticated using (is_boss()) with check (is_boss());

-- 用户表：老板全部，管理岗只能看自己
create policy "user_read_boss_all" on users for select to authenticated using (is_boss());
create policy "user_read_self" on users for select to authenticated using (id = auth.uid());
create policy "user_write_boss" on users for all to authenticated using (is_boss()) with check (is_boss());

-- 员工/产品/客户/订单/订单明细：全员可读，老板可写，管理岗可写（受 RPC 限制约束敏感操作）
create policy "emp_read_staff" on employee for select to authenticated using (is_staff());
create policy "emp_write_staff" on employee for all to authenticated using (is_staff()) with check (is_staff());

create policy "prod_read_staff" on product for select to authenticated using (is_staff());
create policy "prod_write_staff" on product for all to authenticated using (is_staff()) with check (is_staff());

create policy "cust_read_staff" on customer for select to authenticated using (is_staff());
create policy "cust_write_staff" on customer for all to authenticated using (is_staff()) with check (is_staff());

create policy "order_read_staff" on "order" for select to authenticated using (is_staff());
create policy "order_write_staff" on "order" for all to authenticated using (is_staff()) with check (is_staff());

create policy "om_read_staff" on order_member for select to authenticated using (is_staff());
create policy "om_write_staff" on order_member for all to authenticated using (is_staff()) with check (is_staff());

-- 员工钱包流水：老板读写，管理岗只读
create policy "wledger_read_staff" on wallet_ledger for select to authenticated using (is_staff());
create policy "wledger_write_rpc" on wallet_ledger for all to authenticated using (is_boss() or (is_manager() and false = true)) with check (is_staff());

-- 客户钱包流水：全员读写（充值/退款由管理岗通过 RPC 触发）
create policy "cwledger_read_staff" on customer_wallet_ledger for select to authenticated using (is_staff());
create policy "cwledger_write_staff" on customer_wallet_ledger for all to authenticated using (is_staff()) with check (is_staff());

-- 发放批次/明细：仅老板
create policy "payout_read_boss" on payout for select to authenticated using (is_boss());
create policy "payout_write_boss" on payout for all to authenticated using (is_boss()) with check (is_boss());
create policy "pdetail_read_boss" on payout_detail for select to authenticated using (is_boss());
create policy "pdetail_write_boss" on payout_detail for all to authenticated using (is_boss()) with check (is_boss());

-- ============================================================================
-- 建库完成。
-- 下一步：运行 02_rpcs.sql 创建 5 个事务函数
-- ============================================================================
-- ============================================================================
-- END SOURCE: 01_schema.sql

-- ============ SOURCE: 02_rpcs.sql ============
-- ============================================================================
-- Ex-Lend RPC 事务函数（从线上数据库逆向导回，恢复 02_rpcs.sql）
-- 生成来源：线上 Supabase（gmfylevxrrdweuwzbumt）pg_get_functiondef 导出
-- 说明：函数为线上库当前生效版本；approve_commission / create_order_multi
--       等已由后续迁移重定义者不在此文件重复。
-- ============================================================================

CREATE OR REPLACE FUNCTION public.gen_order_no()
 RETURNS text
 LANGUAGE sql
AS $function$
  select 'ORD' || to_char(now(), 'YYYYMMDDHH24MISS') || lpad((extract(epoch from now())::bigint % 1000)::text, 3, '0');
$function$


CREATE OR REPLACE FUNCTION public.create_order(p_customer_id uuid, p_product_id uuid, p_employee_ids uuid[], p_pay_method pay_method, p_paid_amount numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_prod product%rowtype;
  v_cust customer%rowtype;
  v_order_id uuid;
  v_order_no text;
  v_original numeric(12,2);
  v_paid numeric(12,2);
  v_discount numeric(12,2) := 0;
  v_disc_rule vip_discount_rule%rowtype;
begin
  if not is_staff() then
    return jsonb_build_object('success', false, 'message', '无权限');
  end if;

  select * into v_prod from product where id = p_product_id and status = 'on_sale';
  if not found then return jsonb_build_object('success', false, 'message', '产品不存在或已下架'); end if;

  select * into v_cust from customer where id = p_customer_id;
  if not found then return jsonb_build_object('success', false, 'message', '客户不存在'); end if;

  v_original := v_prod.price;

  -- VIP 折扣
  if v_cust.type = 'vip' then
    select * into v_disc_rule from vip_discount_rule where vip_level = v_cust.vip_level and category = v_prod.category limit 1;
    if found then
      v_paid := v_original * v_disc_rule.discount;
      v_discount := v_original - v_paid;
    else
      v_paid := v_original;
    end if;
  else
    v_paid := coalesce(p_paid_amount, v_original);
  end if;

  v_order_no := gen_order_no();
  insert into "order" (order_no, customer_id, product_id, customer_type_snapshot, vip_level_snapshot, pay_method,
    original_amount, paid_amount, discount_amount, operator_id)
  values (v_order_no, p_customer_id, p_product_id, v_cust.type, v_cust.vip_level, p_pay_method,
    v_original, v_paid, v_discount, auth.uid())
  returning id into v_order_id;

  -- 写参与员工
  insert into order_member (order_id, employee_id)
  select v_order_id, unnest(p_employee_ids)
  on conflict do nothing;

  return jsonb_build_object('success', true, 'order_id', v_order_id, 'order_no', v_order_no, 'paid_amount', v_paid, 'discount', v_discount);
end;
$function$


CREATE OR REPLACE FUNCTION public.create_order(p_customer_id uuid, p_product_id uuid, p_employee_ids uuid[], p_pay_method pay_method, p_paid_amount numeric DEFAULT NULL::numeric, p_quantity integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_prod product%rowtype;
  v_cust customer%rowtype;
  v_order_id uuid;
  v_order_no text;
  v_original numeric(12,2);
  v_paid numeric(12,2);
  v_discount numeric(12,2) := 0;
  v_disc_rule vip_discount_rule%rowtype;
  v_total_liability numeric(12,2);
  v_principal_consume numeric(12,2);
  v_bonus_consume numeric(12,2);
  v_op uuid;
begin
  if not is_staff() then
    return jsonb_build_object('success', false, 'message', '无权限');
  end if;
  v_op := auth.uid();

  select * into v_prod from product where id = p_product_id and status = 'on_sale';
  if not found then return jsonb_build_object('success', false, 'message', '产品不存在或已下架'); end if;

  select * into v_cust from customer where id = p_customer_id;
  if not found then return jsonb_build_object('success', false, 'message', '客户不存在'); end if;

  -- 数量 × 单价
  v_original := v_prod.price * p_quantity;

  -- VIP 折扣
  if v_cust.type = 'vip' then
    select * into v_disc_rule from vip_discount_rule where vip_level = v_cust.vip_level and category = v_prod.category limit 1;
    if found then
      v_paid := v_original * v_disc_rule.discount;
      v_discount := v_original - v_paid;
    else
      v_paid := v_original;
    end if;
  else
    v_paid := coalesce(p_paid_amount, v_original);
  end if;

  v_order_no := gen_order_no();
  insert into "order" (order_no, customer_id, product_id, customer_type_snapshot, vip_level_snapshot, pay_method,
    original_amount, paid_amount, discount_amount, pending_amount, quantity, operator_id)
  values (v_order_no, p_customer_id, p_product_id, v_cust.type, v_cust.vip_level, p_pay_method,
    v_original, v_paid, v_discount, v_paid, p_quantity, v_op)
  returning id into v_order_id;

  -- 写参与员工
  insert into order_member (order_id, employee_id)
  select v_order_id, unnest(p_employee_ids)
  on conflict do nothing;

  -- 质押处理
  if p_pay_method = 'wallet' then
    v_total_liability := v_cust.principal_balance + v_cust.bonus_balance;
    if v_total_liability < v_paid then
      return jsonb_build_object('success', false, 'message', '客户钱包余额不足');
    end if;
    v_principal_consume := v_paid * (v_cust.principal_balance / v_total_liability);
    v_bonus_consume := v_paid * (v_cust.bonus_balance / v_total_liability);

    update customer set
      principal_balance = principal_balance - v_principal_consume,
      bonus_balance = bonus_balance - v_bonus_consume,
      pending_balance = pending_balance + v_paid
    where id = p_customer_id;

    insert into customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, order_id, operator_id, remark)
    values (p_customer_id, 'consume_principal', -v_principal_consume,
      v_cust.principal_balance - v_principal_consume, v_cust.bonus_balance - v_bonus_consume, v_order_id, v_op, '下单质押-本金');
    insert into customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, order_id, operator_id, remark)
    values (p_customer_id, 'consume_bonus', -v_bonus_consume,
      v_cust.principal_balance - v_principal_consume, v_cust.bonus_balance - v_bonus_consume, v_order_id, v_op, '下单质押-赠送');
  else
    update customer set pending_balance = pending_balance + v_paid where id = p_customer_id;
    insert into customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, order_id, operator_id, remark)
    values (p_customer_id, 'cash_received', v_paid, v_cust.principal_balance, v_cust.bonus_balance, v_order_id, v_op, '下单收取现金(预收)');
  end if;

  return jsonb_build_object('success', true, 'order_id', v_order_id, 'order_no', v_order_no, 'paid_amount', v_paid, 'discount', v_discount, 'pending_amount', v_paid);
end;
$function$


CREATE OR REPLACE FUNCTION public.payout_salary(p_items jsonb, p_batch_no text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_payout_id uuid;
  v_total numeric(12,2) := 0;
  v_item jsonb;
  v_emp employee%rowtype;
  v_balance_before numeric(12,2);
  v_balance_after numeric(12,2);
  v_count int := 0;
  v_op uuid;
begin
  if not is_boss() then
    return jsonb_build_object('success', false, 'message', '无权限：仅老板可发放工资');
  end if;
  v_op := auth.uid();

  -- 创建批次
  insert into payout (batch_no, operator_id, status, total_amount, detail_count)
  values (p_batch_no, v_op, 'processing', 0, 0)
  returning id into v_payout_id;

  -- 遍历发放明细
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_count := v_count + 1;
    select * into v_emp from employee where id = (v_item->>'employee_id')::uuid;
    if not found then
      raise exception '员工 % 不存在', v_item->>'employee_id';
    end if;

    v_balance_before := v_emp.wallet_balance;
    v_balance_after := v_balance_before - ((v_item->>'amount')::numeric);

    -- 余额不足校验（非欠款员工）
    if v_emp.is_debt = false and v_balance_after < 0 then
      raise exception '员工 % 余额不足（当前 %，欲发 %）', v_emp.name, v_balance_before, (v_item->>'amount')::numeric;
    end if;

    -- 扣钱包
    update employee set wallet_balance = v_balance_after where id = v_emp.id;

    -- 写员工流水
    insert into wallet_ledger (employee_id, type, amount, balance_after, payout_id, operator_id, remark)
    values (v_emp.id, 'payout', -((v_item->>'amount')::numeric), v_balance_after, v_payout_id, v_op, '工资发放 ' || p_batch_no);

    -- 写发放明细
    insert into payout_detail (payout_id, employee_id, amount, balance_before, balance_after)
    values (v_payout_id, v_emp.id, (v_item->>'amount')::numeric, v_balance_before, v_balance_after);

    v_total := v_total + ((v_item->>'amount')::numeric);
  end loop;

  -- 更新批次汇总
  update payout set total_amount = v_total, detail_count = v_count, status = 'completed'
  where id = v_payout_id;

  return jsonb_build_object('success', true, 'batch_id', v_payout_id, 'total_amount', v_total, 'detail_count', v_count);
end;
$function$


CREATE OR REPLACE FUNCTION public.recalculate_customer_vip(p_customer_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_customer customer%rowtype;
  v_level int;
begin
  if not is_boss() then
    return jsonb_build_object('success', false, 'message', '无权限：仅老板可以重算 VIP 等级');
  end if;

  select * into v_customer from customer where id = p_customer_id for update;
  if not found then
    return jsonb_build_object('success', false, 'message', '客户不存在');
  end if;

  select coalesce(max(vip_level), 0)
    into v_level
    from vip_upgrade_rule
   where consumption_threshold <= coalesce(v_customer.total_consumption, 0);

  if v_level > coalesce(v_customer.vip_level, 0) then
    update customer set type = 'vip', vip_level = v_level where id = p_customer_id;
  end if;

  return jsonb_build_object('success', true, 'vip_level', greatest(v_level, coalesce(v_customer.vip_level, 0)));
end;
$function$


CREATE OR REPLACE FUNCTION public.batch_create_employees(p_employees jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row jsonb;
  v_count int := 0;
  v_op uuid := auth.uid();
begin
  if not public.is_staff() then
    return jsonb_build_object('success', false, 'message', '无权限');
  end if;
  if jsonb_typeof(p_employees) <> 'array' or jsonb_array_length(p_employees) = 0 then
    return jsonb_build_object('success', false, 'message', '员工数据为空');
  end if;
 
  for v_row in select * from jsonb_array_elements(p_employees)
  loop
    insert into public.employee (
      nickname, name, phone, gender, alipay_account, id_card, bank_card,
      bank_name, deposit, wechat_id, remark, grade, status, bio, created_by
    ) values (
      v_row->>'nickname',
      coalesce(nullif(v_row->>'name', ''), v_row->>'nickname'),
      nullif(v_row->>'phone', ''),
      case v_row->>'gender'
        when 'male' then 'male'::gender
        when 'female' then 'female'::gender
        else 'other'::gender
      end,
      nullif(v_row->>'alipay_account', ''),
      nullif(v_row->>'id_card', ''),
      nullif(v_row->>'bank_card', ''),
      nullif(v_row->>'bank_name', ''),
      coalesce((v_row->>'deposit')::numeric, 0),
      nullif(v_row->>'wechat_id', ''),
      nullif(v_row->>'remark', ''),
      greatest(coalesce((v_row->>'grade')::int, 1), 1),
      coalesce(v_row->>'status', 'active')::employee_status,
      nullif(v_row->>'bio', ''),
      v_op
    );
    v_count := v_count + 1;
  end loop;
 
  return jsonb_build_object('success', true, 'count', v_count);
exception
  when others then
    -- 任何 insert 失败（约束/类型错误）触发回滚，返回错误信息
    raise exception '批量导入失败（已回滚）: %', sqlerrm;
end;
$function$


CREATE OR REPLACE FUNCTION public.recharge_custom(p_customer_id uuid, p_amount numeric, p_bonus numeric, p_remark text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_cust customer%rowtype;
  v_new_principal numeric(12,2);
  v_new_bonus numeric(12,2);
  v_op uuid;
begin
  -- 仅老板可用
  if not is_boss() then
    return jsonb_build_object('success', false, 'message', '无权限：自定义充值仅老板可用');
  end if;

  v_op := auth.uid();

  if p_amount <= 0 then
    return jsonb_build_object('success', false, 'message', '充值金额必须大于0');
  end if;
  if p_bonus < 0 then
    return jsonb_build_object('success', false, 'message', '赠送金额不能为负');
  end if;

  select * into v_cust from customer where id = p_customer_id;
  if not found then
    return jsonb_build_object('success', false, 'message', '客户不存在');
  end if;

  v_new_principal := v_cust.principal_balance + p_amount;
  v_new_bonus := v_cust.bonus_balance + p_bonus;

  update customer set principal_balance = v_new_principal, bonus_balance = v_new_bonus
  where id = p_customer_id;

  insert into customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, operator_id, remark)
  values (p_customer_id, 'recharge_principal', p_amount, v_new_principal, v_cust.bonus_balance, v_op, coalesce(p_remark,'自定义充值-本金'));

  insert into customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, operator_id, remark)
  values (p_customer_id, 'recharge_bonus', p_bonus, v_new_principal, v_new_bonus, v_op, coalesce(p_remark,'自定义充值-赠送'));

  return jsonb_build_object('success', true, 'new_balance', v_new_principal + v_new_bonus);
end;
$function$


CREATE OR REPLACE FUNCTION public.recharge_custom(p_customer_id uuid, p_amount numeric, p_bonus numeric, p_remark text, p_proof_path text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_cust public.customer%rowtype;
  v_new_principal numeric(12,2);
  v_new_bonus numeric(12,2);
  v_op uuid := auth.uid();
begin
  if not public.is_staff() then
    return jsonb_build_object('success', false, 'message', '无权限：仅老板或管理员可自定义充值');
  end if;
  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('success', false, 'message', '充值金额必须大于0');
  end if;
  if p_bonus is null or p_bonus < 0 then
    return jsonb_build_object('success', false, 'message', '赠送金额不能为负');
  end if;

  select * into v_cust from public.customer where id = p_customer_id for update;
  if not found then
    return jsonb_build_object('success', false, 'message', '客户不存在');
  end if;

  v_new_principal := v_cust.principal_balance + p_amount;
  v_new_bonus := v_cust.bonus_balance + p_bonus;
  update public.customer
  set principal_balance = v_new_principal, bonus_balance = v_new_bonus
  where id = p_customer_id;

  insert into public.customer_wallet_ledger (
    customer_id, type, amount, principal_after, bonus_after, operator_id, proof_path, remark
  ) values
    (p_customer_id, 'recharge_principal', p_amount, v_new_principal, v_cust.bonus_balance, v_op, p_proof_path, coalesce(p_remark, '自定义充值本金')),
    (p_customer_id, 'recharge_bonus', p_bonus, v_new_principal, v_new_bonus, v_op, p_proof_path, coalesce(p_remark, '自定义充值赠送'));

  return jsonb_build_object('success', true, 'new_balance', v_new_principal + v_new_bonus);
end;
$function$


CREATE OR REPLACE FUNCTION public.recharge_wallet(p_customer_id uuid, p_package_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_pkg  recharge_package%rowtype;
  v_cust customer%rowtype;
  v_new_principal numeric(12,2);
  v_new_bonus numeric(12,2);
  v_op uuid;
begin
  -- 当前操作人
  v_op := auth.uid();

  -- 查套餐
  select * into v_pkg from recharge_package where id = p_package_id and status = 'enabled';
  if not found then
    return jsonb_build_object('success', false, 'message', '套餐不存在或已停用');
  end if;

  -- 查客户
  select * into v_cust from customer where id = p_customer_id;
  if not found then
    return jsonb_build_object('success', false, 'message', '客户不存在');
  end if;

  -- 算新余额（Decimal 运算，PostgreSQL numeric 原生精确）
  v_new_principal := v_cust.principal_balance + v_pkg.amount;
  v_new_bonus := v_cust.bonus_balance + v_pkg.bonus;

  -- 更新客户余额
  update customer set principal_balance = v_new_principal, bonus_balance = v_new_bonus
  where id = p_customer_id;

  -- 写本金流水
  insert into customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, operator_id, remark)
  values (p_customer_id, 'recharge_principal', v_pkg.amount, v_new_principal, v_cust.bonus_balance, v_op, '套餐充值-本金');

  -- 写赠送流水
  insert into customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, operator_id, remark)
  values (p_customer_id, 'recharge_bonus', v_pkg.bonus, v_new_principal, v_new_bonus, v_op, '套餐充值-赠送');

  return jsonb_build_object('success', true, 'new_balance', v_new_principal + v_new_bonus);
end;
$function$


CREATE OR REPLACE FUNCTION public.recharge_wallet(p_customer_id uuid, p_package_id uuid, p_proof_path text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_pkg recharge_package%rowtype;
  v_cust customer%rowtype;
  v_new_principal numeric(12,2);
  v_new_bonus numeric(12,2);
  v_op uuid := auth.uid();
begin
  select * into v_pkg from recharge_package where id = p_package_id and status = 'enabled';
  if not found then return jsonb_build_object('success', false, 'message', '充值套餐不存在或已停用'); end if;
  select * into v_cust from customer where id = p_customer_id;
  if not found then return jsonb_build_object('success', false, 'message', '客户不存在'); end if;
  v_new_principal := v_cust.principal_balance + v_pkg.amount;
  v_new_bonus := v_cust.bonus_balance + v_pkg.bonus;
  update customer set principal_balance = v_new_principal, bonus_balance = v_new_bonus where id = p_customer_id;
  insert into customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, operator_id, proof_path, remark)
    values (p_customer_id, 'recharge_principal', v_pkg.amount, v_new_principal, v_cust.bonus_balance, v_op, p_proof_path, '套餐充值本金');
  insert into customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, operator_id, proof_path, remark)
    values (p_customer_id, 'recharge_bonus', v_pkg.bonus, v_new_principal, v_new_bonus, v_op, p_proof_path, '套餐充值赠送');
  return jsonb_build_object('success', true, 'new_balance', v_new_principal + v_new_bonus);
end;
$function$


CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_user_id uuid;
  v_role text;
  v_claims jsonb;
begin
  v_user_id := (event->>'user_id')::uuid;
  select role::text into v_role from users where id = v_user_id;

  v_claims := event->'claims';
  if v_role is not null then
    v_claims := v_claims || jsonb_build_object('user_role', jsonb_build_object('role', v_role));
  end if;

  return jsonb_build_object('claims', v_claims);
end;
$function$



-- ============ SOURCE: 03_seed_data.sql ============
-- ============================================================================
-- Ex-Lend 种子数据（从线上数据库逆向导回，恢复 03-06 中的种子部分）
-- 生成来源：线上 Supabase 导出
-- 说明：vip_discount_rule / vip_upgrade_rule / recharge_package 线上为空，无种子数据。
-- ============================================================================

-- 等级提成规则
insert into public.grade_commission_rule (grade, rate) values
  (1, 0.8000),
  (2, 0.8500),
  (3, 0.9000)
on conflict (grade) do nothing;

-- 商品分类
insert into public.product_category (name, description, status) values
  ('体验单', '', 'enabled'),
  ('手游大于300', '', 'enabled'),
  ('手游小于300', '', 'enabled'),
  ('正常单', '', 'enabled')
on conflict (name) do nothing;

-- 系统用户（与 Supabase Auth 邮箱账号一一对应；password_hash 固定 'auth-managed'，
-- 真实密码由 Supabase Auth 管理，参见 CREATE_USER_GUIDE.md）
insert into public.users (id, username, password_hash, name, role, status) values
  ('c6e1e214-6758-4244-8fb0-26175fb54ef5', 'boss', 'auth-managed', '灰晨', 'boss', 'active'),
  ('18e2f6db-cd24-43fc-a446-a8aa8e5632f3', 'new-manager', 'auth-managed', '张三', 'manager', 'active'),
  ('1b574c5c-db01-4558-a49e-223e65f3d967', '2691371237@qq.com', 'auth-managed', '新用户', 'manager', 'active'),
  ('d1eff7a5-6249-4990-bdbe-fda022ac0085', 'user1317594130', 'auth-managed', '新用户', 'manager', 'active')
on conflict (id) do nothing;

-- ============ SOURCE: 04_employee_profile_ext.sql ============
-- ============================================================================
-- Ex-Lend 员工资料扩展（从线上数据库逆向导回，补齐 01-06 中缺失的迁移）
-- 生成来源：线上 Supabase 枚举 + 表结构导出
-- 说明：gender 枚举与 employee 扩展列由已丢失的早期迁移创建，
--       batch_create_employees / 员工档案依赖这些字段。
-- ============================================================================

do $$ begin
  create type gender as enum ('male', 'female', 'other');
exception when duplicate_object then null; end $$;

alter table public.employee add column if not exists nickname text not null default '';
alter table public.payout add column if not exists proof_path text;
alter table public.employee add column if not exists gender gender;
alter table public.employee add column if not exists alipay_account text;
alter table public.employee add column if not exists bank_name text;
alter table public.employee add column if not exists deposit numeric(12,2) not null default 0 check (deposit >= 0);
alter table public.employee add column if not exists wechat_id text;
alter table public.employee add column if not exists remark text;
alter table public.employee add column if not exists bio text;

-- ============ SOURCE: 07_fix_customer_ledger_enum.sql ============
-- ============================================================================
-- Ex-Lend 兼容修复：补齐客户钱包流水枚举
-- 适用：已经部署过旧版数据库，但现金建单时报
--       invalid input value for enum customer_ledger_type: "cash_received"
-- 使用方法：Supabase Dashboard → SQL Editor → 粘贴本脚本 → Run
-- ============================================================================

-- 逐条执行且可重复执行，不修改已有业务数据。
alter type customer_ledger_type add value if not exists 'consume_from_pending';
alter type customer_ledger_type add value if not exists 'cash_received';
alter type customer_ledger_type add value if not exists 'cash_refund';

-- 完成后，重新打开前端并重试创建订单。



-- ============ SOURCE: 08_rules_and_adjustments.sql ============
-- ============================================================================
-- Ex-Lend 规则管理与客户账户调整
-- 适用：已执行基础建库脚本的项目
-- ============================================================================

create table if not exists customer_account_adjustment (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customer(id) on delete restrict,
  field text not null check (field in ('vip_level', 'total_consumption')),
  amount numeric(12,2) not null default 0,
  before_value numeric(12,2),
  after_value numeric(12,2),
  reason text not null,
  operator_id uuid references users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_customer_adjustment_customer
  on customer_account_adjustment(customer_id);
create index if not exists idx_customer_adjustment_created
  on customer_account_adjustment(created_at);

alter table customer_account_adjustment enable row level security;

drop policy if exists "customer_adjustment_read_staff" on customer_account_adjustment;
create policy "customer_adjustment_read_staff" on customer_account_adjustment
  for select to authenticated using (is_staff());

drop policy if exists "customer_adjustment_write_boss" on customer_account_adjustment;
create policy "customer_adjustment_write_boss" on customer_account_adjustment
  for all to authenticated using (is_boss()) with check (is_boss());

-- 客户累计消费增加后自动升级，默认不自动降级。
create or replace function auto_upgrade_customer_vip()
returns trigger as $$
declare
  v_level int;
begin
  if new.total_consumption <= old.total_consumption then
    return new;
  end if;

  select coalesce(max(vip_level), 0)
    into v_level
    from vip_upgrade_rule
   where consumption_threshold <= new.total_consumption;

  if v_level > coalesce(new.vip_level, 0) then
    update customer
       set type = 'vip', vip_level = v_level
     where id = new.id;

    insert into customer_account_adjustment
      (customer_id, field, amount, before_value, after_value, reason, operator_id)
    values
      (new.id, 'vip_level', v_level - coalesce(new.vip_level, 0),
       coalesce(new.vip_level, 0), v_level, '累计消费达到 VIP 升级门槛', auth.uid());
  end if;

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists customer_auto_upgrade_vip on customer;
create trigger customer_auto_upgrade_vip
  after update of total_consumption on customer
  for each row execute function auto_upgrade_customer_vip();

create or replace function set_customer_vip_level(
  p_customer_id uuid,
  p_vip_level int,
  p_reason text
)
returns jsonb as $$
declare
  v_customer customer%rowtype;
  v_old int;
begin
  if not is_boss() then
    return jsonb_build_object('success', false, 'message', '无权限：仅老板可以调整 VIP 等级');
  end if;
  if p_vip_level < 0 then
    return jsonb_build_object('success', false, 'message', 'VIP 等级不能小于 0');
  end if;
  if nullif(trim(p_reason), '') is null then
    return jsonb_build_object('success', false, 'message', '请填写调整原因');
  end if;

  select * into v_customer from customer where id = p_customer_id for update;
  if not found then
    return jsonb_build_object('success', false, 'message', '客户不存在');
  end if;

  v_old := coalesce(v_customer.vip_level, 0);
  update customer
     set type = case when p_vip_level > 0 then 'vip'::customer_type else 'normal'::customer_type end,
         vip_level = p_vip_level
   where id = p_customer_id;

  insert into customer_account_adjustment
    (customer_id, field, amount, before_value, after_value, reason, operator_id)
  values
    (p_customer_id, 'vip_level', p_vip_level - v_old, v_old, p_vip_level, p_reason, auth.uid());

  return jsonb_build_object('success', true, 'old_level', v_old, 'vip_level', p_vip_level);
end;
$$ language plpgsql security definer;

create or replace function adjust_customer_consumption(
  p_customer_id uuid,
  p_delta numeric,
  p_reason text
)
returns jsonb as $$
declare
  v_customer customer%rowtype;
  v_before numeric(12,2);
  v_after numeric(12,2);
begin
  if not is_boss() then
    return jsonb_build_object('success', false, 'message', '无权限：仅老板可以调整累计消费');
  end if;
  if p_delta = 0 then
    return jsonb_build_object('success', false, 'message', '调整金额不能为 0');
  end if;
  if nullif(trim(p_reason), '') is null then
    return jsonb_build_object('success', false, 'message', '请填写调整原因');
  end if;

  select * into v_customer from customer where id = p_customer_id for update;
  if not found then
    return jsonb_build_object('success', false, 'message', '客户不存在');
  end if;

  v_before := coalesce(v_customer.total_consumption, 0);
  v_after := v_before + p_delta;
  if v_after < 0 then
    return jsonb_build_object('success', false, 'message', '累计消费不能小于 0');
  end if;

  update customer set total_consumption = v_after where id = p_customer_id;

  insert into customer_account_adjustment
    (customer_id, field, amount, before_value, after_value, reason, operator_id)
  values
    (p_customer_id, 'total_consumption', p_delta, v_before, v_after, p_reason, auth.uid());

  return jsonb_build_object('success', true, 'before_value', v_before, 'after_value', v_after);
end;
$$ language plpgsql security definer;



-- ============ SOURCE: 09_payment_proofs.sql ============
-- Payment proof storage and references.
alter table "order" add column if not exists proof_path text;
alter table "order" add column if not exists proof_paths text[] not null default '{}';
alter table customer_wallet_ledger add column if not exists proof_path text;

insert into storage.buckets (id, name, public)
values ('payment-proofs', 'payment-proofs', false)
on conflict (id) do nothing;

do $$ begin
  create policy "payment_proofs_authenticated_read" on storage.objects
    for select to authenticated using (bucket_id = 'payment-proofs');
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "payment_proofs_authenticated_upload" on storage.objects
    for insert to authenticated with check (bucket_id = 'payment-proofs' and (storage.foldername(name))[1] = auth.uid()::text);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "payment_proofs_authenticated_delete" on storage.objects
    for delete to authenticated using (bucket_id = 'payment-proofs' and (storage.foldername(name))[1] = auth.uid()::text);
exception when duplicate_object then null; end $$;

create or replace function recharge_wallet(p_customer_id uuid, p_package_id uuid, p_proof_path text)
returns jsonb as $$
declare
  v_pkg recharge_package%rowtype;
  v_cust customer%rowtype;
  v_new_principal numeric(12,2);
  v_new_bonus numeric(12,2);
  v_op uuid := auth.uid();
begin
  select * into v_pkg from recharge_package where id = p_package_id and status = 'enabled';
  if not found then return jsonb_build_object('success', false, 'message', '充值套餐不存在或已停用'); end if;
  select * into v_cust from customer where id = p_customer_id;
  if not found then return jsonb_build_object('success', false, 'message', '客户不存在'); end if;
  v_new_principal := v_cust.principal_balance + v_pkg.amount;
  v_new_bonus := v_cust.bonus_balance + v_pkg.bonus;
  update customer set principal_balance = v_new_principal, bonus_balance = v_new_bonus where id = p_customer_id;
  insert into customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, operator_id, proof_path, remark)
    values (p_customer_id, 'recharge_principal', v_pkg.amount, v_new_principal, v_cust.bonus_balance, v_op, p_proof_path, '套餐充值本金');
  insert into customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, operator_id, proof_path, remark)
    values (p_customer_id, 'recharge_bonus', v_pkg.bonus, v_new_principal, v_new_bonus, v_op, p_proof_path, '套餐充值赠送');
  return jsonb_build_object('success', true, 'new_balance', v_new_principal + v_new_bonus);
end;
$$ language plpgsql security definer;

create or replace function recharge_custom(p_customer_id uuid, p_amount numeric, p_bonus numeric, p_remark text, p_proof_path text)
returns jsonb as $$
declare
  v_cust customer%rowtype;
  v_new_principal numeric(12,2);
  v_new_bonus numeric(12,2);
  v_op uuid := auth.uid();
begin
  if not is_boss() then return jsonb_build_object('success', false, 'message', '无权限：自定义充值仅老板可用'); end if;
  if p_amount <= 0 then return jsonb_build_object('success', false, 'message', '充值金额必须大于0'); end if;
  if p_bonus < 0 then return jsonb_build_object('success', false, 'message', '赠送金额不能为负'); end if;
  select * into v_cust from customer where id = p_customer_id;
  if not found then return jsonb_build_object('success', false, 'message', '客户不存在'); end if;
  v_new_principal := v_cust.principal_balance + p_amount;
  v_new_bonus := v_cust.bonus_balance + p_bonus;
  update customer set principal_balance = v_new_principal, bonus_balance = v_new_bonus where id = p_customer_id;
  insert into customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, operator_id, proof_path, remark)
    values (p_customer_id, 'recharge_principal', p_amount, v_new_principal, v_cust.bonus_balance, v_op, p_proof_path, coalesce(p_remark, '自定义充值本金'));
  insert into customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, operator_id, proof_path, remark)
    values (p_customer_id, 'recharge_bonus', p_bonus, v_new_principal, v_new_bonus, v_op, p_proof_path, coalesce(p_remark, '自定义充值赠送'));
  return jsonb_build_object('success', true, 'new_balance', v_new_principal + v_new_bonus);
end;
$$ language plpgsql security definer;



-- ============ SOURCE: 10_assign_order_employees.sql ============
-- Allow staff to assign two employees after an order is created.
create or replace function assign_order_employees(p_order_id uuid, p_employee_ids uuid[])
returns jsonb as $$
declare
  v_order "order"%rowtype;
  v_employee_id uuid;
begin
  if not is_staff() then
    return jsonb_build_object('success', false, 'message', '无权限');
  end if;
  if cardinality(p_employee_ids) <> 2 then
    return jsonb_build_object('success', false, 'message', '必须选择两名接单员工');
  end if;
  if p_employee_ids[1] = p_employee_ids[2] then
    return jsonb_build_object('success', false, 'message', '不能重复选择同一名员工');
  end if;

  select * into v_order from "order" where id = p_order_id;
  if not found then return jsonb_build_object('success', false, 'message', '订单不存在'); end if;
  if v_order.audit_status <> 'pending' or v_order.status = 'cancelled' then
    return jsonb_build_object('success', false, 'message', '当前订单状态不允许添加员工');
  end if;
  if exists (select 1 from order_member where order_id = p_order_id) then
    return jsonb_build_object('success', false, 'message', '订单已经有接单员工');
  end if;

  foreach v_employee_id in array p_employee_ids loop
    if not exists (select 1 from employee where id = v_employee_id and status = 'active') then
      return jsonb_build_object('success', false, 'message', '只能选择在职员工');
    end if;
  end loop;

  insert into order_member (order_id, employee_id)
  select p_order_id, unnest(p_employee_ids);
  return jsonb_build_object('success', true, 'message', '接单员工已添加');
end;
$$ language plpgsql security definer;



-- ============ SOURCE: 11_batch_operations.sql ============
create or replace function batch_start_orders(p_order_ids uuid[])
returns jsonb as $$
declare
  v_count int;
begin
  if not is_staff() then return jsonb_build_object('success', false, 'message', '无权限'); end if;
  if exists (
    select 1 from "order" o
    where o.id = any(p_order_ids)
      and o.status = 'booking'
      and o.audit_status = 'pending'
      and not exists (select 1 from order_member om where om.order_id = o.id)
  ) then
    return jsonb_build_object('success', false, 'message', '所选订单中存在未添加员工的订单');
  end if;
  update "order" set status = 'in_progress', updated_at = now()
  where id = any(p_order_ids) and status = 'booking' and audit_status = 'pending';
  get diagnostics v_count = row_count;
  return jsonb_build_object('success', true, 'count', v_count);
end;
$$ language plpgsql security definer;



-- ============ SOURCE: 12_batch_audit_orders.sql ============
create or replace function batch_approve_orders(p_order_ids uuid[])
returns jsonb as $$
declare
  v_id uuid;
  v_result jsonb;
  v_count int := 0;
begin
  if not is_boss() then return jsonb_build_object('success', false, 'message', '仅老板可以审核订单'); end if;
  foreach v_id in array p_order_ids loop
    if not exists (select 1 from "order" where id = v_id and status = 'completed' and audit_status = 'pending') then
      return jsonb_build_object('success', false, 'message', '所选订单中存在不可审核的订单');
    end if;
    if not exists (select 1 from order_member where order_id = v_id) then
      return jsonb_build_object('success', false, 'message', '订单必须先添加接单员工');
    end if;
  end loop;
  foreach v_id in array p_order_ids loop
    select approve_commission(v_id) into v_result;
    if coalesce(v_result->>'success', 'true') = 'false' then raise exception '%', coalesce(v_result->>'message', '订单审核失败'); end if;
    v_count := v_count + 1;
  end loop;
  return jsonb_build_object('success', true, 'count', v_count);
end;
$$ language plpgsql security definer;



-- ============ SOURCE: 13_avatars.sql ============
alter table users add column if not exists avatar_path text;
alter table employee add column if not exists avatar_path text;
alter table customer add column if not exists avatar_path text;

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', false)
on conflict (id) do nothing;

do $$ begin
  create policy "avatars_authenticated_read" on storage.objects
    for select to authenticated using (bucket_id = 'avatars');
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "avatars_authenticated_upload" on storage.objects
    for insert to authenticated with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
exception when duplicate_object then null; end $$;

create or replace function update_self_avatar(p_avatar_path text)
returns jsonb as $$
begin
  update users set avatar_path = p_avatar_path where id = auth.uid();
  if not found then return jsonb_build_object('success', false, 'message', '用户资料不存在'); end if;
  return jsonb_build_object('success', true);
end;
$$ language plpgsql security definer;



-- ============ SOURCE: 14_product_categories.sql ============
-- Product categories are managed independently from products.
-- This migration keeps legacy text columns temporarily for old RPC compatibility.

create table if not exists product_category (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  status text not null default 'enabled' check (status in ('enabled', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name)
);

alter table product add column if not exists category_id uuid references product_category(id) on delete restrict;
alter table vip_discount_rule add column if not exists category_id uuid references product_category(id) on delete restrict;

insert into product_category (name)
select distinct trim(category)
from product
where category is not null and trim(category) <> ''
on conflict (name) do nothing;

insert into product_category (name)
select distinct trim(category)
from vip_discount_rule
where category is not null and trim(category) <> ''
on conflict (name) do nothing;

update product p
set category_id = c.id
from product_category c
where p.category_id is null and c.name = trim(p.category);

update vip_discount_rule r
set category_id = c.id
from product_category c
where r.category_id is null and c.name = trim(r.category);

create unique index if not exists vip_discount_rule_level_category_key
  on vip_discount_rule (vip_level, category_id)
  where category_id is not null;

alter table product enable row level security;
alter table product_category enable row level security;

drop policy if exists "category_read_staff" on product_category;
drop policy if exists "category_write_staff" on product_category;
create policy "category_read_staff" on product_category for select to authenticated using (is_staff());
create policy "category_write_staff" on product_category for all to authenticated using (is_staff()) with check (is_staff());

create or replace function sync_product_category_name()
returns trigger language plpgsql as $$
begin
  if new.category_id is not null then
    select name into new.category from product_category where id = new.category_id;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_product_category_name on product;
create trigger sync_product_category_name
before insert or update of category_id on product
for each row execute function sync_product_category_name();

create or replace function sync_discount_category_name()
returns trigger language plpgsql as $$
begin
  if new.category_id is not null then
    select name into new.category from product_category where id = new.category_id;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_discount_category_name on vip_discount_rule;
create trigger sync_discount_category_name
before insert or update of category_id on vip_discount_rule
for each row execute function sync_discount_category_name();

-- After the backfill is verified in production, make these columns mandatory
-- and remove the legacy category text columns in a separate maintenance migration.



-- ============ SOURCE: 15_order_templates_and_profiles.sql ============
-- Personal settings and reusable order templates.
alter table users add column if not exists bio text;
alter table users add column if not exists order_create_shortcut text not null default 'Ctrl+Shift+O';
alter table users add column if not exists updated_at timestamptz not null default now();

create table if not exists order_template (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references users(id) on delete cascade,
  name text not null,
  product_id uuid not null references product(id) on delete restrict,
  category_id uuid references product_category(id) on delete restrict,
  quantity int not null default 1 check (quantity > 0),
  pay_method pay_method not null default 'cash',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (created_by, name)
);

alter table order_template enable row level security;
drop policy if exists "order_template_read_self" on order_template;
drop policy if exists "order_template_write_self" on order_template;
create policy "order_template_read_self" on order_template for select to authenticated using (created_by = auth.uid() or is_boss());
create policy "order_template_write_self" on order_template for all to authenticated using (created_by = auth.uid() or is_boss()) with check (created_by = auth.uid() or is_boss());

drop policy if exists "user_update_self_profile" on users;
create policy "user_update_self_profile" on users for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create or replace function update_self_profile(p_name text, p_bio text, p_shortcut text)
returns jsonb as $$
begin
  update users
  set name = nullif(trim(p_name), ''),
      bio = nullif(trim(p_bio), ''),
      order_create_shortcut = coalesce(nullif(trim(p_shortcut), ''), 'Ctrl+Shift+O'),
      updated_at = now()
  where id = auth.uid();
  if not found then return jsonb_build_object('success', false, 'message', '用户资料不存在'); end if;
  return jsonb_build_object('success', true);
end;
$$ language plpgsql security definer;



-- ============ SOURCE: 16_user_favorite_products.sql ============
-- 用户自定义常用产品，供个人设置和新建订单快速选择。
create table if not exists public.user_favorite_product (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users(id) on delete cascade,
  product_id uuid not null references public.product(id) on delete cascade,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, product_id)
);

create index if not exists user_favorite_product_user_order_idx
  on public.user_favorite_product(user_id, sort_order);

alter table public.user_favorite_product enable row level security;
drop policy if exists "favorite product owner access" on public.user_favorite_product;
create policy "favorite product owner access" on public.user_favorite_product
  for all using (user_id = auth.uid() or public.is_boss())
  with check (user_id = auth.uid() or public.is_boss());



-- ============ SOURCE: 17_system_logo.sql ============
create table if not exists public.system_setting (
  key text primary key,
  value text,
  updated_by uuid references public.users(id),
  updated_at timestamptz not null default now()
);

alter table public.system_setting enable row level security;
drop policy if exists "system setting authenticated read" on public.system_setting;
create policy "system setting authenticated read" on public.system_setting
  for select to authenticated using (true);

create or replace function public.update_system_logo(p_logo_path text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.users where id = auth.uid() and role = 'boss') then
    return jsonb_build_object('success', false, 'message', '只有老板可以修改系统 Logo');
  end if;
  insert into public.system_setting(key, value, updated_by)
  values ('system_logo_path', p_logo_path, auth.uid())
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.update_system_logo(text) to authenticated;



-- ============ SOURCE: 18_order_deletion.sql ============
create table if not exists public.order_delete_log (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  order_no text not null,
  deleted_by uuid not null references public.users(id),
  paid_amount numeric(12,2) not null default 0,
  status text not null,
  audit_status text not null,
  reason text,
  deleted_at timestamptz not null default now()
);

alter table public.order_delete_log enable row level security;
drop policy if exists "order delete log boss read" on public.order_delete_log;
create policy "order delete log boss read" on public.order_delete_log for select to authenticated using (public.is_boss());

create or replace function public.delete_order(p_order_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_order "order"%rowtype;
  v_principal numeric := 0;
  v_bonus numeric := 0;
begin
  if not public.is_boss() then return jsonb_build_object('success', false, 'message', '仅老板可以删除订单'); end if;
  select * into v_order from public."order" where id = p_order_id for update;
  if not found then return jsonb_build_object('success', false, 'message', '订单不存在'); end if;
  if v_order.status <> 'booking' then return jsonb_build_object('success', false, 'message', '订单已经开始，不能删除'); end if;
  if v_order.audit_status <> 'pending' then return jsonb_build_object('success', false, 'message', '订单已经审核，不能删除'); end if;
  if exists (select 1 from public.order_member where order_id = p_order_id and coalesce(commission_amount, 0) <> 0) then
    return jsonb_build_object('success', false, 'message', '订单已经产生提成，不能删除');
  end if;

  if v_order.pay_method = 'wallet' then
    select coalesce(sum(case when type = 'consume_principal' then -amount else 0 end), 0),
           coalesce(sum(case when type = 'consume_bonus' then -amount else 0 end), 0)
      into v_principal, v_bonus
      from public.customer_wallet_ledger where order_id = p_order_id;
    update public.customer set
      principal_balance = principal_balance + v_principal,
      bonus_balance = bonus_balance + v_bonus,
      pending_balance = greatest(pending_balance - v_order.paid_amount, 0)
      where id = v_order.customer_id;
  end if;

  insert into public.order_delete_log(order_id, order_no, deleted_by, paid_amount, status, audit_status, reason)
    values (v_order.id, v_order.order_no, auth.uid(), v_order.paid_amount, v_order.status::text, v_order.audit_status::text, p_reason);
  delete from public.customer_wallet_ledger where order_id = p_order_id;
  delete from public.wallet_ledger where order_id = p_order_id;
  delete from public.order_member where order_id = p_order_id;
  delete from public."order" where id = p_order_id;
  return jsonb_build_object('success', true, 'order_no', v_order.order_no);
end;
$$;

grant execute on function public.delete_order(uuid, text) to authenticated;



-- ============ SOURCE: 20_multi_product_orders.sql ============
-- Ex-Lend multi-product orders.
-- Run after 19_clear_test_business_data.sql in the Supabase SQL Editor.

create table if not exists public.order_item (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public."order"(id) on delete cascade,
  product_id uuid not null references public.product(id) on delete restrict,
  product_name_snapshot text not null,
  category_id_snapshot uuid,
  category_snapshot text,
  unit_price numeric(12,2) not null check (unit_price >= 0),
  quantity int not null check (quantity > 0),
  original_amount numeric(12,2) not null check (original_amount >= 0),
  discount_rate numeric(8,6) not null default 1 check (discount_rate >= 0 and discount_rate <= 1),
  discount_amount numeric(12,2) not null default 0 check (discount_amount >= 0),
  paid_amount numeric(12,2) not null check (paid_amount >= 0),
  commission_type_snapshot commission_type,
  fixed_rate_snapshot numeric(8,6),
  created_at timestamptz not null default now(),
  unique (order_id, product_id)
);

create index if not exists idx_order_item_order on public.order_item(order_id);
create index if not exists idx_order_item_product on public.order_item(product_id);

alter table public.order_item enable row level security;
drop policy if exists "order item read staff" on public.order_item;
drop policy if exists "order item write staff" on public.order_item;
create policy "order item read staff" on public.order_item
  for select to authenticated using (public.is_staff());
create policy "order item write staff" on public.order_item
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

grant select, insert, update, delete on public.order_item to authenticated;

-- Preserve every existing single-product order as one order item.
insert into public.order_item (
  order_id, product_id, product_name_snapshot, category_id_snapshot, category_snapshot,
  unit_price, quantity, original_amount, discount_rate, discount_amount, paid_amount,
  commission_type_snapshot, fixed_rate_snapshot
)
select
  o.id,
  p.id,
  p.name,
  p.category_id,
  p.category,
  round(o.original_amount / greatest(coalesce(o.quantity, 1), 1), 2),
  greatest(coalesce(o.quantity, 1), 1),
  o.original_amount,
  case when o.original_amount > 0 then least(1, o.paid_amount / o.original_amount) else 1 end,
  o.discount_amount,
  o.paid_amount,
  p.commission_type,
  p.fixed_rate
from public."order" o
join public.product p on p.id = o.product_id
where not exists (select 1 from public.order_item oi where oi.order_id = o.id)
on conflict (order_id, product_id) do nothing;

create or replace function public.create_order_multi(
  p_customer_id uuid,
  p_items jsonb,
  p_employee_ids uuid[],
  p_pay_method pay_method,
  p_paid_amount numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cust public.customer%rowtype;
  v_prod public.product%rowtype;
  v_line record;
  v_employee_id uuid;
  v_order_id uuid;
  v_order_no text;
  v_first_product_id uuid;
  v_last_item_id uuid;
  v_total_quantity int := 0;
  v_original numeric(12,2) := 0;
  v_calculated_paid numeric(12,2) := 0;
  v_paid numeric(12,2);
  v_discount numeric(12,2);
  v_rule_rate numeric(8,6);
  v_item_original numeric(12,2);
  v_item_paid numeric(12,2);
  v_item_rate numeric(8,6);
  v_inserted_paid numeric(12,2) := 0;
  v_rounding_delta numeric(12,2);
  v_total_liability numeric(12,2);
  v_principal_consume numeric(12,2) := 0;
  v_bonus_consume numeric(12,2) := 0;
  v_op uuid;
begin
  if not public.is_staff() then
    return jsonb_build_object('success', false, 'message', '无权限');
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('success', false, 'message', '订单至少需要一个商品');
  end if;
  if jsonb_array_length(p_items) > 50 then
    return jsonb_build_object('success', false, 'message', '单张订单最多添加 50 种商品');
  end if;
  if coalesce(cardinality(p_employee_ids), 0) not in (0, 2) then
    return jsonb_build_object('success', false, 'message', '员工应暂不选择或一次选择两名');
  end if;
  if cardinality(p_employee_ids) = 2 and p_employee_ids[1] = p_employee_ids[2] then
    return jsonb_build_object('success', false, 'message', '不能重复选择同一名员工');
  end if;

  select * into v_cust from public.customer where id = p_customer_id and status = 'active' for update;
  if not found then
    return jsonb_build_object('success', false, 'message', '客户不存在或已停用');
  end if;

  foreach v_employee_id in array coalesce(p_employee_ids, array[]::uuid[]) loop
    if not exists (select 1 from public.employee where id = v_employee_id and status = 'active') then
      return jsonb_build_object('success', false, 'message', '只能选择在职员工');
    end if;
  end loop;

  -- Validate products and calculate the server-authoritative total.
  for v_line in
    select x.product_id, sum(x.quantity)::int as quantity
    from jsonb_to_recordset(p_items) as x(product_id uuid, quantity int)
    group by x.product_id
  loop
    if v_line.product_id is null or v_line.quantity is null or v_line.quantity <= 0 then
      return jsonb_build_object('success', false, 'message', '商品或数量无效');
    end if;
    select * into v_prod from public.product where id = v_line.product_id and status = 'on_sale';
    if not found then
      return jsonb_build_object('success', false, 'message', '订单中存在已下架或不存在的商品');
    end if;

    if v_first_product_id is null then v_first_product_id := v_prod.id; end if;
    v_total_quantity := v_total_quantity + v_line.quantity;
    v_item_original := round(v_prod.price * v_line.quantity, 2);
    v_item_rate := 1;
    if v_cust.type = 'vip' then
      select r.discount into v_rule_rate
      from public.vip_discount_rule r
      where r.vip_level = v_cust.vip_level
        and (r.category_id = v_prod.category_id or (r.category_id is null and r.category = v_prod.category))
      order by (r.category_id is not null) desc
      limit 1;
      if found then v_item_rate := v_rule_rate; end if;
    end if;
    v_original := v_original + v_item_original;
    v_calculated_paid := v_calculated_paid + round(v_item_original * v_item_rate, 2);
  end loop;

  v_original := round(v_original, 2);
  v_calculated_paid := round(v_calculated_paid, 2);
  v_paid := round(coalesce(p_paid_amount, v_calculated_paid), 2);
  if v_paid < 0 or v_paid > v_original then
    return jsonb_build_object('success', false, 'message', '实付金额必须在 0 和订单原价之间');
  end if;
  v_discount := v_original - v_paid;

  if p_pay_method = 'wallet' then
    v_total_liability := v_cust.principal_balance + v_cust.bonus_balance;
    if v_total_liability < v_paid then
      return jsonb_build_object('success', false, 'message', '客户钱包余额不足');
    end if;
    if v_total_liability > 0 then
      v_principal_consume := round(v_paid * (v_cust.principal_balance / v_total_liability), 2);
      v_bonus_consume := v_paid - v_principal_consume;
    end if;
  end if;

  v_op := auth.uid();
  v_order_no := public.gen_order_no();
  insert into public."order" (
    order_no, customer_id, product_id, customer_type_snapshot, vip_level_snapshot, pay_method,
    original_amount, paid_amount, discount_amount, pending_amount, quantity, operator_id
  ) values (
    v_order_no, p_customer_id, v_first_product_id, v_cust.type, v_cust.vip_level, p_pay_method,
    v_original, v_paid, v_discount, v_paid, v_total_quantity, v_op
  ) returning id into v_order_id;

  -- Store immutable product snapshots. Manual total overrides are distributed by original value.
  for v_line in
    select x.product_id, sum(x.quantity)::int as quantity
    from jsonb_to_recordset(p_items) as x(product_id uuid, quantity int)
    group by x.product_id
    order by x.product_id
  loop
    select * into v_prod from public.product where id = v_line.product_id;
    v_item_original := round(v_prod.price * v_line.quantity, 2);
    v_item_rate := 1;
    if v_cust.type = 'vip' then
      select r.discount into v_rule_rate
      from public.vip_discount_rule r
      where r.vip_level = v_cust.vip_level
        and (r.category_id = v_prod.category_id or (r.category_id is null and r.category = v_prod.category))
      order by (r.category_id is not null) desc
      limit 1;
      if found then v_item_rate := v_rule_rate; end if;
    end if;
    if p_paid_amount is null then
      v_item_paid := round(v_item_original * v_item_rate, 2);
    else
      v_item_paid := case when v_original > 0 then round(v_paid * v_item_original / v_original, 2) else 0 end;
    end if;

    insert into public.order_item (
      order_id, product_id, product_name_snapshot, category_id_snapshot, category_snapshot,
      unit_price, quantity, original_amount, discount_rate, discount_amount, paid_amount,
      commission_type_snapshot, fixed_rate_snapshot
    ) values (
      v_order_id, v_prod.id, v_prod.name, v_prod.category_id, v_prod.category,
      v_prod.price, v_line.quantity, v_item_original,
      case when v_item_original > 0 then v_item_paid / v_item_original else 1 end,
      v_item_original - v_item_paid, v_item_paid, v_prod.commission_type, v_prod.fixed_rate
    ) returning id into v_last_item_id;
    v_inserted_paid := v_inserted_paid + v_item_paid;
  end loop;

  v_rounding_delta := v_paid - v_inserted_paid;
  if v_rounding_delta <> 0 and v_last_item_id is not null then
    update public.order_item
    set paid_amount = paid_amount + v_rounding_delta,
        discount_amount = original_amount - (paid_amount + v_rounding_delta),
        discount_rate = case when original_amount > 0 then (paid_amount + v_rounding_delta) / original_amount else 1 end
    where id = v_last_item_id;
  end if;

  insert into public.order_member (order_id, employee_id)
  select v_order_id, unnest(coalesce(p_employee_ids, array[]::uuid[]))
  on conflict do nothing;

  if p_pay_method = 'wallet' then
    update public.customer set
      principal_balance = principal_balance - v_principal_consume,
      bonus_balance = bonus_balance - v_bonus_consume,
      pending_balance = pending_balance + v_paid
    where id = p_customer_id;

    insert into public.customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, order_id, operator_id, remark)
    values (p_customer_id, 'consume_principal', -v_principal_consume,
      v_cust.principal_balance - v_principal_consume, v_cust.bonus_balance - v_bonus_consume, v_order_id, v_op, '下单质押-本金');
    insert into public.customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, order_id, operator_id, remark)
    values (p_customer_id, 'consume_bonus', -v_bonus_consume,
      v_cust.principal_balance - v_principal_consume, v_cust.bonus_balance - v_bonus_consume, v_order_id, v_op, '下单质押-赠送');
  else
    update public.customer set pending_balance = pending_balance + v_paid where id = p_customer_id;
    insert into public.customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, order_id, operator_id, remark)
    values (p_customer_id, 'cash_received', v_paid, v_cust.principal_balance, v_cust.bonus_balance, v_order_id, v_op, '下单收取现金(预收)');
  end if;

  return jsonb_build_object(
    'success', true,
    'order_id', v_order_id,
    'order_no', v_order_no,
    'original_amount', v_original,
    'paid_amount', v_paid,
    'discount', v_discount,
    'item_count', (select count(*) from public.order_item where order_id = v_order_id)
  );
exception
  when invalid_text_representation or data_exception then
    return jsonb_build_object('success', false, 'message', '商品明细格式不正确');
end;
$$;

grant execute on function public.create_order_multi(uuid, jsonb, uuid[], pay_method, numeric) to authenticated;

create or replace function public.edit_order(
  p_order_id uuid,
  p_customer_id uuid,
  p_items jsonb,
  p_employee_ids uuid[],
  p_pay_method pay_method
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ord public."order"%rowtype;
  v_old_cust public.customer%rowtype;
  v_cust public.customer%rowtype;
  v_prod public.product%rowtype;
  v_line record;
  v_employee_id uuid;
  v_first_product_id uuid;
  v_last_item_id uuid;
  v_total_quantity int := 0;
  v_original numeric(12,2) := 0;
  v_calculated_paid numeric(12,2) := 0;
  v_paid numeric(12,2);
  v_discount numeric(12,2);
  v_rule_rate numeric(8,6);
  v_item_original numeric(12,2);
  v_item_paid numeric(12,2);
  v_item_rate numeric(8,6);
  v_inserted_paid numeric(12,2) := 0;
  v_rounding_delta numeric(12,2);
  v_total_liability numeric(12,2);
  v_principal_consume numeric(12,2) := 0;
  v_bonus_consume numeric(12,2) := 0;
  v_rev_principal numeric(12,2) := 0;
  v_rev_bonus numeric(12,2) := 0;
  v_op uuid;
begin
  if not public.is_boss() then
    return jsonb_build_object('success', false, 'message', '无权限：仅老板可编辑订单');
  end if;

  select * into v_ord from public."order" where id = p_order_id for update;
  if not found then
    return jsonb_build_object('success', false, 'message', '订单不存在');
  end if;
  if v_ord.status <> 'booking' then
    return jsonb_build_object('success', false, 'message', '仅待开始状态的订单可编辑');
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('success', false, 'message', '订单至少需要一个商品');
  end if;
  if jsonb_array_length(p_items) > 50 then
    return jsonb_build_object('success', false, 'message', '单张订单最多添加 50 种商品');
  end if;
  if coalesce(cardinality(p_employee_ids), 0) not in (0, 2) then
    return jsonb_build_object('success', false, 'message', '员工应暂不选择或一次选择两名');
  end if;
  if cardinality(p_employee_ids) = 2 and p_employee_ids[1] = p_employee_ids[2] then
    return jsonb_build_object('success', false, 'message', '不能重复选择同一名员工');
  end if;

  select * into v_cust from public.customer where id = p_customer_id and status = 'active' for update;
  if not found then
    return jsonb_build_object('success', false, 'message', '客户不存在或已停用');
  end if;

  foreach v_employee_id in array coalesce(p_employee_ids, array[]::uuid[]) loop
    if not exists (select 1 from public.employee where id = v_employee_id and status = 'active') then
      return jsonb_build_object('success', false, 'message', '只能选择在职员工');
    end if;
  end loop;

  -- 冲正原订单的钱包/待结算影响（按该订单实际流水精确冲正）
  if v_ord.customer_id is not null then
    select * into v_old_cust from public.customer where id = v_ord.customer_id for update;
    if found then
      select coalesce(sum(abs(amount)), 0) into v_rev_principal
      from public.customer_wallet_ledger
      where order_id = p_order_id and type = 'consume_principal';
      select coalesce(sum(abs(amount)), 0) into v_rev_bonus
      from public.customer_wallet_ledger
      where order_id = p_order_id and type = 'consume_bonus';
      update public.customer set
        principal_balance = principal_balance + v_rev_principal,
        bonus_balance = bonus_balance + v_rev_bonus,
        pending_balance = greatest(0, pending_balance - v_ord.paid_amount)
      where id = v_ord.customer_id;
    end if;
  end if;

  delete from public.order_item where order_id = p_order_id;
  delete from public.order_member where order_id = p_order_id;

  -- 重算（与 create_order_multi 口径一致）
  for v_line in
    select x.product_id, sum(x.quantity)::int as quantity
    from jsonb_to_recordset(p_items) as x(product_id uuid, quantity int)
    group by x.product_id
  loop
    if v_line.product_id is null or v_line.quantity is null or v_line.quantity <= 0 then
      return jsonb_build_object('success', false, 'message', '商品或数量无效');
    end if;
    select * into v_prod from public.product where id = v_line.product_id and status = 'on_sale';
    if not found then
      return jsonb_build_object('success', false, 'message', '订单中存在已下架或不存在的商品');
    end if;
    if v_first_product_id is null then v_first_product_id := v_prod.id; end if;
    v_total_quantity := v_total_quantity + v_line.quantity;
    v_item_original := round(v_prod.price * v_line.quantity, 2);
    v_item_rate := 1;
    if v_cust.type = 'vip' then
      select r.discount into v_rule_rate
      from public.vip_discount_rule r
      where r.vip_level = v_cust.vip_level
        and (r.category_id = v_prod.category_id or (r.category_id is null and r.category = v_prod.category))
      order by (r.category_id is not null) desc
      limit 1;
      if found then v_item_rate := v_rule_rate; end if;
    end if;
    v_original := v_original + v_item_original;
    v_calculated_paid := v_calculated_paid + round(v_item_original * v_item_rate, 2);
  end loop;

  v_original := round(v_original, 2);
  v_paid := round(v_calculated_paid, 2);
  v_discount := v_original - v_paid;

  if p_pay_method = 'wallet' then
    v_total_liability := v_cust.principal_balance + v_cust.bonus_balance;
    if v_total_liability < v_paid then
      return jsonb_build_object('success', false, 'message', '客户钱包余额不足');
    end if;
    if v_total_liability > 0 then
      v_principal_consume := round(v_paid * (v_cust.principal_balance / v_total_liability), 2);
      v_bonus_consume := v_paid - v_principal_consume;
    end if;
  end if;

  v_op := auth.uid();
  update public."order" set
    customer_id = p_customer_id,
    product_id = v_first_product_id,
    customer_type_snapshot = v_cust.type,
    vip_level_snapshot = v_cust.vip_level,
    pay_method = p_pay_method,
    original_amount = v_original,
    paid_amount = v_paid,
    discount_amount = v_discount,
    pending_amount = v_paid,
    quantity = v_total_quantity,
    operator_id = v_op
  where id = p_order_id;

  for v_line in
    select x.product_id, sum(x.quantity)::int as quantity
    from jsonb_to_recordset(p_items) as x(product_id uuid, quantity int)
    group by x.product_id
    order by x.product_id
  loop
    select * into v_prod from public.product where id = v_line.product_id;
    v_item_original := round(v_prod.price * v_line.quantity, 2);
    v_item_rate := 1;
    if v_cust.type = 'vip' then
      select r.discount into v_rule_rate
      from public.vip_discount_rule r
      where r.vip_level = v_cust.vip_level
        and (r.category_id = v_prod.category_id or (r.category_id is null and r.category = v_prod.category))
      order by (r.category_id is not null) desc
      limit 1;
      if found then v_item_rate := v_rule_rate; end if;
    end if;
    v_item_paid := round(v_item_original * v_item_rate, 2);

    insert into public.order_item (
      order_id, product_id, product_name_snapshot, category_id_snapshot, category_snapshot,
      unit_price, quantity, original_amount, discount_rate, discount_amount, paid_amount,
      commission_type_snapshot, fixed_rate_snapshot
    ) values (
      p_order_id, v_prod.id, v_prod.name, v_prod.category_id, v_prod.category,
      v_prod.price, v_line.quantity, v_item_original,
      case when v_item_original > 0 then v_item_paid / v_item_original else 1 end,
      v_item_original - v_item_paid, v_item_paid, v_prod.commission_type, v_prod.fixed_rate
    ) returning id into v_last_item_id;
    v_inserted_paid := v_inserted_paid + v_item_paid;
  end loop;

  v_rounding_delta := v_paid - v_inserted_paid;
  if v_rounding_delta <> 0 and v_last_item_id is not null then
    update public.order_item
    set paid_amount = paid_amount + v_rounding_delta,
        discount_amount = original_amount - (paid_amount + v_rounding_delta),
        discount_rate = case when original_amount > 0 then (paid_amount + v_rounding_delta) / original_amount else 1 end
    where id = v_last_item_id;
  end if;

  insert into public.order_member (order_id, employee_id)
  select p_order_id, unnest(coalesce(p_employee_ids, array[]::uuid[]))
  on conflict do nothing;

  if p_pay_method = 'wallet' then
    update public.customer set
      principal_balance = principal_balance - v_principal_consume,
      bonus_balance = bonus_balance - v_bonus_consume,
      pending_balance = pending_balance + v_paid
    where id = p_customer_id;

    insert into public.customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, order_id, operator_id, remark)
    values (p_customer_id, 'consume_principal', -v_principal_consume,
      v_cust.principal_balance - v_principal_consume, v_cust.bonus_balance - v_bonus_consume, p_order_id, v_op, '编辑订单-质押本金');
    insert into public.customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, order_id, operator_id, remark)
    values (p_customer_id, 'consume_bonus', -v_bonus_consume,
      v_cust.principal_balance - v_principal_consume, v_cust.bonus_balance - v_bonus_consume, p_order_id, v_op, '编辑订单-质押赠送');
  else
    update public.customer set pending_balance = pending_balance + v_paid where id = p_customer_id;
    insert into public.customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, order_id, operator_id, remark)
    values (p_customer_id, 'cash_received', v_paid, v_cust.principal_balance, v_cust.bonus_balance, p_order_id, v_op, '编辑订单-现金预收');
  end if;

  return jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'original_amount', v_original,
    'paid_amount', v_paid,
    'discount', v_discount,
    'pending_amount', v_paid
  );
end;
$$;

revoke all on function public.edit_order(uuid, uuid, jsonb, uuid[], pay_method) from public;
grant execute on function public.edit_order(uuid, uuid, jsonb, uuid[], pay_method) to authenticated;

create or replace function public.correct_order(
  p_order_id uuid,
  p_customer_id uuid,
  p_items jsonb,
  p_employee_ids uuid[],
  p_pay_method pay_method
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ord public."order"%rowtype;
  v_refund jsonb;
  v_new jsonb;
begin
  if not public.is_staff() then
    return jsonb_build_object('success', false, 'message', '无权限');
  end if;

  select * into v_ord from public."order" where id = p_order_id for update;
  if not found then
    return jsonb_build_object('success', false, 'message', '订单不存在');
  end if;
  if v_ord.status = 'cancelled' or v_ord.audit_status = 'rejected' then
    return jsonb_build_object('success', false, 'message', '已取消/已拒绝的订单不能更正');
  end if;
  if v_ord.status = 'booking' then
    return jsonb_build_object('success', false, 'message', '待开始订单请使用编辑订单（原地修改）');
  end if;

  -- 按原支付方式退款冲正（已完成/已审核订单的“仅老板”保护由 refund_order 自带）
  v_refund := public.refund_order(
    p_order_id,
    case when v_ord.pay_method = 'wallet' then 'wallet' else 'cash' end
  );
  if (v_refund ->> 'success') <> 'true' then
    return v_refund;
  end if;

  -- 用正确信息重建订单；失败则整体回滚（原单退款也被撤销）
  v_new := public.create_order_multi(p_customer_id, p_items, p_employee_ids, p_pay_method, null);
  if (v_new ->> 'success') <> 'true' then
    raise exception '更正失败：%', coalesce(v_new ->> 'message', '重建订单失败');
  end if;
  return v_new;
end;
$$;

revoke all on function public.correct_order(uuid, uuid, jsonb, uuid[], pay_method) from public;
grant execute on function public.correct_order(uuid, uuid, jsonb, uuid[], pay_method) to authenticated;



-- Commission is now the sum of each product line's commission rule.
create or replace function public.approve_commission(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ord public."order"%rowtype;
  v_member record;
  v_item record;
  v_member_count int;
  v_base numeric(12,2);
  v_item_base numeric(12,2);
  v_grade_rate numeric(8,6);
  v_commission numeric(12,2);
  v_total_commission numeric(12,2) := 0;
  v_effective_rate numeric(8,6);
  v_snapshot_type commission_type;
  v_new_emp_balance numeric(12,2);
  v_cust public.customer%rowtype;
  v_principal_consume numeric(12,2);
  v_bonus_consume numeric(12,2);
  v_real_income numeric(12,2);
  v_gross_profit numeric(12,2);
  v_op uuid;
begin
  if not public.is_boss() then
    return jsonb_build_object('success', false, 'message', '无权限：仅老板可审核提成');
  end if;
  v_op := auth.uid();
  select * into v_ord from public."order" where id = p_order_id for update;
  if not found then return jsonb_build_object('success', false, 'message', '订单不存在'); end if;
  if v_ord.status <> 'completed' then return jsonb_build_object('success', false, 'message', '订单未完成，不能审核'); end if;
  if v_ord.audit_status <> 'pending' then return jsonb_build_object('success', false, 'message', '订单已审核过'); end if;

  select count(*) into v_member_count from public.order_member where order_id = p_order_id;
  if v_member_count = 0 then return jsonb_build_object('success', false, 'message', '订单无参与员工'); end if;
  if not exists (select 1 from public.order_item where order_id = p_order_id) then
    return jsonb_build_object('success', false, 'message', '订单缺少商品明细');
  end if;
  if exists (
    select 1
    from public.order_member om
    join public.employee e on e.id = om.employee_id
    where om.order_id = p_order_id
      and exists (select 1 from public.order_item oi where oi.order_id = p_order_id and oi.commission_type_snapshot = 'grade')
      and not exists (select 1 from public.grade_commission_rule gr where gr.grade = e.grade)
  ) then
    return jsonb_build_object('success', false, 'message', '参与员工存在未配置提成规则的等级');
  end if;

  v_base := round(v_ord.paid_amount / v_member_count, 2);
  for v_member in
    select om.employee_id, e.grade, e.wallet_balance
    from public.order_member om
    join public.employee e on e.id = om.employee_id
    where om.order_id = p_order_id
  loop
    v_commission := 0;
    v_snapshot_type := null;
    for v_item in select * from public.order_item where order_id = p_order_id loop
      v_item_base := v_item.paid_amount / v_member_count;
      if v_item.commission_type_snapshot = 'fixed' then
        v_commission := v_commission + round(v_item_base * coalesce(v_item.fixed_rate_snapshot, 0), 2);
      else
        select rate into v_grade_rate from public.grade_commission_rule where grade = v_member.grade limit 1;
        v_commission := v_commission + round(v_item_base * v_grade_rate, 2);
      end if;
      if v_snapshot_type is null then
        v_snapshot_type := v_item.commission_type_snapshot;
      elsif v_snapshot_type <> v_item.commission_type_snapshot then
        v_snapshot_type := null;
      end if;
    end loop;

    v_effective_rate := case when v_base > 0 then v_commission / v_base else 0 end;
    v_total_commission := v_total_commission + v_commission;
    update public.order_member set
      grade_snapshot = v_member.grade,
      base_amount = v_base,
      applied_rate = v_effective_rate,
      commission_amount = v_commission,
      commission_type_snapshot = v_snapshot_type
    where order_id = p_order_id and employee_id = v_member.employee_id;

    v_new_emp_balance := v_member.wallet_balance + v_commission;
    update public.employee set wallet_balance = v_new_emp_balance where id = v_member.employee_id;
    insert into public.wallet_ledger (employee_id, type, amount, balance_after, order_id, operator_id, remark)
    values (v_member.employee_id, 'commission', v_commission, v_new_emp_balance, p_order_id, v_op, '订单审核提成入账');
  end loop;

  v_real_income := v_ord.paid_amount;
  if v_ord.pay_method = 'wallet' then
    select * into v_cust from public.customer where id = v_ord.customer_id;
    select
      coalesce(sum(case when type = 'consume_principal' then -amount else 0 end), 0),
      coalesce(sum(case when type = 'consume_bonus' then -amount else 0 end), 0)
    into v_principal_consume, v_bonus_consume
    from public.customer_wallet_ledger
    where order_id = p_order_id and type in ('consume_principal', 'consume_bonus');
    v_real_income := v_principal_consume;
    update public.customer set
      pending_balance = pending_balance - v_ord.paid_amount,
      total_consumption = total_consumption + v_ord.paid_amount
    where id = v_cust.id;
    insert into public.customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, order_id, operator_id, remark)
    values (v_cust.id, 'consume_from_pending', 0, v_cust.principal_balance, v_cust.bonus_balance, p_order_id, v_op, '订单完成-预收转消费');
  else
    update public.customer set
      pending_balance = pending_balance - v_ord.paid_amount,
      total_consumption = total_consumption + v_ord.paid_amount
    where id = v_ord.customer_id;
    insert into public.customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, order_id, operator_id, remark)
    values (v_ord.customer_id, 'consume_from_pending', 0, 0, 0, p_order_id, v_op, '订单完成-现金预收转收入');
  end if;

  v_gross_profit := v_real_income - v_total_commission;
  update public."order" set
    audit_status = 'approved',
    total_commission = v_total_commission,
    gross_profit = v_gross_profit,
    auditor_id = v_op,
    audited_at = now()
  where id = p_order_id;

  return jsonb_build_object(
    'success', true,
    'message', '审核通过',
    'total_commission', v_total_commission,
    'real_income', v_real_income,
    'gross_profit', v_gross_profit
  );
end;
$$;

grant execute on function public.approve_commission(uuid) to authenticated;



-- ============ SOURCE: 24_order_creator_and_proof.sql ============
-- Ex-Lend order creator display and proof updates after an order starts.

create or replace function public.list_order_creator_profiles()
returns table(id uuid, username text, name text, role user_role)
language sql
security definer
set search_path = public
as $$
  select u.id, u.username, u.name, u.role
  from public.users u
  where public.is_staff();
$$;

revoke all on function public.list_order_creator_profiles() from public;
grant execute on function public.list_order_creator_profiles() to authenticated;

create or replace function public.update_order_proof(p_order_id uuid, p_proof_path text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status order_status;
begin
  if not public.is_staff() then
    return jsonb_build_object('success', false, 'message', '无权操作');
  end if;

  select status into v_status
  from public."order"
  where id = p_order_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'message', '订单不存在');
  end if;
  if v_status not in ('booking', 'in_progress', 'completed') then
    return jsonb_build_object('success', false, 'message', '订单开始后才能编辑支付凭证');
  end if;

  update public."order"
  set proof_path = nullif(trim(p_proof_path), '')
  where id = p_order_id;

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.update_order_proof(uuid, text) from public;
grant execute on function public.update_order_proof(uuid, text) to authenticated;

create or replace function public.add_order_proof(p_order_id uuid, p_proof_path text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status order_status;
  v_path text;
begin
  if not public.is_staff() then
    return jsonb_build_object('success', false, 'message', '无权操作');
  end if;
  v_path := nullif(trim(p_proof_path), '');
  if v_path is null then
    return jsonb_build_object('success', false, 'message', '凭证路径为空');
  end if;

  select status into v_status
  from public."order"
  where id = p_order_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'message', '订单不存在');
  end if;
  if v_status not in ('booking', 'in_progress', 'completed') then
    return jsonb_build_object('success', false, 'message', '订单开始后才能编辑支付凭证');
  end if;

  if v_path = any(coalesce((select proof_paths from public."order" where id = p_order_id), array[]::text[])) then
    return jsonb_build_object('success', true, 'message', '凭证已存在');
  end if;

  update public."order"
  set proof_paths = array_append(coalesce(proof_paths, array[]::text[]), v_path),
      proof_path = v_path
  where id = p_order_id;

  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.remove_order_proof(p_order_id uuid, p_proof_path text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status order_status;
  v_path text;
  v_paths text[];
begin
  if not public.is_staff() then
    return jsonb_build_object('success', false, 'message', '无权操作');
  end if;
  v_path := nullif(trim(p_proof_path), '');
  if v_path is null then
    return jsonb_build_object('success', false, 'message', '凭证路径为空');
  end if;

  select status into v_status
  from public."order"
  where id = p_order_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'message', '订单不存在');
  end if;
  if v_status not in ('booking', 'in_progress', 'completed') then
    return jsonb_build_object('success', false, 'message', '订单开始后才能编辑支付凭证');
  end if;

  select coalesce(proof_paths, array[]::text[]) into v_paths
  from public."order"
  where id = p_order_id;

  v_paths := array_remove(v_paths, v_path);

  update public."order"
  set proof_paths = v_paths,
      proof_path = case
        when coalesce(array_length(v_paths, 1), 0) > 0 then v_paths[array_length(v_paths, 1)]
        else null
      end
  where id = p_order_id;

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.add_order_proof(uuid, text) from public;
grant execute on function public.add_order_proof(uuid, text) to authenticated;
revoke all on function public.remove_order_proof(uuid, text) from public;
grant execute on function public.remove_order_proof(uuid, text) to authenticated;



-- ============ SOURCE: 25_dashboard_collaboration.sql ============
-- Shared dashboard collaboration: todos for all staff, announcements for boss only.

create table if not exists public.todo_item (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 1 and 160),
  content text not null default '',
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'completed')),
  mentioned_user_ids uuid[] not null default '{}'::uuid[],
  created_by uuid not null default auth.uid() references public.users(id),
  updated_by uuid not null default auth.uid() references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_todo_item_updated_at on public.todo_item(updated_at desc);
create index if not exists idx_todo_item_status on public.todo_item(status);

create table if not exists public.announcement (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 1 and 160),
  content text not null default '',
  is_pinned boolean not null default false,
  created_by uuid not null default auth.uid() references public.users(id),
  updated_by uuid not null default auth.uid() references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_announcement_pinned_updated on public.announcement(is_pinned desc, updated_at desc);

create or replace function public.touch_collaboration_record()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at = now();
  new.updated_by = auth.uid();
  return new;
end;
$$;

drop trigger if exists todo_item_touch on public.todo_item;
create trigger todo_item_touch
before update on public.todo_item
for each row execute function public.touch_collaboration_record();

drop trigger if exists announcement_touch on public.announcement;
create trigger announcement_touch
before update on public.announcement
for each row execute function public.touch_collaboration_record();

alter table public.todo_item enable row level security;
alter table public.announcement enable row level security;

drop policy if exists "todo_item_read_staff" on public.todo_item;
create policy "todo_item_read_staff" on public.todo_item
  for select to authenticated using (is_staff());

drop policy if exists "todo_item_write_staff" on public.todo_item;
create policy "todo_item_write_staff" on public.todo_item
  for all to authenticated using (is_staff()) with check (is_staff());

drop policy if exists "announcement_read_staff" on public.announcement;
create policy "announcement_read_staff" on public.announcement
  for select to authenticated using (is_staff());

drop policy if exists "announcement_write_boss" on public.announcement;
create policy "announcement_write_boss" on public.announcement
  for all to authenticated using (is_boss()) with check (is_boss());

grant select, insert, update, delete on public.todo_item to authenticated;
grant select, insert, update, delete on public.announcement to authenticated;
grant execute on function public.touch_collaboration_record() to authenticated;



-- ============ SOURCE: 26_notifications.sql ============
-- Personal notifications for todo mentions and automatic customer VIP upgrades.

create table if not exists public.notification (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.users(id) on delete cascade,
  type text not null check (type in ('todo_mention', 'customer_vip_upgrade')),
  title text not null,
  content text not null default '',
  reference_type text,
  reference_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_notification_recipient_created
  on public.notification(recipient_id, created_at desc);
create index if not exists idx_notification_unread
  on public.notification(recipient_id, read_at)
  where read_at is null;

alter table public.notification enable row level security;

drop policy if exists "notification_read_self" on public.notification;
create policy "notification_read_self" on public.notification
  for select to authenticated using (recipient_id = auth.uid());

drop policy if exists "notification_update_self" on public.notification;
create policy "notification_update_self" on public.notification
  for update to authenticated using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

grant select, update on public.notification to authenticated;

create or replace function public.notify_todo_mentions()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_recipient_id uuid;
begin
  for v_recipient_id in
    select distinct mentioned_id
    from unnest(coalesce(new.mentioned_user_ids, '{}'::uuid[])) as mentioned_id
    where mentioned_id is distinct from auth.uid()
      and (tg_op = 'INSERT' or not mentioned_id = any(coalesce(old.mentioned_user_ids, '{}'::uuid[])))
  loop
    if exists (select 1 from public.users where id = v_recipient_id and status = 'active') then
      insert into public.notification (recipient_id, type, title, content, reference_type, reference_id)
      values (
        v_recipient_id,
        'todo_mention',
        '你被提及了一条待办',
        format('@%s：%s', coalesce(new.title, '待办'), coalesce(new.content, '')),
        'todo_item',
        new.id
      );
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists todo_item_notify_mentions on public.todo_item;
create trigger todo_item_notify_mentions
after insert or update of mentioned_user_ids on public.todo_item
for each row execute function public.notify_todo_mentions();

-- Extend the existing automatic VIP upgrade trigger with notifications for all staff.
create or replace function public.auto_upgrade_customer_vip()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_level int;
  v_old_level int;
  v_message text;
begin
  if new.total_consumption <= old.total_consumption then
    return new;
  end if;

  select coalesce(max(vip_level), 0)
    into v_level
    from public.vip_upgrade_rule
   where consumption_threshold <= new.total_consumption;

  v_old_level := coalesce(new.vip_level, 0);
  if v_level > v_old_level then
    update public.customer
       set type = 'vip', vip_level = v_level
     where id = new.id;

    insert into public.customer_account_adjustment
      (customer_id, field, amount, before_value, after_value, reason, operator_id)
    values
      (new.id, 'vip_level', v_level - v_old_level, v_old_level, v_level, '累计消费达到 VIP 升级门槛', auth.uid());

    v_message := format('客户「%s」已从 VIP %s 自动升级为 VIP %s。', new.name, v_old_level, v_level);
    insert into public.notification (recipient_id, type, title, content, reference_type, reference_id)
    select id, 'customer_vip_upgrade', '客户 VIP 自动升级', v_message, 'customer', new.id
      from public.users
     where status = 'active';
  end if;

  return new;
end;
$$;

drop trigger if exists customer_auto_upgrade_vip on public.customer;
create trigger customer_auto_upgrade_vip
after update of total_consumption on public.customer
for each row execute function public.auto_upgrade_customer_vip();

revoke all on function public.notify_todo_mentions() from public;
grant execute on function public.notify_todo_mentions() to authenticated;
revoke all on function public.auto_upgrade_customer_vip() from public;
grant execute on function public.auto_upgrade_customer_vip() to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notification') then
      alter publication supabase_realtime add table public.notification;
    end if;
  end if;
end;
$$;



-- ============ SOURCE: 27_notes.sql ============
-- Shared notes: published notes are collaborative, private notes remain visible only to their creator.

create table if not exists public.note (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 1 and 160),
  content text not null default '',
  is_published boolean not null default false,
  created_by uuid not null default auth.uid() references public.users(id),
  updated_by uuid not null default auth.uid() references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_note_visibility_updated
  on public.note(is_published desc, updated_at desc);
create index if not exists idx_note_creator_updated
  on public.note(created_by, updated_at desc);

drop trigger if exists note_touch on public.note;
create trigger note_touch
before update on public.note
for each row execute function public.touch_collaboration_record();

alter table public.note enable row level security;

drop policy if exists "note_read_published_or_own" on public.note;
create policy "note_read_published_or_own" on public.note
  for select to authenticated
  using (is_staff() and (is_published or created_by = auth.uid()));

drop policy if exists "note_create_own" on public.note;
create policy "note_create_own" on public.note
  for insert to authenticated
  with check (is_staff() and created_by = auth.uid());

drop policy if exists "note_update_published_or_own" on public.note;
create policy "note_update_published_or_own" on public.note
  for update to authenticated
  using (is_staff() and (is_published or created_by = auth.uid()))
  with check (is_staff() and (created_by = auth.uid() or is_published));

drop policy if exists "note_delete_own" on public.note;
create policy "note_delete_own" on public.note
  for delete to authenticated
  using (is_staff() and created_by = auth.uid());

grant select, insert, update, delete on public.note to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'note'
    ) then
    alter publication supabase_realtime add table public.note;
  end if;
end;
$$;



-- ============ SOURCE: 28_order_employee_assignment_and_manager_recharge.sql ============
-- Allow orders to be staffed by zero, one, or two employees and updated before audit.
create or replace function public.assign_order_employees(p_order_id uuid, p_employee_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public."order"%rowtype;
  v_employee_id uuid;
begin
  if not public.is_staff() then
    return jsonb_build_object('success', false, 'message', '无权限');
  end if;
  if coalesce(cardinality(p_employee_ids), 0) > 2 then
    return jsonb_build_object('success', false, 'message', '每张订单最多选择两名接单员工');
  end if;
  if cardinality(p_employee_ids) = 2 and p_employee_ids[1] = p_employee_ids[2] then
    return jsonb_build_object('success', false, 'message', '不能重复选择同一名员工');
  end if;

  select * into v_order from public."order" where id = p_order_id for update;
  if not found then
    return jsonb_build_object('success', false, 'message', '订单不存在');
  end if;
  if v_order.audit_status <> 'pending' or v_order.status = 'cancelled' then
    return jsonb_build_object('success', false, 'message', '当前订单状态不允许修改员工');
  end if;

  foreach v_employee_id in array coalesce(p_employee_ids, array[]::uuid[]) loop
    if not exists (select 1 from public.employee where id = v_employee_id and status = 'active') then
      return jsonb_build_object('success', false, 'message', '只能选择在职员工');
    end if;
  end loop;

  delete from public.order_member where order_id = p_order_id;
  insert into public.order_member (order_id, employee_id)
  select p_order_id, unnest(coalesce(p_employee_ids, array[]::uuid[]));

  return jsonb_build_object('success', true, 'message', '接单员工已更新');
end;
$$;

revoke all on function public.assign_order_employees(uuid, uuid[]) from public;
grant execute on function public.assign_order_employees(uuid, uuid[]) to authenticated;

-- Custom recharge is a staff operation: both boss and manager may set amount and bonus.
create or replace function public.recharge_custom(
  p_customer_id uuid,
  p_amount numeric,
  p_bonus numeric,
  p_remark text,
  p_proof_path text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cust public.customer%rowtype;
  v_new_principal numeric(12,2);
  v_new_bonus numeric(12,2);
  v_op uuid := auth.uid();
begin
  if not public.is_staff() then
    return jsonb_build_object('success', false, 'message', '无权限：仅老板或管理员可自定义充值');
  end if;
  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('success', false, 'message', '充值金额必须大于0');
  end if;
  if p_bonus is null or p_bonus < 0 then
    return jsonb_build_object('success', false, 'message', '赠送金额不能为负');
  end if;

  select * into v_cust from public.customer where id = p_customer_id for update;
  if not found then
    return jsonb_build_object('success', false, 'message', '客户不存在');
  end if;

  v_new_principal := v_cust.principal_balance + p_amount;
  v_new_bonus := v_cust.bonus_balance + p_bonus;
  update public.customer
  set principal_balance = v_new_principal, bonus_balance = v_new_bonus
  where id = p_customer_id;

  insert into public.customer_wallet_ledger (
    customer_id, type, amount, principal_after, bonus_after, operator_id, proof_path, remark
  ) values
    (p_customer_id, 'recharge_principal', p_amount, v_new_principal, v_cust.bonus_balance, v_op, p_proof_path, coalesce(p_remark, '自定义充值本金')),
    (p_customer_id, 'recharge_bonus', p_bonus, v_new_principal, v_new_bonus, v_op, p_proof_path, coalesce(p_remark, '自定义充值赠送'));

  return jsonb_build_object('success', true, 'new_balance', v_new_principal + v_new_bonus);
end;
$$;

revoke all on function public.recharge_custom(uuid, numeric, numeric, text, text) from public;
grant execute on function public.recharge_custom(uuid, numeric, numeric, text, text) to authenticated;



-- ============ SOURCE: 29_commission_overrides_and_wallet_adjustments.sql ============
-- Pending commission overrides are kept separate from the audited commission.
alter table public.order_member
  add column if not exists commission_override_amount numeric(12,2),
  add column if not exists commission_override_by uuid references public.users(id),
  add column if not exists commission_override_at timestamptz;

create or replace function public.set_pending_order_commissions(p_order_id uuid, p_commissions jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public."order"%rowtype;
  v_operator uuid := auth.uid();
  v_count int;
begin
  if not public.is_staff() then
    return jsonb_build_object('success', false, 'message', '无权限');
  end if;
  if jsonb_typeof(p_commissions) <> 'array' then
    return jsonb_build_object('success', false, 'message', '提成数据格式不正确');
  end if;

  select * into v_order from public."order" where id = p_order_id for update;
  if not found then
    return jsonb_build_object('success', false, 'message', '订单不存在');
  end if;
  if v_order.status <> 'completed' or v_order.audit_status <> 'pending' then
    return jsonb_build_object('success', false, 'message', '仅已完成且待审核的订单可以临时调整提成');
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_commissions) as item(employee_id uuid, amount numeric)
    where item.employee_id is null or item.amount < 0
  ) then
    return jsonb_build_object('success', false, 'message', '提成员工或金额不正确');
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_commissions) as item(employee_id uuid, amount numeric)
    group by item.employee_id
    having count(*) > 1
  ) then
    return jsonb_build_object('success', false, 'message', '同一员工只能提交一次');
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_commissions) as item(employee_id uuid, amount numeric)
    left join public.order_member member on member.order_id = p_order_id and member.employee_id = item.employee_id
    where member.employee_id is null
  ) then
    return jsonb_build_object('success', false, 'message', '存在不属于该订单的员工');
  end if;

  with changes as (
    select employee_id, amount
    from jsonb_to_recordset(p_commissions) as item(employee_id uuid, amount numeric)
  )
  update public.order_member member
  set commission_override_amount = case when changes.amount is null then null else round(changes.amount, 2) end,
      commission_override_by = case when changes.amount is null then null else v_operator end,
      commission_override_at = case when changes.amount is null then null else now() end,
      commission_amount = coalesce(round(changes.amount, 2), 0)
  from changes
  where member.order_id = p_order_id and member.employee_id = changes.employee_id;

  get diagnostics v_count = row_count;
  return jsonb_build_object('success', true, 'count', v_count);
end;
$$;

revoke all on function public.set_pending_order_commissions(uuid, jsonb) from public;
grant execute on function public.set_pending_order_commissions(uuid, jsonb) to authenticated;

-- Reuse the existing audit calculation, but allow a pending override to replace
-- the calculated amount for the matching employee at the exact moment of audit.
do $$
declare
  v_definition text;
  v_updated_definition text;
begin
  select pg_get_functiondef('public.approve_commission(uuid)'::regprocedure) into v_definition;
  v_updated_definition := replace(
    v_definition,
    'select om.employee_id, e.grade, e.wallet_balance',
    'select om.employee_id, e.grade, e.wallet_balance, om.commission_override_amount'
  );
  v_updated_definition := replace(
    v_updated_definition,
    '    if v_mixed_commission_type then v_snapshot_type := null; end if;',
    '    if v_member.commission_override_amount is not null then v_commission := v_member.commission_override_amount; end if;' || E'\n\n' ||
    '    if v_mixed_commission_type then v_snapshot_type := null; end if;'
  );
  if v_updated_definition = v_definition then
    raise exception 'approve_commission 的提成计算结构未找到，请先确认已执行 20_multi_product_orders.sql';
  end if;
  execute v_updated_definition;
end;
$$;

-- Only the boss can make a direct employee wallet adjustment. Every adjustment
-- writes an immutable wallet ledger entry with a required reason.
create or replace function public.adjust_employee_wallet(p_employee_id uuid, p_amount numeric, p_remark text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee public.employee%rowtype;
  v_new_balance numeric(12,2);
begin
  if not public.is_boss() then
    return jsonb_build_object('success', false, 'message', '无权限：仅老板可调整员工钱包');
  end if;
  if p_amount is null or p_amount = 0 then
    return jsonb_build_object('success', false, 'message', '调整金额不能为零');
  end if;
  if nullif(trim(p_remark), '') is null then
    return jsonb_build_object('success', false, 'message', '请填写调整备注');
  end if;

  select * into v_employee from public.employee where id = p_employee_id for update;
  if not found then
    return jsonb_build_object('success', false, 'message', '员工不存在');
  end if;

  v_new_balance := round(v_employee.wallet_balance + p_amount, 2);
  if v_new_balance < 0 then
    return jsonb_build_object('success', false, 'message', '调整后钱包余额不能小于零');
  end if;

  update public.employee set wallet_balance = v_new_balance where id = p_employee_id;
  insert into public.wallet_ledger (employee_id, type, amount, balance_after, operator_id, remark)
  values (p_employee_id, 'adjust', round(p_amount, 2), v_new_balance, auth.uid(), trim(p_remark));

  return jsonb_build_object('success', true, 'new_balance', v_new_balance);
end;
$$;

revoke all on function public.adjust_employee_wallet(uuid, numeric, text) from public;
grant execute on function public.adjust_employee_wallet(uuid, numeric, text) to authenticated;



-- ============ SOURCE: 30_reject_order_audit.sql ============
-- Restore an accidentally approved order to its completed, pending-audit state.
-- Ledger rows are compensated instead of deleted so the financial history remains traceable.
create or replace function public.reject_order_audit(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public."order"%rowtype;
  v_customer public.customer%rowtype;
  v_member record;
  v_employee public.employee%rowtype;
  v_new_balance numeric(12,2);
  v_operator uuid := auth.uid();
begin
  if not public.is_boss() then
    return jsonb_build_object('success', false, 'message', '无权限：仅老板可撤销审核');
  end if;

  select * into v_order from public."order" where id = p_order_id for update;
  if not found then
    return jsonb_build_object('success', false, 'message', '订单不存在');
  end if;
  if v_order.status <> 'completed' or v_order.audit_status <> 'approved' then
    return jsonb_build_object('success', false, 'message', '仅已完成且已审核的订单可以撤销审核');
  end if;

  select * into v_customer from public.customer where id = v_order.customer_id for update;
  if not found then
    return jsonb_build_object('success', false, 'message', '订单客户不存在');
  end if;

  -- Reverse the commission credit with a compensating ledger record per employee.
  for v_member in
    select employee_id, commission_amount, commission_override_amount
    from public.order_member
    where order_id = p_order_id
  loop
    if coalesce(v_member.commission_amount, 0) = 0 then
      continue;
    end if;

    select * into v_employee from public.employee where id = v_member.employee_id for update;
    if not found then
      return jsonb_build_object('success', false, 'message', '参与员工不存在');
    end if;

    v_new_balance := v_employee.wallet_balance - v_member.commission_amount;
    update public.employee
    set wallet_balance = v_new_balance,
        is_debt = case when v_new_balance < 0 then true else is_debt end,
        is_bad_debt = case when status = 'resigned' and v_new_balance < 0 then true else is_bad_debt end
    where id = v_employee.id;

    insert into public.wallet_ledger (employee_id, type, amount, balance_after, order_id, operator_id, remark)
    values (v_employee.id, 'refund_deduct', -v_member.commission_amount, v_new_balance, p_order_id, v_operator, '撤销订单审核-提成冲回');
  end loop;

  -- The original payment remains held as pending, exactly as it was before approval.
  update public.customer
  set pending_balance = pending_balance + v_order.paid_amount,
      total_consumption = greatest(total_consumption - v_order.paid_amount, 0)
  where id = v_customer.id;
  insert into public.customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, order_id, operator_id, remark)
  values (v_customer.id, 'consume_from_pending', 0, v_customer.principal_balance, v_customer.bonus_balance, p_order_id, v_operator, '撤销订单审核-消费恢复为预收');

  update public.order_member
  set grade_snapshot = null,
      base_amount = null,
      applied_rate = null,
      commission_amount = coalesce(commission_override_amount, 0),
      commission_type_snapshot = null
  where order_id = p_order_id;

  update public."order"
  set audit_status = 'pending',
      total_commission = 0,
      gross_profit = 0,
      auditor_id = null,
      audited_at = null,
      updated_at = now()
  where id = p_order_id;

  return jsonb_build_object('success', true, 'message', '订单已恢复为待审核');
end;
$$;

revoke all on function public.reject_order_audit(uuid) from public;
grant execute on function public.reject_order_audit(uuid) to authenticated;



-- ============ SOURCE: 31_refund_before_audit.sql ============
-- Allow orders to be refunded before commission approval.
--
-- Pending-audit refunds reverse the original payment hold without touching
-- employee commission balances. Approved refunds first roll the order back to
-- the pending-audit state so already-paid commissions are compensated through
-- reject_order_audit, then apply the selected refund method.
create or replace function public.refund_order(
  p_order_id uuid,
  p_refund_method text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public."order"%rowtype;
  v_customer public.customer%rowtype;
  v_reversal jsonb;
  v_operator uuid := auth.uid();
  v_principal_refund numeric(12,2) := 0;
  v_bonus_refund numeric(12,2) := 0;
  v_wallet_refund numeric(12,2) := 0;
  v_pending_before numeric(12,2);
  v_was_approved boolean := false;
begin
  if not public.is_staff() then
    return jsonb_build_object('success', false, 'message', 'Only authenticated business staff can refund orders');
  end if;

  if p_refund_method not in ('wallet', 'cash') then
    return jsonb_build_object('success', false, 'message', 'Unsupported refund method');
  end if;

  select *
  into v_order
  from public."order"
  where id = p_order_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'message', 'Order not found');
  end if;

  if v_order.status = 'cancelled' or v_order.audit_status = 'rejected' then
    return jsonb_build_object('success', false, 'message', 'Order has already been refunded or cancelled');
  end if;

  if v_order.customer_id is null then
    return jsonb_build_object('success', false, 'message', 'Order has no customer account');
  end if;

  -- Lock and validate the customer before any approved-order reversal. A
  -- returned JSON error does not roll back writes already made in this
  -- function, so this check must happen before reject_order_audit.
  select *
  into v_customer
  from public.customer
  where id = v_order.customer_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'message', 'Order customer not found');
  end if;

  if v_order.audit_status = 'approved' then
    v_was_approved := true;
    if not public.is_boss() then
      return jsonb_build_object('success', false, 'message', 'Only the boss can refund an approved order');
    end if;

    if v_order.status <> 'completed' then
      return jsonb_build_object('success', false, 'message', 'Only completed approved orders can be refunded');
    end if;

    -- Validate the data needed by the later refund step before reversing the
    -- approval. A returned JSON error does not roll back writes in a function.
    if p_refund_method = 'wallet' and v_order.pay_method = 'wallet' then
      select
        coalesce(sum(case when type = 'consume_principal' then -amount else 0 end), 0),
        coalesce(sum(case when type = 'consume_bonus' then -amount else 0 end), 0)
      into v_principal_refund, v_bonus_refund
      from public.customer_wallet_ledger
      where order_id = p_order_id
        and type in ('consume_principal', 'consume_bonus');

      if v_principal_refund + v_bonus_refund <> v_order.paid_amount then
        return jsonb_build_object('success', false, 'message', 'Wallet refund ledger does not match the order amount');
      end if;
    end if;

    -- reject_order_audit updates commission rows one by one. Detect a broken
    -- employee reference before invoking it, so the later refund cannot leave
    -- an approved order partially reversed.
    if exists (
      select 1
      from public.order_member om
      left join public.employee e on e.id = om.employee_id
      where om.order_id = p_order_id
        and coalesce(om.commission_amount, 0) <> 0
        and e.id is null
    ) then
      return jsonb_build_object('success', false, 'message', 'Order commission data is incomplete');
    end if;

    v_reversal := public.reject_order_audit(p_order_id);
    if coalesce(v_reversal->>'success', 'false') <> 'true' then
      return v_reversal;
    end if;

    select *
    into v_order
    from public."order"
    where id = p_order_id
    for update;
  elsif v_order.audit_status <> 'pending' then
    return jsonb_build_object('success', false, 'message', 'Only pending-audit or approved orders can be refunded');
  end if;

  if v_order.status not in ('booking', 'in_progress', 'completed') then
    return jsonb_build_object('success', false, 'message', 'This order status cannot be refunded');
  end if;

  -- Before approval, return the payment by the original method. This keeps a
  -- wallet hold from being converted into a cash refund accidentally.
  if v_was_approved = false then
    if p_refund_method <> v_order.pay_method::text then
      return jsonb_build_object('success', false, 'message', 'Pending-audit orders must be refunded by the original payment method');
    end if;
  end if;

  v_pending_before := v_customer.pending_balance;
  if v_was_approved = false then
    if v_pending_before < v_order.paid_amount then
      return jsonb_build_object('success', false, 'message', 'Customer pending balance is smaller than the order amount');
    end if;
  end if;

  if p_refund_method = 'wallet' then
    if v_order.pay_method = 'wallet' then
      select
        coalesce(sum(case when type = 'consume_principal' then -amount else 0 end), 0),
        coalesce(sum(case when type = 'consume_bonus' then -amount else 0 end), 0)
      into v_principal_refund, v_bonus_refund
      from public.customer_wallet_ledger
      where order_id = p_order_id
        and type in ('consume_principal', 'consume_bonus');

      v_wallet_refund := v_principal_refund + v_bonus_refund;
      if v_wallet_refund <> v_order.paid_amount then
        return jsonb_build_object('success', false, 'message', 'Wallet refund ledger does not match the order amount');
      end if;
    else
      -- A cash order refunded to wallet is credited back to principal.
      v_principal_refund := v_order.paid_amount;
      v_wallet_refund := v_order.paid_amount;
    end if;

    update public.customer
    set principal_balance = principal_balance + v_principal_refund,
        bonus_balance = bonus_balance + v_bonus_refund,
        pending_balance = pending_balance - v_order.paid_amount
    where id = v_customer.id;

    insert into public.customer_wallet_ledger (
      customer_id, type, amount, principal_after, bonus_after, order_id, operator_id, remark
    )
    select
      v_customer.id,
      'refund',
      v_wallet_refund,
      v_customer.principal_balance + v_principal_refund,
      v_customer.bonus_balance + v_bonus_refund,
      p_order_id,
      v_operator,
      'Order refund before final settlement';
  else
    update public.customer
    set pending_balance = pending_balance - v_order.paid_amount
    where id = v_customer.id;

    insert into public.customer_wallet_ledger (
      customer_id, type, amount, principal_after, bonus_after, order_id, operator_id, remark
    )
    values (
      v_customer.id,
      'cash_refund',
      -v_order.paid_amount,
      v_customer.principal_balance,
      v_customer.bonus_balance,
      p_order_id,
      v_operator,
      'Order cash refund'
    );
  end if;

  -- No commission is payable after a refund. Keep the override fields for
  -- audit history, but clear the computed amount used by deletion guards.
  update public.order_member
  set grade_snapshot = null,
      base_amount = null,
      applied_rate = null,
      commission_amount = 0,
      commission_type_snapshot = null
  where order_id = p_order_id;

  update public."order"
  set status = 'cancelled',
      audit_status = 'rejected',
      pending_amount = 0,
      total_commission = 0,
      gross_profit = 0,
      auditor_id = null,
      audited_at = null,
      updated_at = now()
  where id = p_order_id;

  return jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'refund_method', p_refund_method,
    'refund_amount', v_order.paid_amount
  );
end;
$$;

revoke all on function public.refund_order(uuid, text) from public;
grant execute on function public.refund_order(uuid, text) to authenticated;
