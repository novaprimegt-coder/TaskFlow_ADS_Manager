# TaskFlow ADS — integración PayPal independiente

## Arquitectura actual

La cuenta receptora se configura únicamente en las variables privadas del servicio; no se publica en esta documentación.

**Frontend:** TaskFlow ADS Manager → Presupuestos → Saldo publicitario.

**Servidor activo preparado:** Supabase Edge Function `taskflow-ads-paypal` en el mismo proyecto de Supabase en que está `taskflow-noads`. El código fuente está en `services/paypal/supabase-edge/index.ts`.

La integración preparada para ADS utiliza variables de PayPal independientes de las de **TaskFlow sin anuncios**. Las credenciales solo se leen en Supabase; nunca llegan al navegador. La función original `taskflow-noads`, suscripciones, precios y renovaciones no se modifican. Este cambio está preparado en una rama de desarrollo y aún no se ha desplegado.

**Frontend y llamadas:** `ads-paypal-wallet.js` consulta a `https://vgjpzvkfzahziwzwwkbx.supabase.co/functions/v1/taskflow-ads-paypal`. Rutas: `GET /status`, `GET /wallet`, `POST /orders`, `POST /capture`, `POST /webhook`.

## Configuración aislada de PayPal ADS (pendiente de despliegue)

**Sandbox — solamente para pruebas:** configurar como secretos de la Edge Function en Supabase:

- `TF_PAYPAL_ADS_MODE=sandbox`
- `TF_PAYPAL_ADS_SANDBOX_CLIENT_ID` — identificador de la app REST Sandbox de ADS.
- `TF_PAYPAL_ADS_SANDBOX_CLIENT_SECRET` — secreto de esa misma app.
- `TF_PAYPAL_ADS_SANDBOX_MERCHANT_EMAIL` — correo de la cuenta vendedora de Sandbox.
- `TF_PAYPAL_ADS_SANDBOX_WEBHOOK_ID` — ID del webhook propio de ADS en Sandbox.

Destino del webhook: `https://vgjpzvkfzahziwzwwkbx.supabase.co/functions/v1/taskflow-ads-paypal/webhook`

Eventos mínimos: `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.REFUNDED` y `PAYMENT.CAPTURE.REVERSED`.

**Live — bloqueado por defecto:** requiere los cuatro campos `TF_PAYPAL_ADS_LIVE_CLIENT_ID`, `TF_PAYPAL_ADS_LIVE_CLIENT_SECRET`, `TF_PAYPAL_ADS_LIVE_MERCHANT_EMAIL` y `TF_PAYPAL_ADS_LIVE_WEBHOOK_ID`, además de `TF_PAYPAL_ADS_MODE=live`. Solo se permitirá habilitar `TF_PAYPAL_ADS_ENABLE_LIVE=true` después de completar verificaciones, probar flujos y obtener autorización de publicación. La existencia de credenciales por sí sola no habilita Live.

Las variables `TF_PAYPAL_*` preexistentes de **TaskFlow sin anuncios** deben permanecer intactas.

El endpoint `/status` solo mostrará que el cobro está disponible si PayPal confirma OAuth válido; no debe confundirse la presencia de variables con conexión verificada.

## Estado real

- Base de datos de saldo prepago y movimientos creada en Supabase; RLS habilitado, sin permisos directos de cliente.
- OAuth PayPal disponible mediante las variables privadas existentes. La prueba de conexión real se hace al consultar `/status`.
- Crédito idempotente en PostgreSQL: una captura PayPal nunca incrementa dos veces el saldo.
- Ajuste de reembolsos con idempotencia y conciliación de capturas.
- Token de Firebase del usuario verificado usando JWT RS256 y JWKS oficiales, como en `taskflow-noads`.
- **Los cobros Live siguen deliberadamente deshabilitados** hasta registrar el webhook de Live de ADS y completar pruebas de Sandbox. No se han cobrado ni transferido fondos.
- El Webhook ID configurado antes en Vercel corresponde a **Sandbox**, no a Live y no debe mezclarse.
- La cartera está expresada en USD; las campañas conservan sus presupuestos GTQ. No se descuenta automáticamente el presupuesto del saldo mientras no exista una política monetaria definida.

## El proyecto Vercel de pruebas

`taskflow-ads-payments` permanece como prototipo deshabilitado. El frontend ya no lo utiliza para el saldo: utiliza Supabase para evitar copiar credenciales secretas desde la suscripción sin anuncios. No eliminar este proyecto ni modificar el servicio `taskflow-ads-media` por este cambio.

## Seguridad

- Los tokens PayPal nunca se envían al navegador.
- El cliente no crea ni incrementa saldos directamente.
- PayPal debe confirmar status COMPLETED, importe, moneda, receptor, identificador de orden y captura antes de acreditar.
- Se previene doble acreditación mediante identificadores únicos y función SQL transaccional.
- Los webhooks deben superar verificación de firma en PayPal.
- El pago requiere aprobación individual del comprador, sin recurrencia.
- Las credenciales de Live y Sandbox son independientes. La aplicación de Sandbox creada por el titular en PayPal Developer **no comparte automáticamente** las claves de la aplicación existente usada por `taskflow-noads`.

## Datos SQL

`taskflow_ads_balances`, `taskflow_ads_orders`, `taskflow_ads_captures`, `taskflow_ads_payment_ledger`, `taskflow_ads_refunds`.

Las funciones `taskflow_ads_credit_capture` y `taskflow_ads_apply_refund` solo pueden ejecutarse con el rol `service_role`. Se probaron con operaciones simuladas dentro de una transacción revertida. No se registró dinero real en esa prueba.

## Requisitos antes de activar Live

1. Verificar en `/status` que la cuenta PayPal existente responde con OAuth válido.
2. Registrar/validar el webhook Live de esta integración, separado del webhook de la suscripción.
3. Completar una recarga de prueba controlada y reconciliar el saldo, captura y devolución.
4. Confirmar un método verificable de conversión GTQ/USD y política de consumo publicitario si el saldo va a financiar la entrega de anuncios.
5. Solo entonces habilitar el cobro Live, sin exponer claves al navegador o repositorio.

## Documentación

- https://developer.paypal.com/api/rest/webhooks/
- https://developer.paypal.com/api/orders/v2/
