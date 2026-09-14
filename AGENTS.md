# Agentes

## Política Obligatoria

**AL INICIAR CADA SESIÓN:** Leer el archivo `DEVELOPMENT_POLICY.md` antes de cualquier cambio o tarea.

Este archivo contiene:

- Arquitectura y stack del proyecto.
- Fases de desarrollo y orden de ejecución.
- Reglas de diseño y negocio.
- Decisiones pendientes.
- Riesgos conocidos.

No tomar decisiones de implementación sin consultar primero esta política.

## Fases Actuales

**AL INICIAR CADA SESION:** Leer tambien `ISSUES_FASE9.md` si se trabaja en iOS.

El proyecto esta en **Fase 8 / Fase 9**. Las fases pueden ejecutarse en paralelo cuando no comparten dependencias.

| Fase | Estado |
|------|--------|
| 0 - Alinear Reglas Del Negocio | cerrado |
| 1 - DDL Final Y Base De Datos | cerrado |
| 2 - Setup Tecnico De La App | cerrado |
| 3 - Migracion De Datos | cerrado |
| 4 - Refactor Del Bot | cerrado |
| 5 - API Interna | cerrado |
| 6 - Dashboard MVP | cerrado |
| 7 - Administracion | cerrado |
| 8 - Inteligencia Y Automatizacion | en progreso |
| 9 - iOS App Store (Capacitor) | en progreso |

### Fase 0 — Entregables cerrados

| Entregable | Estado | Archivo |
|------------|--------|---------|
| Reglas oficiales de quincenas Q23-Q42 | cerrado | `src/quincenas.js`, `ddl_plan.md`, `DEVELOPMENT_POLICY.md` |
| Catálogo oficial de 9 categorías | cerrado | `src/parser.js`, `ddl_plan.md`, `DEVELOPMENT_POLICY.md` |
| Catálogo de usuarios (Rene, Mariana) | cerrado | `ddl_plan.md`, `DEVELOPMENT_POLICY.md` |
| Decisión sobre Google Sheets | cerrado | Solo como respaldo/exportación, no fuente principal |
| Decisión sobre Excel histórico | cerrado | Fuente oficial de migración inicial |

### Fase 1 — Issues

| Issue | Estado | Titulo |
|-------|--------|--------|
| #6 | completado | Instalar PostgreSQL |
| #7 | completado | Setup Prisma y schema |
| #8 | completado | Seed de datos semilla |
| #9 | completado | Generar cliente Prisma |
| #10 | completado | Vista de dashboard principal |
| #11 | completado | Script de verificacion |

### Fase 2 — Entregables cerrados

| Entregable | Estado | Archivo |
|------------|--------|---------|
| Dashboard Next.js con Prisma | cerrado | `dashboard/` |
| Páginas: Dashboard, Transacciones, Presupuesto, Deudas | cerrado | `dashboard/src/app/` |
| Layout con navegación | cerrado | `dashboard/src/app/layout.tsx` |

### Fase 3 — Entregables cerrados

| Entregable | Estado | Detalle |
|------------|--------|---------|
| Script de migración | cerrado | `scripts/migrate-excel.js` |
| 239 transacciones migradas | cerrado | Desde hoja Captura |
| 166 presupuestos migrados | cerrado | Desde hoja Presupuesto |
| 10 snapshots liquidez | cerrado | Desde hoja Liquidez |
| 5 deudas migradas | cerrado | Desde hoja Deudas v2 |
| Validación Q24-Q28 | cerrado | 5/5 OK contra Excel |

### Fase 4 — Issues

| Issue | Estado | Titulo |
|-------|--------|--------|
| #12 | completado | Separar lógica del bot en módulos |
| #13 | completado | Corregir cálculo de quincena |
| #14 | completado | Guardar mensajes recibidos en DB |
| #15 | completado | Guardar transacciones en PostgreSQL |
| #16 | completado | Mantener export opcional a Sheets |
| #17 | completado | Mejorar parser |
| #18 | completado | Asociar movimientos a usuario, categoría, concepto y método de pago |

### Fase 5 — Entregables cerrados

