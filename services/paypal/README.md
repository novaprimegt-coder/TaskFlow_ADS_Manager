# PayPal para TaskFlow ADS Manager — preparación segura

Cuenta receptora indicada: **taskflowgt.oficial@gmail.com** (Business, declarada por el titular).

## Estado actual
- Cliente REST de PayPal con OAuth 2.0 implementado como módulo de servidor.
- Ruta de consulta de configuración `api/status.js` preparada, **no desplegada**.
- Sin credenciales PayPal guardadas en el repositorio.
- Cobros **deshabilitados**. No se ha creado enlace de pago, orden, suscripción ni facturación.
- No se han alterado la publicidad, métricas ni aprobaciones del sistema existente.

## Configuración necesaria
1. Crear aplicación en [PayPal Developer](https://developer.paypal.com/dashboard/applications).
2. Usar primero **Sandbox**. Obtener Client ID y Client Secret.
3. Guardar ambos en **Vercel Environment Variables**, no en GitHub ni en el navegador.
4. Configurar `PAYPAL_MERCHANT_EMAIL` según la cuenta receptora y verificar que las credenciales pertenecen al mismo negocio.
5. Definir modelo de facturación para ADS: presupuesto de campañas vs saldo prepago vs cuotas; precio y periodicidad.
6. Definir cobro en una moneda admitida por PayPal. **GTQ no está entre las monedas de pago admitidas por Orders API**: no convertir sin tasa justificada y validada.
7. Antes de habilitar el checkout: crear y capturar órdenes desde el servidor, almacenar identificadores de captura e importes en almacenamiento confiable, validar el dueño de la campaña, confirmar por API y webhooks firmados, prevenir duplicación y contemplar reembolsos.
8. Solo activar `PAYPAL_PAYMENTS_ENABLED=true` tras pruebas y confirmación de las condiciones de cobro.

## Seguridad
- Nunca confiar en el precio enviado por el navegador.
- Nunca activar una campaña basándose únicamente en una URL de retorno de PayPal.
- No publicar Client Secret, tokens, ni claves privadas.
- Las credenciales Live y Sandbox son diferentes.
- Este módulo no está unido todavía al Vercel project `taskflow-ads-media`; evita alterar los endpoints actuales de anuncios.

## Referencias oficiales
- https://developer.paypal.com/api/get-started/
- https://developer.paypal.com/checkout/integrate
- https://developer.paypal.com/api/rest/webhooks/rest/
- https://developer.paypal.com/api/codes/currency/
