# TaskFlow ADS Manager — Producción V11

Administrador comercial de publicidad conectado al ecosistema TaskFlow.

## Estado

Código preparado para publicación. No se ha habilitado GitHub Pages ni se ha realizado el lanzamiento público.

La pantalla de acceso usa Firebase Authentication y permite mostrar u ocultar la contraseña de forma local en el navegador. La contraseña no se almacena ni se replica dentro del código del sitio.

## Arquitectura

- Backend Firebase compartido con TaskFlow.
- Firebase Authentication para registro, inicio de sesión y sesión persistente.
- Cloud Firestore para cuentas comerciales y campañas.
- Firebase Storage para imágenes, GIF y videos publicitarios.
- Catálogo público mínimo en `adsPublicCampaigns` para que TaskFlow pueda leer únicamente anuncios aprobados.
- TaskFlow_Sistem consume ese catálogo mediante `taskflow-ads-bridge.js` V2.
- Los datos privados de anunciantes no se envían al sistema principal.

## Campañas

Cada campaña admite de 1 a 12 anuncios.

La campaña controla:
- objetivo;
- país, región, ciudad, radio y edades;
- formato: Banner, Ingreso o Interacción;
- presupuesto diario o total;
- calendario;
- distribución del presupuesto.

Distribución:
- Optimización automática de TaskFlow.
- Partes iguales entre todos los anuncios.

Cada anuncio conserva:
- nombre;
- URL HTTPS de destino;
- creativo propio;
- audio cuando corresponde;
- estado y metadatos del creativo.

## Especificaciones estrictas

### Banner
- 1200 × 180 px.
- JPG, PNG, WEBP o GIF.
- No acepta video.
- Un anuncio Banner puede aparecer en cualquiera de los tres espacios Banner de TaskFlow.

### Ingreso
- 1080 × 1920 px.
- JPG, PNG, WEBP, GIF, MP4 o WEBM.
- Video: 10 segundos.

### Interacción
- 1080 × 1920 px.
- JPG, PNG, WEBP, GIF, MP4 o WEBM.
- Video: 10 segundos.
- TaskFlow mantiene su contador acumulativo de 10 interacciones.

## Flujo de aprobación

1. El anunciante crea o edita la campaña.
2. La campaña queda con `approvalStatus: pending`.
3. Una cuenta administrativa autorizada puede aprobar o rechazar.
4. Solo una campaña `active + approved` se copia a `adsPublicCampaigns`.
5. TaskFlow lee únicamente `adsPublicCampaigns`.
6. Si la campaña se pausa, elimina o deja de estar aprobada, desaparece del espejo público.

## Rutas Firestore

```
users/{uid}/adsManager/business
users/{uid}/adsCampaigns/{campaignId}
adsPublicCampaigns/{campaignId}
```

## Ruta Storage

```
ads/{uid}/{campaignId}/{adId}/{fileName}
```

## Seguridad

El frontend no contiene secretos privados de servidor.

Archivos incluidos para fusionar con la seguridad existente:
- `firestore.ads.rules.example`
- `storage.ads.rules.example`

No deben reemplazar las reglas actuales de TaskFlow. Deben fusionarse dentro de las reglas existentes.

## Requisitos antes de LANZAR

- Fusionar y desplegar las reglas Firestore de ADS.
- Fusionar y desplegar las reglas Storage de ADS.
- Autorizar la cuenta administrativa en Firebase.
- Autorizar el dominio definitivo del ADS Manager en Firebase Authentication.
- Probar registro, inicio de sesión, subida de creativos, aprobación y entrega en TaskFlow.
- Habilitar el hosting/GitHub Pages únicamente cuando se dé la orden expresa de publicación.

## Métricas y cobros

El panel está preparado visualmente para informes y facturación. No se habilitan escrituras públicas inseguras para inventar métricas ni se procesa dinero sin un backend/proveedor de pagos. Impresiones, clics, CTR, conversiones y cobros reales requieren un endpoint seguro de medición/pagos antes de considerarlos financieros o analíticos de producción.

## Regla de desarrollo

Modificar únicamente lo solicitado y conservar la última versión estable como baseline.
