-- TaskFlow ADS · analítica opcional de adultos V1. PREPARADA, NO APLICADA.
-- Almacenamiento privado por usuario autenticado, sin IP, GPS ni textos de rutinas.
-- Las cuentas sin consentimiento no producen filas de actividad.
BEGIN;
CREATE TABLE IF NOT EXISTS public.taskflow_ads_audience_optins (
 uid text PRIMARY KEY,
 activity_consent boolean NOT NULL DEFAULT false,
 area_consent boolean NOT NULL DEFAULT false,
 residence_country varchar(2),
 residence_region varchar(80),
 consented_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT taskflow_ads_audience_optin_country_chk CHECK
  (residence_country IS NULL OR residence_country ~ '^[A-Z]{2}$'),
 CONSTRAINT taskflow_ads_audience_optin_region_chk CHECK
  (residence_region IS NULL OR char_length(residence_region) BETWEEN 2 AND 80),
 CONSTRAINT taskflow_ads_audience_optin_area_chk CHECK
  (area_consent OR (residence_country IS NULL AND residence_region IS NULL))
);
ALTER TABLE public.taskflow_ads_audience_optins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.taskflow_ads_audience_optins FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.taskflow_ads_audience_optins TO service_role;

CREATE TABLE IF NOT EXISTS public.taskflow_ads_audience_daily_activity (
 uid text NOT NULL REFERENCES public.taskflow_ads_audience_optins(uid) ON DELETE CASCADE,
 activity_day date NOT NULL,
 active_seconds integer NOT NULL DEFAULT 0
  CHECK(active_seconds BETWEEN 0 AND 43200),
 session_count integer NOT NULL DEFAULT 0
  CHECK(session_count BETWEEN 0 AND 1440),
 last_minute_bucket bigint NOT NULL,
 last_session_digest char(64) NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(uid,activity_day)
);
CREATE INDEX IF NOT EXISTS taskflow_ads_audience_daily_day_idx
 ON public.taskflow_ads_audience_daily_activity(activity_day);
ALTER TABLE public.taskflow_ads_audience_daily_activity ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.taskflow_ads_audience_daily_activity FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.taskflow_ads_audience_daily_activity TO service_role;

-- Dedupe transaccional por usuario + minuto UTC, sin confiar en cronómetros del cliente.
CREATE OR REPLACE FUNCTION public.taskflow_ads_audience_heartbeat(
 p_uid text,p_session_digest text
) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp
AS $function$
DECLARE
 v_minute bigint := floor(extract(epoch from statement_timestamp())/60)::bigint;
 v_day date := (statement_timestamp() AT TIME ZONE 'UTC')::date;
 v_updated_uid text;
BEGIN
 IF p_uid IS NULL OR p_uid !~ '^[A-Za-z0-9_-]{3,128}$'
   OR p_session_digest IS NULL OR p_session_digest !~ '^[a-f0-9]{64}$' THEN
   RETURN false;
 END IF;
 -- Edad declarada no es identidad verificada. Se excluye edad no disponible
 -- y todo menor de 18 años; consentimiento reciente y explícito obligatorio.
 IF NOT EXISTS (
  SELECT 1 FROM public.taskflow_ads_audience_optins o
  JOIN public.taskflow_ads_user_profiles p ON p.uid=o.uid
  WHERE o.uid=p_uid
    AND o.activity_consent=true AND o.consented_at IS NOT NULL
    AND p.declared_age BETWEEN 18 AND 120
    AND p.age_declared_at > statement_timestamp()-interval '365 days'
 ) THEN RETURN false;
 END IF;
 INSERT INTO public.taskflow_ads_audience_daily_activity
  (uid,activity_day,active_seconds,session_count,last_minute_bucket,last_session_digest,updated_at)
 VALUES (p_uid,v_day,60,1,v_minute,p_session_digest,statement_timestamp())
 ON CONFLICT(uid,activity_day) DO UPDATE SET
  active_seconds=LEAST(43200, public.taskflow_ads_audience_daily_activity.active_seconds+60),
  session_count=LEAST(1440,public.taskflow_ads_audience_daily_activity.session_count+
   CASE WHEN public.taskflow_ads_audience_daily_activity.last_session_digest
               IS DISTINCT FROM EXCLUDED.last_session_digest
    AND EXCLUDED.last_minute_bucket-public.taskflow_ads_audience_daily_activity.last_minute_bucket >= 15
   THEN 1 ELSE 0 END),
  last_minute_bucket=EXCLUDED.last_minute_bucket,
  last_session_digest=EXCLUDED.last_session_digest,
  updated_at=EXCLUDED.updated_at
 WHERE public.taskflow_ads_audience_daily_activity.last_minute_bucket < EXCLUDED.last_minute_bucket
  AND public.taskflow_ads_audience_daily_activity.active_seconds < 43200
 RETURNING uid INTO v_updated_uid;
 RETURN v_updated_uid IS NOT NULL;
