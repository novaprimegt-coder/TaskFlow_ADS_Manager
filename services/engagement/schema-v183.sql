-- TaskFlow ADS V183 · Diseño preparado. NO EJECUTADO EN PRODUCCIÓN.
-- Requiere aprobación de seguridad, pruebas y orden LANZAR.
-- Edad y consentimiento publicitario principal se guardan en taskflow_ads_user_profiles.
-- No hay GPS, IP, identificadores de dispositivo, historial de tareas o anuncios visitados.
BEGIN;

CREATE TABLE IF NOT EXISTS public.taskflow_ads_engagement_preferences (
 uid text PRIMARY KEY CHECK (uid ~ '^[A-Za-z0-9_-]{3,128}$'),
 country text NOT NULL DEFAULT '',
 region text NOT NULL DEFAULT '',
 residence_consent boolean NOT NULL DEFAULT false,
 activity_consent boolean NOT NULL DEFAULT false,
 residence_consented_at timestamptz,
 activity_consented_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT taskflow_ads_region_coarse CHECK (
  (NOT residence_consent AND country='' AND region='') OR
  (residence_consent AND country ~ '^[A-Z]{2}$'
   AND region ~ '^[[:alpha:] .-]{2,64}$')
 )
);

CREATE TABLE IF NOT EXISTS public.taskflow_ads_engagement_daily (
 uid text NOT NULL CHECK (uid ~ '^[A-Za-z0-9_-]{3,128}$'),
 day_utc date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
 time_block text NOT NULL CHECK(time_block IN ('night','morning','afternoon','evening')),
 visible_seconds integer NOT NULL DEFAULT 0 CHECK (visible_seconds BETWEEN 0 AND 64800),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (uid,day_utc,time_block)
);

CREATE TABLE IF NOT EXISTS public.taskflow_ads_engagement_receipts (
 uid text NOT NULL CHECK (uid ~ '^[A-Za-z0-9_-]{3,128}$'),
 event_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(uid,event_id)
);

CREATE INDEX IF NOT EXISTS taskflow_ads_engagement_recent_idx
 ON public.taskflow_ads_engagement_daily(uid,day_utc DESC);
CREATE INDEX IF NOT EXISTS taskflow_ads_engagement_receipts_gc_idx
 ON public.taskflow_ads_engagement_receipts(created_at);

ALTER TABLE public.taskflow_ads_engagement_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.taskflow_ads_engagement_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.taskflow_ads_engagement_receipts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.taskflow_ads_engagement_preferences FROM PUBLIC,anon,authenticated;
REVOKE ALL ON TABLE public.taskflow_ads_engagement_daily FROM PUBLIC,anon,authenticated;
REVOKE ALL ON TABLE public.taskflow_ads_engagement_receipts FROM PUBLIC,anon,authenticated;

-- Sólo el servicio privado con JWT Firebase verificado manipula estas tablas.
GRANT SELECT,INSERT,UPDATE,DELETE ON public.taskflow_ads_engagement_preferences TO service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.taskflow_ads_engagement_daily TO service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.taskflow_ads_engagement_receipts TO service_role;

CREATE OR REPLACE FUNCTION public.taskflow_ads_engagement_record(
 p_uid text,p_event_id uuid,p_seconds integer,p_block text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $$
DECLARE
 added integer:=0;
BEGIN
 IF p_uid !~ '^[A-Za-z0-9_-]{3,128}$'
    OR p_event_id IS NULL
    OR p_seconds NOT BETWEEN 30 AND 90
    OR p_block NOT IN ('night','morning','afternoon','evening')
 THEN RETURN false; END IF;

 -- Verificar EN CADA EVENTO, no confiar en permisos del cliente.
 IF NOT EXISTS(
  SELECT 1 FROM public.taskflow_ads_user_profiles p
  JOIN public.taskflow_ads_engagement_preferences e ON e.uid=p.uid
  WHERE p.uid=p_uid AND p.declared_age>=18 AND p.profiling_consent=true
    AND p.age_declared_at>now()-interval '365 days'
    AND e.activity_consent=true
 ) THEN RETURN false; END IF;

 INSERT INTO public.taskflow_ads_engagement_receipts(uid,event_id)
 VALUES(p_uid,p_event_id) ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS added=ROW_COUNT;
 IF added=0 THEN RETURN true; END IF; -- reintento idempotente

 INSERT INTO public.taskflow_ads_engagement_daily(uid,day_utc,time_block,visible_seconds)
 VALUES(p_uid,(now() AT TIME ZONE 'UTC')::date,p_block,p_seconds)
 ON CONFLICT(uid,day_utc,time_block) DO UPDATE SET
  visible_seconds=least(64800,public.taskflow_ads_engagement_daily.visible_seconds+excluded.visible_seconds),
  updated_at=now();
 RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.taskflow_ads_engagement_record(text,uuid,integer,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.taskflow_ads_engagement_record(text,uuid,integer,text)
 TO service_role;

-- Si el usuario quita el permiso publicitario principal o pasa a ser menor,
-- se eliminan también los datos adicionales. Nunca reactivar automáticamente.
CREATE OR REPLACE FUNCTION public.taskflow_ads_engagement_consent_sync()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $$
DECLARE target_uid text;
BEGIN
 target_uid=CASE WHEN TG_OP='DELETE' THEN OLD.uid ELSE NEW.uid END;
 IF TG_OP='DELETE'
    OR NEW.profiling_consent IS DISTINCT FROM true
    OR NEW.declared_age < 18
 THEN
  DELETE FROM public.taskflow_ads_engagement_receipts WHERE uid=target_uid;
  DELETE FROM public.taskflow_ads_engagement_daily WHERE uid=target_uid;
  DELETE FROM public.taskflow_ads_engagement_preferences WHERE uid=target_uid;
 END IF;
 RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.taskflow_ads_engagement_consent_sync()
 FROM PUBLIC,anon,authenticated;

DROP TRIGGER IF EXISTS taskflow_ads_engagement_consent_sync_trigger
 ON public.taskflow_ads_user_profiles;
CREATE TRIGGER taskflow_ads_engagement_consent_sync_trigger
 AFTER UPDATE OF profiling_consent,declared_age OR DELETE
 ON public.taskflow_ads_user_profiles
 FOR EACH ROW EXECUTE FUNCTION public.taskflow_ads_engagement_consent_sync();

CREATE OR REPLACE FUNCTION public.taskflow_ads_engagement_cleanup()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $$
DECLARE removed integer:=0,part integer:=0;
BEGIN
 DELETE FROM public.taskflow_ads_engagement_daily
  WHERE day_utc < (now() AT TIME ZONE 'UTC')::date-90;
 GET DIAGNOSTICS part=ROW_COUNT;removed=removed+part;
 DELETE FROM public.taskflow_ads_engagement_receipts
  WHERE created_at < now()-interval '2 days';
 GET DIAGNOSTICS part=ROW_COUNT;removed=removed+part;
 RETURN removed;
END $$;
REVOKE ALL ON FUNCTION public.taskflow_ads_engagement_cleanup()
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.taskflow_ads_engagement_cleanup()
 TO service_role;

COMMIT;

-- OBLIGATORIO ANTES DEL LANZAMIENTO:
-- Programar diariamente SELECT public.taskflow_ads_engagement_cleanup()
-- mediante Supabase Cron o servicio programado equivalente.
-- No habilitar registro de actividad si no se verifica la ejecución diaria de limpieza.
-- Los anunciantes NO acceden a estas tablas, ni por Data API ni por Edge Function.
