-- TaskFlow ADS · Métricas de clics por edad declarada V1 (PREPARADO, NO APLICADO).
-- Únicamente TaskFlow ADS; no modifica identidad ni historial de otros módulos.
-- El almacenamiento depende de consentimiento adulto confirmado por el servidor.
-- No se reconstruyen edades anteriores ni se infieren desde segmentación.
BEGIN;

ALTER TABLE public.taskflow_ads_delivery_selections
 ADD COLUMN IF NOT EXISTS click_age smallint;

-- Restringe edades agregables a adultos. Los eventos sin consentimiento quedan NULL.
DO $$
BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM pg_constraint
  WHERE conname='taskflow_ads_selections_click_age_valid'
   AND conrelid='public.taskflow_ads_delivery_selections'::regclass
 ) THEN
  ALTER TABLE public.taskflow_ads_delivery_selections
   ADD CONSTRAINT taskflow_ads_selections_click_age_valid
   CHECK (click_age IS NULL OR click_age BETWEEN 18 AND 120);
 END IF;
END $$;

CREATE INDEX IF NOT EXISTS taskflow_ads_click_age_rollup_idx
 ON public.taskflow_ads_delivery_selections (campaign_id,creative_id,click_age,click_at)
 WHERE click_at IS NOT NULL AND click_age IS NOT NULL;

-- Solo recuentos de al menos cinco clics por edad y anuncio. Ni UID, ni
-- identidades, ni sesión ni eventos individuales se exponen al anunciante.
CREATE OR REPLACE FUNCTION public.taskflow_ads_click_age_counts(
 p_ids text[], p_since timestamp with time zone
)
RETURNS TABLE(campaign_id text,creative_id text,declared_age integer,clicks bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path='pg_catalog','public'
AS $fn$
 SELECT s.campaign_id,s.creative_id,s.click_age::integer AS declared_age,
        count(*)::bigint AS clicks
 FROM public.taskflow_ads_delivery_selections AS s
 WHERE p_ids IS NOT NULL
   AND cardinality(p_ids) BETWEEN 1 AND 12
   AND NOT EXISTS (
    SELECT 1 FROM unnest(p_ids) AS r(id)
    WHERE r.id !~ '^[A-Za-z0-9_-]{3,128}$'
   )
   AND p_since IS NOT NULL
   AND p_since BETWEEN now()-interval '90 days' AND now()
   AND s.campaign_id=ANY(p_ids)
   AND s.click_at>=p_since
   AND s.click_age BETWEEN 18 AND 120
 GROUP BY s.campaign_id,s.creative_id,s.click_age
 HAVING count(*)>=5;
$fn$;

REVOKE ALL ON FUNCTION public.taskflow_ads_click_age_counts(text[],timestamptz)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.taskflow_ads_click_age_counts(text[],timestamptz)
 TO service_role;
COMMIT;

-- Reversión controlada si esta función nunca fue aplicada antes:
-- DROP FUNCTION IF EXISTS public.taskflow_ads_click_age_counts(text[],timestamptz);
-- DROP INDEX IF EXISTS public.taskflow_ads_click_age_rollup_idx;
-- ALTER TABLE public.taskflow_ads_delivery_selections DROP CONSTRAINT IF EXISTS taskflow_ads_selections_click_age_valid;
-- ALTER TABLE public.taskflow_ads_delivery_selections DROP COLUMN IF EXISTS click_age;
-- No ejecutar la reversión después de registrar edades reales sin revisar impacto.