| Entregable | Estado | Detalle |
|------------|--------|---------|
| API Interna REST | cerrado | 10 endpoints en `dashboard/src/app/api/` |
| /api/dashboard | cerrado | Resumen con métricas por quincena |
| /api/transacciones | cerrado | CRUD completo con filtros y paginación |
| /api/presupuestos | cerrado | CRUD con cálculo de ejecución vs presupuestado |
| /api/categorias | cerrado | Catálogo de 9 categorías oficiales |
| /api/deudas | cerrado | Listado con cálculo de saldo y progreso |
| /api/liquidez | cerrado | Snapshots de caja por quincena |
| /api/users | cerrado | Catálogo de usuarios |
| /api/metodos-pago | cerrado | Catálogo de métodos de pago |
| /api/cuentas | cerrado | Catálogo de cuentas |
| /api/quincenas | cerrado | Catálogo de quincenas Q23-Q42 |

### Fase 6 — Entregables cerrados

| Entregable | Estado | Detalle |
|------------|--------|---------|
| Dashboard funcional | cerrado | 6 KPIs, semáforo, gráficas, pendientes |
| Vista por quincena | cerrado | Selector funcional en todas las páginas |
| KPIs principales | cerrado | Ingresos, Gastos, Ahorros, Margen, Pendiente, Presupuesto |
| Gráficas básicas | cerrado | Gastos por categoría con barras de progreso |
| Responsive | cerrado | Mobile/desktop, columnas ocultas en móvil |

### Fase 7 — Entregables cerrados

| Entregable | Estado | Detalle |
|------------|--------|---------|
| Componentes compartidos UI | cerrado | Toast, ConfirmDialog, FormModal, NavBar en `dashboard/src/components/` |
| CRUD Transacciones | cerrado | Crear, editar, eliminar, toggle estatus, filtros completos, paginación 25/pág |
| CRUD Presupuesto | cerrado | Crear, editar, eliminar, copiar de quincena anterior |
| API deudas/[id] | cerrado | GET, PUT (incluye archivar), DELETE |
| CRUD Deudas | cerrado | Crear, editar, archivar, registrar abono manual como transacción |
| Navegación con estado activo | cerrado | Indicador de página activa + menú hamburguesa móvil |
| Páginas de configuración | cerrado | Categorías, usuarios, liquidez, conceptos recurrentes, audit log |

### Fase 9 — Issues

| Issue | Estado | Titulo |
|-------|--------|--------|
| #28 | completado | Preparar web app para shell nativo |
| #29 | completado | Integrar Capacitor CLI y configuracion |
| #30 | pendiente | Configurar proyecto iOS en Xcode |
| #31 | pendiente | Agregar plugins nativos (Face ID, notificaciones, hapticos) |
| #32 | completado | Scripts de build y automatizacion |
| #33 | pendiente | App Store Connect y subida a Review |
| #34 | completado | Politica de privacidad para App Store |

### Fase 9 — Handoff para macOS

Los issues #28, #29, #32 y #34 ya estan completados en Windows. Los 3 issues restantes (#30, #31, #33) requieren macOS con Xcode.

**Pasos para continuar en Mac:**

1. `git clone` + `cd gastos-bot/dashboard` + `npm install`
2. `npx cap open ios` → abre Xcode con el proyecto
3. Ejecutar **Issue #30** (ver `ISSUES_FASE9.md`):
   - Configurar Team/Bundle ID en Xcode
   - Arrastrar `public/icon-1024.png` como App Icon
   - Personalizar Launch Screen
   - Agregar `NSFaceIDUsageDescription` en Info.plist
   - Probar en simulador (Cmd+R)
4. Ejecutar **Issue #31**:
   - `npm install @capacitor/local-auth @capacitor/push-notifications @capacitor/haptics`
   - `npx cap sync ios`
   - Agregar Push Notifications en Xcode Capabilities
5. Ejecutar **Issue #33**:
   - Crear app en App Store Connect
   - URL de privacidad: `https://gastos-dashboard.onrender.com/privacy`
   - Product → Archive → Distribute App

