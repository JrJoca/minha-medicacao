-- Usar somente antes de habilitar escritas no Neon; nunca voltar ignorando deltas.
BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.medications, public.medication_routines,
  public.routine_medications, public.medication_intakes IN SHARE ROW EXCLUSIVE MODE;
DROP TRIGGER medication_neon_cutover ON public.medications;
DROP TRIGGER medication_neon_cutover ON public.medication_routines;
DROP TRIGGER medication_neon_cutover ON public.routine_medications;
DROP TRIGGER medication_neon_cutover ON public.medication_intakes;
DROP FUNCTION medication_cutover_private.reject_write();
DROP TABLE medication_cutover_private.control;
DROP SCHEMA medication_cutover_private;
COMMIT;
