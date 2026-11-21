# TaskFlow ADS — Analítica opcional y privada V1

Estado: **preparado en rama de desarrollo; NO desplegado, NO está recopilando sesiones**.

## Lo que ya existe y no se reemplaza

La integración actual entre `TaskFlow_Sistem` y `TaskFlow_ADS_Manager` utiliza campañas aprobadas, selección privada y eventos reales de clics e impresiones, con deduplicación. La edad declarada y el permiso de personalización ya se guardan en `taskflow_ads_user_profiles`. Los intereses provienen exclusivamente de categorías de anuncios con clics confirmados y tienen una ventana de actividad de 90 días. Las rutinas, notas, tareas, ingresos y GPS no participan en esa clasificación.

## Lo nuevo

El código nuevo de TaskFlow (`taskflow-ads-audience-v178.js` y CSS) ofrece **dos autorizaciones independientes** en el perfil para mayores de 18 años:

1. Minutos activos y sesiones aproximadas mientras la aplicación está visible y el usuario interactúa. No se mide actividad en segundo plano. Se guardan totales diarios, no secuencias de teclas ni páginas visitadas.
2. País y departamento/región general **ingresados voluntariamente por la persona**. No se supone que la IP revele la residencia, ni se solicita GPS, coordenadas, colonia, dirección o localización exacta.

La función `services/analytics/supabase-edge/index.ts` verifica los JWT de Firebase antes de procesar solicitudes. La consulta del perfil, los permisos, los latidos de actividad, la eliminación y la lectura administrativa requieren un usuario autenticado. El `uid` utilizado viene del JWT, nunca del JSON enviado por el navegador.

La migración `services/analytics/audience_v1.sql` configura tablas privadas con RLS habilitada y privilegios exclusivos para `service_role`, deduplicación transaccional de un minuto por usuario, límites diarios de 12 horas, un máximo de 90 días de registros diarios y un trabajo programado de limpieza. La retirada de consentimiento elimina los registros diarios de esa persona. Si su edad cambia a menos de 18 años, se eliminan las preferencias de analítica y su actividad almacenada.

El endpoint `/admin/summary` se limita a JWT con `taskflowAdsAdmin` y devuelve estadísticas agregadas, incluidas edades declaradas por intervalos, regiones e intereses. Los grupos demográficos y de interés requieren **al menos 5 personas**; no entrega listas de usuarios, correos, IP ni historial individual de navegación.

## Orden de activación obligatorio

1. Revisar políticas V178 y consentimiento visible en el perfil; validar alcance jurídico por país.
2. Probar en una base de datos aislada la migración SQL, RLS y limpieza. Verificar que la extensión `pg_cron` esté disponible (se comprobó instalada en el proyecto; aún falta verificar el nuevo job al aplicar la migración).
3. Configurar en los secretos privados del proyecto Supabase `TF_ADS_ACTIVITY_HASH_KEY` con una clave aleatoria segura de al menos 32 caracteres. **No insertar ni publicar esa clave en GitHub, en TaskFlow ni en el chat.**
4. Desplegar la función `taskflow-ads-audience` como servicio independiente. No reemplazar `taskflow-ads-delivery`, `taskflow-ads-paypal` ni `taskflow-noads`.
5. Validar sesiones Firebase adultas autorizadas, minoría de edad, ausencia de consentimiento, retirada, errores de red, deduplicación y cron. Validar el informe agregado con umbral 5 antes de permitir lecturas administrativas.
6. Solo entonces integrar/revisar la rama preparada de `TaskFlow_Sistem`, probar su empaquetado y publicar con autorización **LANZAR**.
7. No afirmar captación de todas las cuentas: únicamente adultos que hayan consentido explícitamente. Los usuarios existentes no se incorporan de manera retroactiva.

## API

Base: `https://vgjpzvkfzahziwzwwkbx.supabase.co/functions/v1/taskflow-ads-audience/`

- `GET /profile`: estado del permiso del usuario autenticado.
- `POST /preferences`: `activityConsent`, `areaConsent`, `country`, `region`. Solo adulto y valores validados.
- `POST /heartbeat`: `sessionId`; se firma y anonimiza antes de usarlo en la base de datos.
- `POST /forget`: eliminar preferencias, región y actividad de la persona autenticada.
- `GET /admin/summary`: informe agregado únicamente para administrador firmado por Firebase.

## Límites reales

- La edad es **declarada**, no verificada mediante documentos.
- El tiempo activo es **estimado por intervalos y deduplicado**; no garantiza un registro perfecto de cada segundo.
- El consentimiento se verifica en el servidor para las solicitudes de actividad; los clientes no pueden autorizarse por sí solos.
- Los clics e intereses siguen en el backend `taskflow-ads-delivery` existente. No se duplican.
- La nueva región se almacena de forma privada; aplicarla a la selección de anuncios requeriría una revisión posterior del servicio `taskflow-ads-delivery`. No se ha modificado su algoritmo.
- Este repositorio es público: el código no contiene claves privadas, datos personales reales ni reglas de selección comerciales.
