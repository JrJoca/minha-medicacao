create table public.medications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  dosage text not null,
  reference_url text,
  created_at timestamptz not null default now(),
  unique (id, user_id)
);

create table public.medication_routines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  period_description text not null,
  has_no_end_date boolean not null default false,
  duration_value integer check (duration_value is null or duration_value > 0),
  duration_unit text check (duration_unit is null or duration_unit in ('days','weeks')),
  current_day integer not null default 1 check (current_day > 0),
  total_days integer,
  constraint medication_routines_duration_check check (
    (has_no_end_date and duration_value is null and duration_unit is null and total_days is null)
    or
    (not has_no_end_date and duration_value > 0 and duration_unit is not null and total_days > 0 and current_day <= total_days)
  ),
  scheduled_time time not null,
  deadline_time time not null,
  reminders_enabled boolean not null default true,
  status text not null default 'active' check (status in ('active','paused')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create table public.routine_medications (
  user_id uuid not null references auth.users(id) on delete cascade,
  routine_id uuid not null,
  medication_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (routine_id, medication_id),
  foreign key (routine_id, user_id) references public.medication_routines(id, user_id) on delete cascade,
  foreign key (medication_id, user_id) references public.medications(id, user_id) on delete cascade
);

create table public.medication_intakes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  routine_id uuid not null,
  taken_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  foreign key (routine_id, user_id) references public.medication_routines(id, user_id) on delete cascade
);

alter table public.medications enable row level security;
alter table public.medication_routines enable row level security;
alter table public.routine_medications enable row level security;
alter table public.medication_intakes enable row level security;

grant select,insert,update,delete on public.medications to authenticated;
grant select,insert,update,delete on public.medication_routines to authenticated;
grant select,insert,update,delete on public.routine_medications to authenticated;
grant select,insert,update,delete on public.medication_intakes to authenticated;

create policy "Users manage their medications" on public.medications for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy "Users manage their routines" on public.medication_routines for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy "Users link their medications" on public.routine_medications for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy "Users manage their intake history" on public.medication_intakes for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);

create index medications_user_id_idx on public.medications(user_id);
create index medication_routines_user_id_idx on public.medication_routines(user_id);
create index routine_medications_user_id_idx on public.routine_medications(user_id);
create index medication_intakes_user_routine_idx on public.medication_intakes(user_id,routine_id,taken_at desc);
