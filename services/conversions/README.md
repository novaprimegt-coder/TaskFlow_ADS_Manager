# TaskFlow ADS — Medición de resultados comerciales

Este módulo **no es un sistema de cobro** y no garantiza ventas. Permite atribuir resultados efectivamente notificados por el servidor del anunciante. Los presupuestos, las reglas de subasta y las claves privadas no se publican.

## Requisitos

1. Crear la campaña con objetivo Tráfico, Clientes potenciales, Ventas o Aplicación.
2. Activarla, obtener la aprobación y sincronizarla con el distribuidor privado.
3. Abrir **Resultados** en TaskFlow ADS Manager y crear la clave privada de la campaña.
4. Guardar la clave en una variable de entorno del **servidor del anunciante**. Nunca incrustarla en páginas HTML, aplicaciones móviles ni JavaScript del navegador.
5. Instalar la llamada de confirmación únicamente cuando el evento de negocio haya ocurrido y pueda comprobarse.

Las URLs de sitios propios que TaskFlow entrega para estos objetivos incluyen `tf_ads_click` y `tf_ads_campaign`. No contienen nombre, correo, hábitos o tareas. Los enlaces directos de Google Play, App Store y mensajerías externas conservan sus parámetros originales; las instalaciones requieren un mecanismo de atribución compatible configurado por el desarrollador. Para atribuir una compra posterior, conserva `tf_ads_click` en una sesión de servidor o almacenamiento propio con consentimiento, según la legislación aplicable.

## Endpoint de recepción de resultados

`POST https://vgjpzvkfzahziwzwwkbx.supabase.co/functions/v1/taskflow-ads-delivery/conversion/record`

Cabeceras:
```http
Authorization: Bearer tfads_v1_CLAVE_PRIVADA
Content-Type: application/json
```

Ejemplo para una **compra realmente pagada y confirmada**:
```json
{
  "campaignId": "id_de_campana",
  "clickId": "uuid_recibido_en_tf_ads_click",
  "event": "purchase",
  "externalId": "numero_unico_de_pedido_pagado",
  "valueMinor": 12500,
  "currency": "GTQ"
}
```

`valueMinor` se expresa en la unidad monetaria menor; en GTQ, Q125.00 equivale a 12500 centavos. `externalId` identifica la operación para eliminar duplicados y **no debe contener información personal**.

## Ejemplo de integración Node.js, exclusivamente desde el servidor

```js
const ENDPOINT = 'https://vgjpzvkfzahziwzwwkbx.supabase.co/functions/v1/taskflow-ads-delivery/conversion/record';

export async function informarResultadoTaskFlow({ campaignId, clickId, event, externalId, valueMinor = 0, currency = 'GTQ' }) {
  if (!process.env.TASKFLOW_ADS_KEY) throw new Error('No hay clave privada configurada');
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + process.env.TASKFLOW_ADS_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ campaignId, clickId, event, externalId, valueMinor, currency })
  });
  if (!response.ok) throw new Error('No se confirmó la medición');
  const result = await response.json();
  return result.ok === true;
}
```

Este ejemplo solo demuestra el envío: el servidor debe integrar la lectura real del pedido, el identificador del clic y la confirmación de pago.

| Objetivo de campaña | Evento | Condición para informarlo |
|---|---|---|
| Tráfico | `visit` | El servidor recibe la visita a la página de destino. Como máximo una por clic registrado. |
| Clientes potenciales | `lead` | El sistema registra un contacto real y válido, sin enviar sus datos personales. |
| Ventas | `purchase` | El sistema de comercio confirma el pedido como pagado; no basta agregar al carrito. |
| Aplicación | `install` | El servidor de la aplicación verifica la instalación; máximo una por clic registrado. |

El servidor privado rechaza resultados sin atribución a un clic confirmado, eventos ajenos al objetivo, operaciones duplicadas y comprobaciones fuera de la ventana de atribución de 7 días. La recepción se autentica mediante clave de campaña de 256 bits; la base almacena el hash, no la clave.

## Qué se informa y qué no

- Las **impresiones** se confirman por selección registrada, contenido cargado y regla de visibilidad; una selección no equivale por sí sola a una impresión.
- Los **clics** se confirman separadamente; no equivalen a visitas finales, contactos ni ventas.
- Las **visitas, contactos, compras e instalaciones** proceden de notificaciones autenticadas del servidor externo. No tienen auditoría independiente del comercio.
- Solo se muestran resultados comprobables; si la integración no existe, el resultado comercial debe figurar **no disponible**, nunca cero comprobado ni una cifra estimada.
- Una cantidad **solicitada** de impresiones no es una cantidad contratada ni entregada. La autorización de cupo depende de evidencia de inventario, y el informe presenta el déficit si no se cumple.

## Seguridad

Rotar la clave en el panel invalida la anterior. No registrar claves en logs, repositorios públicos, capturas, soporte ni mensajes. Para ventas, validar primero la notificación del procesador de pagos en el servidor; no confiar en un mensaje del navegador. No usar datos personales como `externalId`, ni incluir identidad o historiales de los compradores.

La adquisición de tráfico, conversiones, compras e instalaciones depende de decisiones del público y de la infraestructura del anunciante. Ninguna implementación técnica puede prometer que cada clic se convertirá en cliente o venta.
