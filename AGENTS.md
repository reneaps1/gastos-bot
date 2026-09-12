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
| gastos-bot | Render Web Service (Node) | Live | ver dashboard (ver nota) |
| milo-telegram-bot | Render Web Service (Node) | Live | ver dashboard |
| gastos-dashboard | Render Web Service (Node) | Live | gastos-dashboard.onrender.com |
| gastos-db | Render PostgreSQL (Free) | Live | interno: dpg-d8nburernols73dj06j0-a |

> Nota sobre la URL de `gastos-bot`: esta tabla decia `gastos-bot.onrender.com`, pero ese host responde un 404 de Flask/Werkzeug — no es esta app (Express contesta `Cannot GET /ruta`). Los subdominios de `onrender.com` son globales y unicos, asi que lo mas probable es que el nombre estuviera tomado y Render le asignara otro. Saca la URL real del dashboard o de `getWebhookInfo` (el bot la registra desde `RENDER_EXTERNAL_URL`, que siempre es la verdadera).

### Dos servicios, un solo webhook de Telegram

`gastos-bot` y `milo-telegram-bot` despliegan **el mismo repo** y corren **el mismo `src/index.js`**; solo cambia el start command (`npm start` vs `npm run start:telegram`, que existe justo para eso). `milo-telegram-bot` NO esta en `render.yaml`: se administra solo desde el dashboard.

Reglas para que no se peleen:

- **Un token de Telegram admite UNA sola URL de webhook.** Cada instancia con `TELEGRAM_BOT_TOKEN` llama `setWebhook` al arrancar, asi que la ultima en reiniciar se queda con TODOS los mensajes. El sintoma es el peor de todos: "el bot funciona a veces".
- El servicio que **no** deba quedarse con Telegram va con `TELEGRAM_REGISTER_WEBHOOK=false` (o directamente sin `TELEGRAM_BOT_TOKEN`). Al arrancar, cada instancia loguea su rol: `Telegram role: DUENO del webhook` o `solo responde`.
- `milo-telegram-bot` necesita `DATABASE_URL` (la URL **interna** de gastos-db, el mismo valor que `gastos-bot`). Sin eso arranca y contesta, pero cada consulta a presupuesto, liquidez o movimientos truena: `telegramBrain`, `miloTools` y `financeAgent` pegan a Postgres directo.
- Si el start command de un servicio apunta a un script que no existe en `package.json`, Render entra en crash loop y **deja viva la version anterior** hasta el siguiente deploy — se ve "Failed deploy" mientras el bot sigue respondiendo, y el silencio real llega con el deploy siguiente. Fue exactamente el incidente del 2026-09-12: `npm run start:telegram` sin ese script en el repo.

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