**Configuracion clave:**
- `capacitor.config.ts` → `server.url` apunta a `https://gastos-dashboard.onrender.com`
- Para desarrollo local en Mac, cambiar a `http://localhost:3000`
- `webDir` apunta a `public/` (los assets estaticos)
- Scripts: `npm run cap:dev`, `cap:sync`, `cap:build`, `cap:release`

## Deploy en Produccion (Render)

### Servicios activos

| Servicio | Plataforma | Estado | URL |
|----------|------------|--------|-----|
| gastos-bot | Render Web Service (Node) | Live | gastos-bot-csca.onrender.com |
| milo-telegram-bot | Render Web Service (Node) | Live | milo-telegram-bot.onrender.com |
| gastos-dashboard | Render Web Service (Node) | Live | gastos-dashboard.onrender.com |
| gastos-db | Render PostgreSQL (Free) | Live | interno: dpg-d8nburernols73dj06j0-a |

> `gastos-bot` vive en **`gastos-bot-csca.onrender.com`**, con sufijo. `gastos-bot.onrender.com` a secas **no es nuestro**: responde un 404 de Flask/Werkzeug (Express contesta `Cannot GET /ruta`). Los subdominios de `onrender.com` son globales y unicos, asi que el nombre limpio lo tenia alguien mas y Render nos asigno otro. Si alguna vez dudas de la URL de un servicio, sale en su log de arranque (`Available at your primary URL ...`) o de `getWebhookInfo`, que refleja lo que el bot registro desde `RENDER_EXTERNAL_URL`.

### Dos servicios, un solo webhook de Telegram

`gastos-bot` sirve WhatsApp y `milo-telegram-bot` sirve Telegram. `milo-telegram-bot` NO esta en `render.yaml`: se administra solo desde el dashboard, asi que su repo, rama, build command y start command **no son visibles desde este repo**. Esa invisibilidad es la causa raiz del incidente del 2026-09-12 y de que tardara 7 horas en diagnosticarse.

Los dos servicios corren el mismo `src/index.js` de `main`; el start command es lo unico que cambia (`npm start` vs `npm run start:telegram`, que existe justo para eso).

#### Post-mortem del 2026-09-12 (resuelto el 2026-09-14)

`milo-telegram-bot` desplegaba la rama **`feature/telegram-budget-bot`**, no `main`. Esa rama tenia su propio entrypoint:

```json
"start:telegram": "node src/telegram-index.js"
```

