-- ============================================================
-- 模块：schema.sql
-- 内容：基础结构与数据定义：扩展、15 枚举、25 张表 DDL、索引、约束、数据回填
-- 来源：ALL_IN_ONE.sql 按业务域自动切分（2026-08-01）
-- 说明：阅读参考用；完整可执行版见 ALL_IN_ONE.sql
-- ============================================================

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
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  password_hash text not null,
  name text not null,
  role user_role not null default 'manager',
  status user_status not null default 'active',
  created_at timestamptz not null default now()
);
create table if not exists grade_commission_rule (
  id uuid primary key default gen_random_uuid(),
  grade int not null unique,
  rate numeric(6,4) not null check (rate >= 0 and rate <= 1),
  created_at timestamptz not null default now()
);
create table if not exists vip_discount_rule (
  id uuid primary key default gen_random_uuid(),
  vip_level int not null,
  category text not null,
  discount numeric(4,2) not null check (discount > 0 and discount <= 1),
  unique (vip_level, category),
  created_at timestamptz not null default now()
);
create table if not exists vip_upgrade_rule (
  id uuid primary key default gen_random_uuid(),
  vip_level int not null unique,
  consumption_threshold numeric(12,2) not null check (consumption_threshold >= 0),
  created_at timestamptz not null default now()
);
create table if not exists recharge_package (
  id uuid primary key default gen_random_uuid(),
  amount numeric(12,2) not null check (amount > 0),
  bonus numeric(12,2) not null default 0 check (bonus >= 0),
  status package_status not null default 'enabled',
  created_at timestamptz not null default now()
);
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
alter table wallet_ledger add constraint fk_wallet_ledger_order
  foreign key (order_id) references "order"(id) on delete set null;
alter table customer_wallet_ledger add constraint fk_cwledger_order
  foreign key (order_id) references "order"(id) on delete set null;
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
create table if not exists payout (
  id uuid primary key default gen_random_uuid(),
  batch_no text not null,
  operator_id uuid references users(id),
  total_amount numeric(12,2) not null default 0,
  detail_count int not null default 0,
  status payout_status not null default 'processing',
  created_at timestamptz not null default now()
);
create index if not exists idx_payout_operator on payout(operator_id);
alter table wallet_ledger add constraint fk_wallet_ledger_payout
  foreign key (payout_id) references payout(id) on delete set null;
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
do $$ begin
  create type gender as enum ('male', 'female', 'other');
exception when duplicate_object then null; end $$;
alter table public.employee add column if not exists nickname text not null default '';
alter table public.employee add column if not exists gender gender;
alter table public.employee add column if not exists alipay_account text;
alter table public.employee add column if not exists bank_name text;
alter table public.employee add column if not exists deposit numeric(12,2) not null default 0 check (deposit >= 0);
alter table public.employee add column if not exists wechat_id text;
alter table public.employee add column if not exists remark text;
alter table public.employee add column if not exists bio text;
alter type customer_ledger_type add value if not exists 'consume_from_pending';
alter type customer_ledger_type add value if not exists 'cash_received';
alter type customer_ledger_type add value if not exists 'cash_refund';
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
alter table "order" add column if not exists proof_path text;
alter table customer_wallet_ledger add column if not exists proof_path text;
alter table users add column if not exists avatar_path text;
alter table employee add column if not exists avatar_path text;
alter table customer add column if not exists avatar_path text;
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
create table if not exists public.system_setting (
  key text primary key,
  value text,
  updated_by uuid references public.users(id),
  updated_at timestamptz not null default now()
);
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
grant select, insert, update, delete on public.order_item to authenticated;
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
grant select, insert, update, delete on public.todo_item to authenticated;
grant select, insert, update, delete on public.announcement to authenticated;
grant execute on function public.touch_collaboration_record() to authenticated;
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
grant select, update on public.notification to authenticated;
revoke all on function public.notify_todo_mentions() from public;
grant execute on function public.notify_todo_mentions() to authenticated;
revoke all on function public.auto_upgrade_customer_vip() from public;
grant execute on function public.auto_upgrade_customer_vip() to authenticated;
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
grant select, insert, update, delete on public.note to authenticated;
alter table public.order_member
  add column if not exists commission_override_amount numeric(12,2),
  add column if not exists commission_override_by uuid references public.users(id),
  add column if not exists commission_override_at timestamptz;