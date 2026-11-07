# TaskFlow ADS — integración PayPal independiente

## Arquitectura actual

La cuenta receptora se configura únicamente en las variables privadas del servicio; no se publica en esta documentación.

**Frontend:** TaskFlow ADS Manager → Presupuestos → Saldo publicitario.

**Servidor activo preparado:** Supabase Edge Function `taskflow-ads-paypal` en el mismo proyecto de Supabase en que está `taskflow-noads`. El código fuente está en `services/paypal/supabase-edge/index.ts`.

La función de ADS lee las mismas variables privadas `TF_PAYPAL_MODE`, `TF_PAYPAL_CLIENT_ID` y `TF_PAYPAL_CLIENT_SECRET` utilizadas por la suscripción **TaskFlow sin anuncios**; los valores **nunca** salen de Supabase. La función original `taskflow-noads` no se ha editado y suscripciones, precios y renovaciones no se han modificado.

**Frontend y llamadas:** `ads-paypal-wallet.js` consulta a `https://vgjpzvkfzahziwzwwkbx.supabase.co/functions/v1/taskflow-ads-paypal`. Rutas: `GET /status`, `GET /wallet`, `POST /orders`, `POST /capture`, `POST /webhook`.

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
