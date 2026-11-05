# TaskFlow ADS Manager

Administrador comercial de campañas publicitarias para TaskFlow.

## Estado actual

Versión inicial de desarrollo. No está lanzada ni publicada como producto final.

### Implementado

- Registro e inicio de sesión obligatorios.
- Autenticación conectada al mismo proyecto Firebase de TaskFlow: `taskflow-b0ece`.
- Sesión persistente.
- Cuenta comercial obligatoria después del registro.
- Datos separados por usuario.
- Respaldo local de campañas cuando Firestore no está disponible.
- Estructura comercial:
  - Campaña.
  - Audiencia y ubicación.
  - Presupuesto y calendario.
  - Anuncio.
- Objetivos:
  - Reconocimiento.
  - Tráfico.
  - Interacción.
  - Clientes potenciales.
  - Ventas.
  - Aplicación.
- Segmentación:
  - País.
  - Departamento / región.
  - Ciudad / municipio.
  - Radio.
  - Edad mínima y máxima.
- Ubicaciones reales preparadas para TaskFlow:
  - Banner debajo del temporizador.
  - Banner entre Hábitos y Tareas.
  - Banner al final.
  - Anuncio de ingreso.
  - Anuncio por interacción.
- Estados de campaña:
  - Borrador.
  - Activa.
  - Pausada.
- Presupuesto diario o total en GTQ.
- Fechas de inicio y finalización.
- URL de destino HTTPS.
- URL de creativo HTTPS.
- Imagen, GIF o video.
- Control de audio para video.
- Interfaz responsive.
- GSAP + ScrollTrigger para efectos visuales de la página de acceso.

## Firebase compartido con TaskFlow

La aplicación reutiliza la configuración web ya empleada por TaskFlow:

- Proyecto: `taskflow-b0ece`
- Firebase Authentication.
- Cloud Firestore.

Esto permite que el usuario utilice la misma cuenta de TaskFlow en ADS Manager.

Los datos del administrador se organizan así:

```
users/{uid}/adsManager/business
users/{uid}/adsCampaigns/{campaignId}
```

La cuenta comercial mantiene un campo `accountStatus` preparado para control administrativo.

## Seguridad

El archivo `firestore.ads.rules.example` contiene reglas propuestas para integrar ADS Manager con las reglas existentes de TaskFlow.

No debe desplegarse sustituyendo reglas existentes sin fusionarlas y validarlas previamente.

El modelo preparado permite:

- Cada usuario solo puede leer y modificar sus propios datos.
- Un administrador futuro puede usar el custom claim `taskflowAdsAdmin=true`.
- El propietario no puede quitar una suspensión administrativa modificando `accountStatus`.
- El frontend no contiene credenciales privadas de servidor.

## Persistencia

Las campañas se guardan primero en el almacenamiento local del navegador y después se sincronizan con Firestore.

Si Firestore rechaza temporalmente una operación, la interfaz conserva la copia local y muestra el estado correspondiente.

## Conexión con TaskFlow_Sistem

Esta primera etapa comparte cuentas y base de datos con TaskFlow, pero no modifica `TaskFlow_Sistem`.

La conexión de campañas aprobadas con los slots publicitarios activos de TaskFlow debe realizarse en una siguiente etapa mediante un contrato de entrega seguro, sin exponer administración ni permisos de escritura dentro del sistema principal.

## Archivos

```
index.html
styles.css
firebase-config.js
app.js
firestore.ads.rules.example
README.md
```

## Entrada

`index.html`

## Regla de desarrollo

Modificar únicamente lo solicitado y conservar la última versión estable como baseline.
