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

El proyecto está en **Fase 6**. No saltar fases.

| Fase | Estado |
|------|--------|
| 0 - Alinear Reglas Del Negocio | cerrado |
| 1 - DDL Final Y Base De Datos | cerrado |
| 2 - Setup Técnico De La App | cerrado |
| 3 - Migración De Datos | cerrado |
| 4 - Refactor Del Bot | cerrado |
| 5 - API Interna | cerrado |
| 6 - Dashboard MVP | cerrado |
| 7 - Administración | pendiente |
| 8 - Inteligencia Y Automatización | pendiente |

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

## Stack Oficial

- **Next.js** full-stack
- **PostgreSQL** como fuente oficial
- **Prisma** para migrations/schema
- **Tailwind CSS** + **shadcn/ui** para frontend
- **WhatsApp Cloud API** para bot
- **Google Sheets API** solo como integración secundaria

## Reglas De Código

- No usar emojis en archivos `.md` del proyecto salvo que el usuario lo pida explícitamente.
- Seguir el DDL y modelo de datos establecido en `ddl_plan.md` y `DEVELOPMENT_POLICY.md`.
- Validar cambios contra datos reales del Excel `milo_tracker_v6.xlsm` cuando se trabaje en migración.
- No crear dashboard sin antes cerrar el modelo de datos.
- Todo debe ser robusto, no un prototipo.
- No usar Google Sheets como fuente principal en la app final.