END
$function$;
REVOKE ALL ON FUNCTION public.taskflow_ads_audience_heartbeat(text,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.taskflow_ads_audience_heartbeat(text,text)
 TO service_role;

-- Reporte agregado para una ruta autenticada del administrador (nunca directo al cliente).
-- No devuelve identificadores personales. Cohortes inferiores a 5 quedan ocultas.
CREATE OR REPLACE FUNCTION public.taskflow_ads_audience_report()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp
AS $function$
WITH active_per_user AS (
 SELECT uid,SUM(active_seconds)::bigint AS seconds,SUM(session_count)::bigint AS sessions
 FROM public.taskflow_ads_audience_daily_activity
 WHERE activity_day >= (current_timestamp AT TIME ZONE 'UTC')::date - 29
 GROUP BY uid
),eligible AS (
 SELECT a.*,p.declared_age,o.area_consent,o.residence_country,o.residence_region
 FROM active_per_user a
 JOIN public.taskflow_ads_audience_optins o ON o.uid=a.uid AND o.activity_consent
 JOIN public.taskflow_ads_user_profiles p ON p.uid=a.uid AND p.declared_age BETWEEN 18 AND 120
 WHERE p.age_declared_at>now()-interval '365 days'
),age_cohorts AS (
 SELECT CASE
  WHEN declared_age BETWEEN 18 AND 24 THEN '18-24'
  WHEN declared_age BETWEEN 25 AND 34 THEN '25-34'
  WHEN declared_age BETWEEN 35 AND 44 THEN '35-44'
  WHEN declared_age BETWEEN 45 AND 54 THEN '45-54'
  ELSE '55+' END AS age_group,COUNT(*)::integer AS users
 FROM eligible GROUP BY 1 HAVING COUNT(*)>=5
),area_cohorts AS (
 SELECT residence_country country,residence_region region,COUNT(*)::integer AS users
 FROM eligible
 WHERE area_consent AND residence_country IS NOT NULL AND residence_region IS NOT NULL
 GROUP BY residence_country,residence_region HAVING COUNT(*)>=5
),topic_cohorts AS (
 SELECT s.topic,COUNT(DISTINCT s.uid)::integer AS users
 FROM public.taskflow_ads_interest_scores s
 JOIN public.taskflow_ads_user_profiles p ON p.uid=s.uid
 WHERE p.profiling_consent AND p.declared_age BETWEEN 18 AND 120
  AND p.age_declared_at > now()-interval '365 days'
  AND s.updated_at > now()-interval '90 days'
 GROUP BY s.topic HAVING COUNT(DISTINCT s.uid)>=5
)
SELECT jsonb_build_object(
 'periodDays',30,
 'usersWithActivityConsent',(SELECT COUNT(*) FROM eligible),
 'activityMinutes',(SELECT ROUND(COALESCE(SUM(seconds),0)::numeric/60,1) FROM eligible),
 'sessions',(SELECT COALESCE(SUM(sessions),0) FROM eligible),
 'ageGroups',(SELECT COALESCE(jsonb_agg(jsonb_build_object('group',age_group,'users',users)
    ORDER BY age_group),'[]'::jsonb) FROM age_cohorts),
 'regions',(SELECT COALESCE(jsonb_agg(jsonb_build_object('country',country,'region',region,'users',users)
    ORDER BY users DESC),'[]'::jsonb) FROM area_cohorts),
 'interests',(SELECT COALESCE(jsonb_agg(jsonb_build_object('topic',topic,'users',users)
    ORDER BY users DESC),'[]'::jsonb) FROM topic_cohorts)
);
$function$;
REVOKE ALL ON FUNCTION public.taskflow_ads_audience_report()
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.taskflow_ads_audience_report() TO service_role;

CREATE OR REPLACE FUNCTION public.taskflow_ads_audience_cleanup()
RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $function$
DECLARE removed integer;
BEGIN
 DELETE FROM public.taskflow_ads_audience_daily_activity
 WHERE activity_day < (current_timestamp AT TIME ZONE 'UTC')::date - 89;
 GET DIAGNOSTICS removed=ROW_COUNT;
 RETURN removed;
END
$function$;
REVOKE ALL ON FUNCTION public.taskflow_ads_audience_cleanup()
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.taskflow_ads_audience_cleanup() TO service_role;

-- pg_cron está instalado en el proyecto (verificado en lectura previa).
-- Evitar jobs duplicados en reintentos de despliegue.
DO $block$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='taskflow_ads_audience_cleanup_v1') THEN
  PERFORM cron.schedule('taskflow_ads_audience_cleanup_v1','17 3 * * *',
   'SELECT public.taskflow_ads_audience_cleanup();');
 END IF;
END
$block$;
COMMIT;

-- Para retirar consentimiento de actividad desde el servidor:
-- DELETE FROM public.taskflow_ads_audience_daily_activity WHERE uid = <verified firebase UID>;
-- UPDATE public.taskflow_ads_audience_optins SET activity_consent=false,consented_at=NULL WHERE uid=...;
