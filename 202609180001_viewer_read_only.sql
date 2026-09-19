-- Read-only viewer access. The role is stored in app_metadata because users
-- cannot change that claim themselves.

drop policy if exists "Users manage their medications" on public.medications;
drop policy if exists "Users manage their routines" on public.medication_routines;
drop policy if exists "Users link their medications" on public.routine_medications;
drop policy if exists "Users manage their intake history" on public.medication_intakes;

create policy "Users and viewers can read medications"
on public.medications for select to authenticated
using (
  (select auth.uid()) = user_id
  or (
    (select auth.jwt() -> 'app_metadata' ->> 'role') = 'viewer'
    and (select auth.jwt() -> 'app_metadata' ->> 'owner_user_id') = user_id::text
  )
);
create policy "Users can insert medications"
on public.medications for insert to authenticated
with check ((select auth.uid()) = user_id and coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'viewer');
create policy "Users can update medications"
on public.medications for update to authenticated
using ((select auth.uid()) = user_id and coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'viewer')
with check ((select auth.uid()) = user_id and coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'viewer');
create policy "Users can delete medications"
on public.medications for delete to authenticated
using ((select auth.uid()) = user_id and coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'viewer');

create policy "Users and viewers can read routines"
on public.medication_routines for select to authenticated
using (
  (select auth.uid()) = user_id
  or (
    (select auth.jwt() -> 'app_metadata' ->> 'role') = 'viewer'
    and (select auth.jwt() -> 'app_metadata' ->> 'owner_user_id') = user_id::text
  )
);
create policy "Users can insert routines"
on public.medication_routines for insert to authenticated
with check ((select auth.uid()) = user_id and coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'viewer');
create policy "Users can update routines"
on public.medication_routines for update to authenticated
using ((select auth.uid()) = user_id and coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'viewer')
with check ((select auth.uid()) = user_id and coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'viewer');
create policy "Users can delete routines"
on public.medication_routines for delete to authenticated
using ((select auth.uid()) = user_id and coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'viewer');

create policy "Users and viewers can read routine medications"
on public.routine_medications for select to authenticated
using (
  (select auth.uid()) = user_id
  or (
    (select auth.jwt() -> 'app_metadata' ->> 'role') = 'viewer'
    and (select auth.jwt() -> 'app_metadata' ->> 'owner_user_id') = user_id::text
  )
);
create policy "Users can insert routine medications"
on public.routine_medications for insert to authenticated
with check ((select auth.uid()) = user_id and coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'viewer');
create policy "Users can update routine medications"
on public.routine_medications for update to authenticated
using ((select auth.uid()) = user_id and coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'viewer')
with check ((select auth.uid()) = user_id and coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'viewer');
create policy "Users can delete routine medications"
on public.routine_medications for delete to authenticated
using ((select auth.uid()) = user_id and coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'viewer');

create policy "Users and viewers can read intake history"
on public.medication_intakes for select to authenticated
using (
  (select auth.uid()) = user_id
  or (
    (select auth.jwt() -> 'app_metadata' ->> 'role') = 'viewer'
    and (select auth.jwt() -> 'app_metadata' ->> 'owner_user_id') = user_id::text
  )
);
create policy "Users can insert intake history"
on public.medication_intakes for insert to authenticated
with check ((select auth.uid()) = user_id and coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'viewer');
create policy "Users can update intake history"
on public.medication_intakes for update to authenticated
using ((select auth.uid()) = user_id and coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'viewer')
with check ((select auth.uid()) = user_id and coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'viewer');
create policy "Users can delete intake history"
on public.medication_intakes for delete to authenticated
using ((select auth.uid()) = user_id and coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'viewer');