El commit `c433178` ("Fusionar el bot de Telegram en gastos-bot", cabeza de esa rama y origen del PR #103) **borro** `start:telegram` y `dev:telegram` del `package.json`, porque `src/telegram-index.js` se fusiono dentro de `src/index.js`. El Start Command en Render siguio diciendo `npm run start:telegram`.

Cadena completa:

| Hora (2026-09-12) | Que paso |
|---|---|
| 07:26 | Se despliega `c433178` -> `npm error Missing script: "start:telegram"` -> crash loop |
| — | Render **deja viva la instancia anterior** (`a7631c3`, del 11 de septiembre, el ultimo commit que si tenia el script) |
| 08:24 | Milo contesta normal: es esa instancia vieja |
| ~10:25 | El deploy de #104 se lleva la instancia viva |
| 10:31 | Primer mensaje sin respuesta. Silencio total durante 2 dias |

Ni el token, ni `TELEGRAM_WEBHOOK_SECRET`, ni el modo privacidad, ni `TELEGRAM_ALLOWED_CHAT_IDS` tuvieron que ver con la caida original. Se arreglo cambiando el Branch del servicio a `main`.

**La regla que se deriva, y que es la unica que evita que se repita:**

> Si un cambio en el repo mueve, renombra o elimina el entrypoint de un servicio (o el script de npm que lo arranca), **actualiza el Start Command de ese servicio en Render en el mismo cambio**. El repo no puede detectarlo solo: esa configuracion vive en el dashboard.

Antes de diagnosticar cualquier cosa en `milo-telegram-bot`, confirma en su Settings a que repo y **rama** apunta. Que el repo sea el correcto no significa que la rama lo sea.

Reglas para que no se peleen:

- **Un token de Telegram admite UNA sola URL de webhook.** Cada instancia con `TELEGRAM_BOT_TOKEN` llama `setWebhook` al arrancar, asi que la ultima en reiniciar se queda con TODOS los mensajes. El sintoma es el peor de todos: "el bot funciona a veces".
- El servicio que **no** deba quedarse con Telegram va con `TELEGRAM_REGISTER_WEBHOOK=false` (o directamente sin `TELEGRAM_BOT_TOKEN`). Al arrancar, cada instancia loguea su rol: `Telegram role: DUENO del webhook` o `solo responde`.
- `milo-telegram-bot` necesita `DATABASE_URL` (la URL **interna** de gastos-db, el mismo valor que `gastos-bot`). Sin eso arranca y contesta, pero cada consulta a presupuesto, liquidez o movimientos truena: `telegramBrain`, `miloTools` y `financeAgent` pegan a Postgres directo.
- Si el start command de un servicio apunta a un script que no existe en `package.json`, Render entra en crash loop y **deja viva la version anterior** hasta el siguiente deploy — se ve "Failed deploy" mientras el bot sigue respondiendo, y el silencio real llega con el deploy siguiente. Ver el post-mortem de arriba.
- `npm start` existe en **todas** las versiones del `package.json` de este repo. Si hay que revivir un servicio sin saber que commit despliega, `npm start` arranca en cualquiera.
- `TELEGRAM_ALLOWED_CHAT_IDS` es fail-closed: vacia, el bot recibe los mensajes y los descarta **en silencio**. Al arrancar avisa con `TELEGRAM_ALLOWED_CHAT_IDS is empty`, y cada mensaje descartado deja `TELEGRAM_UNAUTHORIZED_CHAT` con el chat id exacto que hay que agregar. Esa es la forma mas rapida de averiguar el id de un chat: mandarle un mensaje al bot y leer el log.
- El modo privacidad de Telegram **no aplica en chats privados**. Si el bot no contesta en un chat privado autorizado, el servicio esta caido: no hay otra explicacion.

### CI: los tests corren en cada PR

`.github/workflows/ci.yml` corre `npm test` (las tres suites: WhatsApp, Telegram y watchdog) en cada pull request y en cada push a `main`.

Existe porque **un merge a `main` es un despliegue a produccion inmediato**: los tres servicios tienen `autoDeploy`. Sin CI, la unica señal de que un cambio rompio algo es que el bot deje de contestar.

El workflow replica el arranque real: `npm ci`, luego `prisma generate` con un `DATABASE_URL` falso (Prisma 7 lo exige aunque no conecte), luego `npm test`. Si agregas dependencias o cambias el bootstrap de Prisma en `src/index.js`, revisa que ese orden siga siendo valido.

### Watchdog del bot de Telegram

`.github/workflows/telegram-watchdog.yml` corre cada 30 minutos (repo publico: minutos de Actions gratis) y ejecuta `scripts/watchdog-telegram.js`.

Que hace:

- Consulta `getMe` y `getWebhookInfo` en Telegram, y `GET /health` + `GET /telegram/status` en el servicio (timeout de 90s, porque el plan free tarda hasta 50s en despertar).
- Si el webhook apunta al lugar equivocado o no existe, **lo re-registra solo** y lo reporta.
- Si hay algo que no puede reparar (servicio caido, lista blanca vacia, token revocado), **escribe al chat de Telegram** y sale con codigo 1, para que GitHub ademas mande su correo de workflow fallido.
- Si todo esta bien, no manda nada.

Secrets que necesita (Settings -> Secrets and variables -> Actions): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_ALERT_CHAT_ID`, `TELEGRAM_EXPECTED_WEBHOOK_URL`, `TELEGRAM_SERVICE_URL`.

Probarlo a mano: pestaña Actions -> Telegram watchdog -> Run workflow. En local, `node scripts/watchdog-telegram.js --dry-run` no re-registra ni avisa.

La logica de "que cuenta como roto" vive en `src/telegramHealth.js` (sin dependencias, funciones puras) y la comparten el watchdog y `scripts/diagnose-telegram.js`, para que el diagnostico automatico y el manual no puedan contradecirse. Sus pruebas estan en `scripts/test-watchdog.js` y corren con `npm test`.

**Limitacion conocida**: cada ping despierta el servicio y Render lo mantiene arriba ~15 min, asi que con corridas cada 30 min el servicio queda despierto aproximadamente la mitad del tiempo (~360 h/mes). Sumado a los otros servicios free puede acercarse al limite de 750 h/mes del workspace. Si eso pasa, baja el cron a cada hora.

### Configuración crítica de Render

- `main` es la rama de despliegue: `render.yaml` no declara `branch`, asi que Render usa la rama por defecto del repo con `autoDeploy: true`. Un push a `main` despliega a produccion de inmediato — no es un paso intermedio. Ver la regla de Pull Requests en "Reglas De Código".
- El `render.yaml` define la infraestructura pero **el dashboard de Render sobreescribe** `buildCommand` y `startCommand` en servicios ya existentes. Cambios a esos campos en render.yaml no aplican a servicios ya creados — hay que actualizarlos en el dashboard o recrear el servicio.
- `DATABASE_URL` debe configurarse **manualmente** en el Environment de cada servicio en el dashboard (el `fromDatabase` de render.yaml solo aplica en Blueprints nuevos).
- Ambos servicios usan la URL **interna** de gastos-db (sin `.oregon-postgres.render.com`).

### Runbook: el bot de Telegram no responde

El handler de `/telegram/webhook` puede descartar un mensaje **sin contestar nada en el chat**. Estos son todos los caminos, en el orden en que ocurren:

| Causa | Sintoma en el chat | Como se confirma |
|-------|--------------------|------------------|
| Servicio dormido o caido (plan free) | silencio total | `getWebhookInfo.last_error_message` trae 502/503/timeout |
| `TELEGRAM_WEBHOOK_SECRET` desfasado del webhook registrado | silencio total | log `TELEGRAM_SECRET_MISMATCH`; `last_error_message` dice 403 |
| Chat fuera de `TELEGRAM_ALLOWED_CHAT_IDS` (lista blanca fail-closed) | silencio total | log `TELEGRAM_UNAUTHORIZED_CHAT` con el id exacto |
| El grupo se volvio supergrupo y cambio de id | dejo de responder de golpe | log `TELEGRAM_CHAT_MIGRATED` con el id nuevo |
| Modo privacidad del bot en grupos | solo responde a comandos, menciones y respuestas a Milo | log `TELEGRAM_PRIVACY_MODE_ON` al arrancar; `getMe.can_read_all_group_messages=false` |
| `TELEGRAM_BOT_TOKEN` revocado | silencio total | `getMe` responde 401/404 |

Diagnostico en un comando (necesita salida a `api.telegram.org`):

```bash
node scripts/diagnose-telegram.js --chat <chat_id> --service https://gastos-bot.onrender.com
node scripts/diagnose-telegram.js --fix-webhook   # vuelve a registrar el webhook con el secreto actual
```

Sin shell a mano, `GET /telegram/status` responde lo mismo en resumen: `urlMatchesExpected`, `allowedChatIdCount`, `secretConfigured`, `pendingUpdateCount`, `lastErrorMessage`.

Para ubicar un mensaje concreto en los logs de Render, cada update deja `TELEGRAM_UPDATE_IN` **antes** de cualquier validacion:

- no aparece `TELEGRAM_UPDATE_IN` → el update nunca llego (servicio dormido/caido, o modo privacidad filtrando el mensaje del grupo).
- aparece y despues `TELEGRAM_UNAUTHORIZED_CHAT` o `TELEGRAM_SECRET_MISMATCH` → es configuracion, no codigo.
- aparece y no hay respuesta en el chat → revisa `Telegram API error` (token o markdown).

El modo privacidad se apaga en @BotFather: `/setprivacy` → Disable. Sin eso, en un grupo el bot **no recibe** un mensaje suelto como `30, suerox`; solo comandos, menciones y respuestas a sus propios mensajes.

### Asignar gastos a lineas desde Telegram

Cuando Milo registra un gasto y `resolveBudgetLine()` no puede vincularlo con seguridad, la confirmacion trae **botones** con las lineas candidatas. Al tocar uno, el gasto queda vinculado y el mensaje original se reescribe con el estado de la linea, ya sin botones.

Piezas:

- `src/budgetActions.js` — la escritura y su validacion, aparte del handler para poder probarla sola.
- `handleBudgetCallback()` en `src/index.js` — resuelve el toque del boton.
- `extractCallbackQuery()`, `answerCallbackQuery()` y `editMessageText()` en `src/telegram.js`.
- `callback_data` con formato `pl:<txId>:<lineaId>` y `pn:<txId>`. Corto a proposito: Telegram lo limita a 64 bytes.

Reglas que no se pueden relajar:

- **`callback_data` es entrada NO CONFIABLE.** Viaja por el cliente del usuario, asi que un cliente modificado puede mandar cualquier par de ids. `linkTransactionToBudget()` verifica TODO contra la base: que la transaccion exista y sea gasto, que la linea exista, sea de gasto y no este cancelada, y sobre todo **que la linea sea de la misma quincena que la transaccion**. Sin eso, un gasto podria colgarse de una linea de otro periodo y el presupuesto dejaria de cuadrar sin que nadie lo note hasta el cierre.
- **Un callback pasa por las mismas puertas que un mensaje**: el secreto del webhook y la lista blanca de chats. Un boton no puede ser una puerta trasera.
- **Tocar dos veces no escribe dos veces.** El segundo toque es no-op y responde "ya estaba asignado".
- `registerWebhook()` no manda `allowed_updates`, y el default de Telegram si incluye `callback_query`. No hay que tocar el registro del webhook para que esto funcione.

**Alcance de lo que el bot escribe**: solo `transaccion.presupuestoId`, el mismo alcance que el `PUT /api/transacciones/[id]` del dashboard. No mueve montos ni escribe en `presupuesto_cambios`.

Los **traspasos** entre lineas (cubrir un excedente moviendo `montoRevisado`) NO estan en el bot y no deben estarlo: esa operacion valida que la linea donante no quede por debajo de lo ya gastado y escribe su bitacora en la misma transaccion de base de datos. Cuando un gasto rebasa su linea, el bot avisa y ofrece un boton `url` al dashboard (`DASHBOARD_URL`, default `https://gastos-dashboard.onrender.com`), que es donde vive `POST /api/presupuestos/[id]/transferir`. Dos implementaciones de una operacion financiera auditada es como terminan desincronizandose.

El canal de WhatsApp **no cambia**: ahi la regla sigue siendo que el bot nunca pregunta ni fija `presupuestoId` (ver `scripts/test-bot-flow.js`). Que esas 18 pruebas sigan verdes es la señal de que no se filtro comportamiento de un canal al otro.

### TELEGRAM_WEBHOOK_SECRET

Sin esta variable, `POST /telegram/webhook` acepta peticiones de cualquiera. El repo es publico, asi que la ruta esta a la vista en el codigo y el hostname es el nombre del servicio.

Lo unico que hoy detiene a un atacante es la lista blanca: el update falso tendria que traer un `chat.id` que este en `TELEGRAM_ALLOWED_CHAT_IDS`. Eso protege por oscuridad, no por diseño. Ojo con el alcance real: como el bot responde al `chat_id` del update y ese id tiene que estar autorizado, **cualquier respuesta cae en los chats del dueño, no en los del atacante**. El riesgo es contaminacion de datos (gastos falsos), no fuga de informacion.

**Formato**: Telegram solo acepta `A-Z a-z 0-9 _ -`, de 1 a 256 caracteres. Un secreto con otros caracteres hace que `setWebhook` lo rechace, y entonces el servicio arranca exigiendo un secreto que Telegram nunca acepto: 403 a todos los updates. `openssl rand -hex 32` sirve.

**Como se pone**, los dos pasos en la misma sentada:

1. `TELEGRAM_WEBHOOK_SECRET` en el Environment del servicio en Render. Al guardar reinicia, y el arranque le manda el secreto a Telegram via `setWebhook`.
2. El **mismo valor** como secret de Actions en GitHub, para el watchdog.

Confirmacion en el log de arranque: `Telegram webhook registered: ... (secret=yes)`.

Si algo sale mal, la salida de emergencia es borrar la variable en Render y reiniciar: el handler solo exige el header cuando la variable existe (`if (expectedSecret && ...)`), asi que sin ella todo vuelve a funcionar.

**Por que los dos pasos van juntos**: el watchdog repara el webhook llamando `setWebhook`, y solo incluye `secret_token` si el tiene el secreto. Un `setWebhook` sin ese campo **borra** el secreto guardado en Telegram, y entonces el app lo seguiria exigiendo y contestaria 403 a todo. Con el servicio configurado y GitHub sin configurar, una "reparacion" dejaria al bot mudo.

Eso ya no puede pasar: `evaluate()` en `src/telegramHealth.js` anula la reparacion y emite `WATCHDOG_SECRET_MISSING` cuando `/telegram/status` reporta `secretConfigured: true` y el watchdog no tiene el secreto. La regla general que vale la pena conservar: **una reparacion automatica nunca debe poder dejar el sistema peor de como estaba**; ante la duda, avisa y no toques.

### Prisma 7 en Render — Lecciones aprendidas

- Prisma 7 valida `env("DATABASE_URL")` incluso durante `prisma generate` si está en el schema o en `prisma.config.ts`. Sin la variable, el build/runtime explota.
- Con driver adapter (`PrismaPg`), el datasource **no necesita `url`** en `schema.prisma`. La conexión la maneja el pool directamente desde `process.env.DATABASE_URL`.
- `prisma generate` se ejecuta dentro de `src/index.js` al arrancar (antes de los requires de Prisma), porque Render no preserva `node_modules/.prisma` entre build y runtime.
- `prisma migrate deploy` también corre en startup del bot y del dashboard.
- `postinstall: "prisma generate"` falla en build porque `DATABASE_URL` no está disponible en la fase de build de Render. No usar postinstall para generate.
- Build tools (`tailwindcss`, `@tailwindcss/postcss`, `typescript`, `prisma`) deben estar en `dependencies` (no `devDependencies`) en el dashboard, porque Render instala con `NODE_ENV=production`.

### Pendientes de producción

| Tarea | Prioridad | Detalle |
|-------|-----------|---------|
| Correr views.sql en la DB | Alta | `prisma/migrations/views.sql` — vistas de resumen quincenal, deudas, presupuesto, liquidez |
| Configurar tokens WhatsApp en gastos-bot | Alta | `META_VERIFY_TOKEN`, `META_ACCESS_TOKEN`, `META_PHONE_NUMBER_ID` en Render Environment |
| Migrar datos históricos a producción | Media | 239 transacciones + presupuestos + liquidez del Excel |
| Rotar contraseña de gastos-db | Media | Credencial expuesta en chat — gastos-db → Settings → Reset Password |

## Stack Oficial

- **Next.js** full-stack
- **PostgreSQL** como fuente oficial
- **Prisma** para migrations/schema
- **Tailwind CSS** + **shadcn/ui** para frontend
- **WhatsApp Cloud API** para bot
- **Google Sheets API** solo como integración secundaria
- **Capacitor** para iOS App Store wrapper

## Reglas De Código

- **Nunca hacer merge ni push directo a `main`.** Todo cambio va en una rama aparte y se abre un Pull Request; el merge lo hace Rene. Aplica tambien a hotfixes urgentes y a cambios que solo tocan documentacion. Un push a `main` es un despliegue a produccion (ver "Configuración crítica de Render").
- No usar emojis en archivos `.md` del proyecto salvo que el usuario lo pida explícitamente.
- Seguir el DDL y modelo de datos establecido en `ddl_plan.md` y `DEVELOPMENT_POLICY.md`.
- Validar cambios contra datos reales del Excel `milo_tracker_v6.xlsm` cuando se trabaje en migración.
- No crear dashboard sin antes cerrar el modelo de datos.
- Todo debe ser robusto, no un prototipo.
- No usar Google Sheets como fuente principal en la app final.
