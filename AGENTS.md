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
| #28 | pendiente | Preparar web app para shell nativo |
| #29 | pendiente | Integrar Capacitor CLI y configuracion |
| #30 | pendiente | Configurar proyecto iOS en Xcode |
| #31 | pendiente | Agregar plugins nativos (Face ID, notificaciones, hapticos) |
| #32 | pendiente | Scripts de build y automatizacion |
| #33 | pendiente | App Store Connect y subida a Review |
| #34 | pendiente | Politica de privacidad para App Store |

## Deploy en Produccion (Render)

### Servicios activos

| Servicio | Plataforma | Estado | URL |
|----------|------------|--------|-----|
| gastos-bot | Render Web Service (Node) | Live | gastos-bot.onrender.com |
| gastos-dashboard | Render Web Service (Node) | Live | gastos-dashboard.onrender.com |
| gastos-db | Render PostgreSQL (Free) | Live | interno: dpg-d8nburernols73dj06j0-a |

### Configuración crítica de Render

- El `render.yaml` define la infraestructura pero **el dashboard de Render sobreescribe** `buildCommand` y `startCommand` en servicios ya existentes. Cambios a esos campos en render.yaml no aplican a servicios ya creados — hay que actualizarlos en el dashboard o recrear el servicio.
- `DATABASE_URL` debe configurarse **manualmente** en el Environment de cada servicio en el dashboard (el `fromDatabase` de render.yaml solo aplica en Blueprints nuevos).
- Ambos servicios usan la URL **interna** de gastos-db (sin `.oregon-postgres.render.com`).

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

- No usar emojis en archivos `.md` del proyecto salvo que el usuario lo pida explícitamente.
- Seguir el DDL y modelo de datos establecido en `ddl_plan.md` y `DEVELOPMENT_POLICY.md`.
- Validar cambios contra datos reales del Excel `milo_tracker_v6.xlsm` cuando se trabaje en migración.
- No crear dashboard sin antes cerrar el modelo de datos.
- Todo debe ser robusto, no un prototipo.
- No usar Google Sheets como fuente principal en la app final.
