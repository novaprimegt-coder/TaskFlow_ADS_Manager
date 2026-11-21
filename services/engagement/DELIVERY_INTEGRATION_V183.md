# ADS V183 — conexión de audiencia privada (PENDIENTE)

La versión 35 de la función privada taskflow-ads-delivery ya está conectada a TaskFlow_Sistem y verifica la edad declarada, el consentimiento de adultos y las categorías de interés obtenidas únicamente de clics confirmados.

La ampliación V183 NO se ha desplegado. Añade dos consentimientos independientes:
- Área de residencia declarada (país y región/departamento, nunca calle, GPS o domicilio).
- Resumen diario de segundos con TaskFlow visible y franja horaria general.

## Adaptación pendiente de la función de selección privada

En choose(), justo después de obtener privatePersonalization(db, viewer.uid) y antes de crear context:

1. Verificar edad 18+ y profiling_consent vigente con privatePersonalization.
2. Buscar taskflow_ads_engagement_preferences por uid, con residence_consent=true y policy_version=2026-11-21.v183.
3. Verificar que país son exactamente dos letras mayúsculas y región contiene de 2 a 64 caracteres.
4. Si es válido y autorizado, reemplazar SOLO los campos context.country y context.region; vaciar context.city y context.neighborhood.
5. Si no, mantener el cálculo original de ubicación aproximada de conexión o ubicación desconocida.
6. No devolver edad, país/región de residencia, UID, horarios individuales ni preferencias a anunciantes ni navegador.

Pseudocódigo puntual:

    const context={...approximateNetworkArea(req,Number.isInteger(personal.age)&&personal.age>=18),age:personal.age};
    if(personal.age>=18){
      const {data:pref,error}=await db.from("taskflow_ads_engagement_preferences")
        .select("country,region,residence_consent,policy_version").eq("uid",viewer.uid).maybeSingle();
      if(!error&&pref?.residence_consent===true&&pref.policy_version==="2026-11-21.v183"&&
         /^[A-Z]{2}$/.test(pref.country||"")&&typeof pref.region==="string"&&
         pref.region.length>=2&&pref.region.length<=64){
        context.country=pref.country;
        context.region=pref.region;
        context.city="";
        context.neighborhood="";
      }
    }

No publicar el código privado de distribución ni de ranking en este repositorio.

## Despliegue condicionado (no ejecutar sin LANZAR)

1. Crear esquema y probar permisos en staging.
2. Configurar limpieza automática DIARIA de datos de uso tras 90 días y recibos de idempotencia tras 2 días; verificar ejecuciones.
3. Desplegar la nueva Edge Function taskflow-ads-engagement. Firebase JWT es externo a Supabase: el servicio verifica firma, issuer y audience antes de leer preferencias. No exponer service role.
4. Integrar selectivamente la región declarada en la versión MÁS RECIENTE del motor privado, no asumir que V35 seguirá siendo la última.
5. Publicar TaskFlow V183 sólo tras pasar pruebas de menores, permisos voluntarios, revocación, región no exacta, sesiones, duplicados y borrado.
6. Los anunciantes reciben solamente métricas AGREGADAS; nunca perfiles individuales.

La V183 preparada no recopila nuevos datos de personas reales hasta desplegar el backend y publicar los controles con el consentimiento válido.
