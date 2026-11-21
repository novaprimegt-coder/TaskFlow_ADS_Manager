-- Comprueba permisos, idempotencia, seguridad de grupos, revocación y borrado.
DO $test$
DECLARE i integer; j jsonb; recorded boolean; current_day date;
BEGIN
 FOR i IN 1..4 LOOP
  INSERT INTO public.taskflow_ads_user_profiles(uid,declared_age,age_declared_at,profiling_consent)
  VALUES('adult'||i,24,now(),true);
  IF public.taskflow_ads_audience_preferences('adult'||i,true,false,'','') IS DISTINCT FROM true
  THEN RAISE EXCEPTION 'Consentimiento adulto rechazado'; END IF;
  IF public.taskflow_ads_audience_heartbeat('adult'||i,repeat('a',64)) IS DISTINCT FROM true
  THEN RAISE EXCEPTION 'Primer minuto no registrado'; END IF;
  IF public.taskflow_ads_audience_heartbeat('adult'||i,repeat('a',64)) IS DISTINCT FROM false
  THEN RAISE EXCEPTION 'Se duplicó el mismo minuto'; END IF;
 END LOOP;
 j:=public.taskflow_ads_audience_report();
 IF j->>'activityMinutes' IS NOT NULL OR j->>'sessions' IS NOT NULL
  OR j->>'usersWithActivityConsent' IS NOT NULL
 THEN RAISE EXCEPTION 'Fuga de agregados con menos de cinco personas: %',j; END IF;
 INSERT INTO public.taskflow_ads_user_profiles(uid,declared_age,age_declared_at,profiling_consent)
 VALUES('adult5',33,now(),true);
 PERFORM public.taskflow_ads_audience_preferences('adult5',true,true,'GT','Huehuetenango');
 PERFORM public.taskflow_ads_audience_heartbeat('adult5',repeat('b',64));
 j:=public.taskflow_ads_audience_report();
 IF (j->>'usersWithActivityConsent')::integer<>5 OR (j->>'activityMinutes')::numeric<>5
 THEN RAISE EXCEPTION 'No se muestran agregados seguros: %',j; END IF;
 IF jsonb_array_length(j->'regions')<>0
 THEN RAISE EXCEPTION 'Se expuso una región de un solo usuario'; END IF;
 UPDATE public.taskflow_ads_user_profiles SET declared_age=17 WHERE uid='adult1';
 IF EXISTS(SELECT 1 FROM public.taskflow_ads_audience_optins WHERE uid='adult1')
 THEN RAISE EXCEPTION 'No se borró la analítica de un menor'; END IF;
 DELETE FROM public.taskflow_ads_user_profiles WHERE uid='adult2';
 IF EXISTS(SELECT 1 FROM public.taskflow_ads_audience_optins WHERE uid='adult2')
 THEN RAISE EXCEPTION 'No se borró la analítica al eliminar cuenta'; END IF;
 IF public.taskflow_ads_audience_preferences('adult1',true,false,'','') IS DISTINCT FROM false
 THEN RAISE EXCEPTION 'Menor pudo reactivar analítica'; END IF;
 UPDATE public.taskflow_ads_audience_daily_activity
 SET activity_day=(now() AT TIME ZONE 'UTC')::date-100 WHERE uid='adult5';
 PERFORM public.taskflow_ads_audience_cleanup();
 IF EXISTS(SELECT 1 FROM public.taskflow_ads_audience_daily_activity WHERE uid='adult5')
 THEN RAISE EXCEPTION 'La limpieza de 90 días no eliminó el registro'; END IF;
 IF (SELECT count(*) FROM cron.job WHERE jobname='taskflow_ads_audience_cleanup_v1')<>1
 THEN RAISE EXCEPTION 'Se programó la limpieza más de una vez'; END IF;
 IF has_function_privilege('anon','public.taskflow_ads_audience_report()','EXECUTE')
  OR has_function_privilege('authenticated','public.taskflow_ads_audience_report()','EXECUTE')
 THEN RAISE EXCEPTION 'Reporte accesible sin autorización de servicio'; END IF;
 IF (SELECT relrowsecurity FROM pg_class WHERE oid='public.taskflow_ads_audience_optins'::regclass) IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'La tabla de consentimientos no tiene RLS'; END IF;
 IF (SELECT relrowsecurity FROM pg_class WHERE oid='public.taskflow_ads_audience_daily_activity'::regclass) IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'La tabla de actividad no tiene RLS'; END IF;
 RAISE NOTICE 'OK: privacidad, deduplicación, edad, borrado, limpieza, RLS y cron simulados';
END
$test$;
