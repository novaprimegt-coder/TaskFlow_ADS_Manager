# TaskFlow ADS — saldo publicitario con PayPal Business

## Modalidad aprobada
- **Cuenta receptora Live indicada:** `taskflowgt.oficial@gmail.com`.
- Cobro **por recarga individual de monto libre**, no suscripción automática.
- El anunciante elige el importe en **USD** (desde 0.01 hasta 10,000.00, límite preventivo del servicio), aprueba cada compra en PayPal, y el servidor acredita únicamente importes capturados y verificados.
- El saldo y los movimientos se consultan en **Presupuestos → Saldo publicitario** de TaskFlow ADS Manager.
- El plan/suscripción de TaskFlow que el titular ya tiene **no se sustituye ni modifica**.

## Estado
- Backend Vercel: `taskflow-ads-payments`. Primer despliegue realizado con `PAYPAL_PAYMENTS_ENABLED=false`.
- Interfaz de saldo integrada en `ads-paypal-wallet.js` y `ads-paypal-wallet.css`.
- Backend: endpoints `/api/status`, `/api/wallet`, `/api/orders`, `/api/capture`, `/api/webhook`.
- **No hay cobros habilitados.** Falta configurar claves privadas y validar la recepción de dinero en Sandbox antes de activar Live.
- No se han trasladado fondos ni asociado automáticamente ninguna suscripción existente.

## Operación segura
1. Firebase Authentication autentica al anunciante ante el gateway; el servidor verifica su ID token.
2. El servidor verifica que exista la cuenta comercial activa en Firestore.
3. Al crear la recarga, genera una orden PayPal Orders v2 con importe exacto USD calculado desde centavos enteros y registra su dueño.
4. El anunciante es redirigido a PayPal y **aprueba explícitamente el pago**.
5. PayPal captura el dinero. El servidor consulta directamente la orden, verifica su estado COMPLETED, ID de captura, importe, moneda, orden original y receptor.
6. Una transacción atómica en Firestore registra la captura global, el movimiento y el incremento del saldo. Clics repetidos/retornos repetidos no duplican el crédito.
7. Un webhook firmado puede conciliar pagos completados cuando el navegador se cierra. Los reembolsos firmados ajustan el saldo.
8. Un fallo de verificación no añade saldo. Las peticiones del navegador no pueden escribir el saldo.

## Configuración privada en Vercel
Proyecto: `taskflow-ads-payments` (no reutilizar las credenciales de `taskflow-ads-media`).

| Variable | Función |
|---|---|
| `PAYPAL_MODE` | `sandbox` durante pruebas; `live` tras pasar a producción |
| `PAYPAL_CLIENT_ID` | Client ID REST de la aplicación PayPal del entorno elegido |
| `PAYPAL_CLIENT_SECRET` | Client Secret REST, exclusivo de Vercel |
| `PAYPAL_MERCHANT_EMAIL` | Email de cuenta **receptora del entorno elegido**. Sandbox usa un correo de prueba distinto al Live |
| `PAYPAL_MERCHANT_ID` | Opcional: ID de comerciante de PayPal para contrastar el receptor |
| `PAYPAL_WEBHOOK_ID` | ID del webhook configurado en PayPal Developer |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Service account JSON del proyecto Firebase `taskflow-b0ece` como variable cifrada de Vercel |
| `PAYPAL_PAYMENTS_ENABLED` | `false` hasta terminar las pruebas; `true` cuando se autorice la captura real |

El webhook debe apuntar a:
`https://taskflow-ads-payments.vercel.app/api/webhook`

Eventos configurables en PayPal:
- `PAYMENT.CAPTURE.COMPLETED`
- `PAYMENT.CAPTURE.REFUNDED`
- `PAYMENT.CAPTURE.REVERSED`

**Nunca copiar secretos ni el JSON de servicio a GitHub o al chat.** Configurar directamente en Vercel.

## Saldo y presupuestos de campañas
- El saldo se almacena en **USD**.
- Los presupuestos de campañas existentes siguen expresados en **GTQ**.
- **No se ha habilitado conversión automática de moneda, tarifa por impresión/clic, cobro por entrega ni débito de campañas.** Es necesario fijar una política de precios y conversión antes de tratar el saldo como dinero disponible para consumo publicitario.
- No se marcan anuncios como pagados únicamente por recibir una URL de retorno.

## Modelo de datos Firestore
- `users/{uid}/adsWallet/main` — saldo acumulado en centavos, solo administrador servidor.
- `users/{uid}/adsPaymentLedger/{orderId}` — recargas/reembolsos.
- `adsPaymentOrders/{orderId}` — titular, importe y estado.
- `adsPaymentCaptures/{captureId}` — índice global para impedir duplicados.
- `adsPaymentRefunds/{refundId}` — reembolsos verificados.

Las rutas deben protegerse contra escrituras directas desde el cliente en las reglas Firestore de producción; el Admin SDK del gateway opera desde servidor. Revisar posibles reglas generales que permitan escrituras en `users/{uid}/**`.

## Recursos oficiales
- https://developer.paypal.com/checkout/integrate
- https://developer.paypal.com/api/orders/v2/
- https://developer.paypal.com/api/rest/webhooks/
- https://developer.paypal.com/api/codes/currency/
