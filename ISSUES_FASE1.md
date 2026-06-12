# Issues Fase 1 - DDL Final Y Base De Datos

## Issue #6: Setup PostgreSQL y Prisma

**Title:** `Fase 1 - Setup PostgreSQL y Prisma`

**Body:**
```
## Objetivo
Configurar la infraestructura de base de datos para el proyecto.

## Contexto
El DDL esta definido en ddl_plan.md. Ahora hay que convertirlo en una base real.

## Tarea
1. Crear schema de Prisma basado en el DDL de ddl_plan.md
2. Configurar conexion a PostgreSQL (usar .env.example como referencia)
3. Crear migracion inicial con prisma migrate
4. Verificar que la DB crea todas las tablas correctamente
5. Crear script de seed que inserte los datos semilla (usuarios, categorias, metodos_pago, cuentas, quincenas)

## Archivos a crear
- prisma/schema.prisma
- prisma/seed.ts o prisma/seed.js
- Actualizar .env.example con DATABASE_URL

## Criterio de aceptacion
- prisma migrate dev crea todas las tablas
- prisma db seed inserta datos semilla
- No hay errores de integridad referencial
```

**Labels:** `fase-1`, `prioridad-alta`

---

## Issue #7: Generar tipos de Prisma y cliente

**Title:** `Fase 1 - Generar tipos de Prisma y cliente`

**Body:**
```
## Objetivo
Generar el cliente de Prisma y tipos TypeScript para usar en la app.

## Contexto
Despues de crear el schema y migraciones, hay que generar el cliente para poder interactuar con la DB desde el codigo.

## Tarea
1. Ejecutar prisma generate
2. Verificar que los tipos se generan correctamente
3. Crear instancia singleton del cliente Prisma para usar en toda la app
4. Crear archivo src/lib/prisma.ts (o .js) con la instancia

## Archivos a crear
- src/lib/prisma.ts
- Verificar que prisma/seed.ts funciona

## Criterio de aceptacion
- prisma generate no tiene errores
- Se puede importar PrismaClient desde src/lib/prisma.ts
- Los tipos reflejan todas las tablas del DDL
```

**Labels:** `fase-1`, `prioridad-alta`

---

## Issue #8: Vista de dashboard principal

**Title:** `Fase 1 - Crear vista de dashboard principal`

**Body:**
```
## Objetivo
Crear una vista SQL que resuma lo que el Dashboard del Excel muestra.

## Contexto
El Excel tiene un Dashboard que muestra por quincena:
- Ingresos
- Presupuesto total
- Margen (Ingresos - Presupuesto)
- Liquido real (Ingresos - Gastado real)
- % consumido
- Lista de gastos pendientes por descripcion

## Tarea
1. Crear vista v_dashboard_resumen que calcule:
   - Ingresos por quincena
   - Presupuesto total por quincena
   - Gastado real por quincena
   - Pendiente por pagar
   - Margen
   - % consumido
2. Esta vista debe alimentar el dashboard web

## Archivos a modificar
- ddl_plan.md: agregar vista v_dashboard_resumen
- o crear archivo sql/vistas.sql

## Criterio de aceptacion
- La vista retorna datos correctos para Q24, Q25, Q26
- Los totales coinciden con el Excel:
  - Q24: Ingresos 28,330.65 | Gastos 26,029.42 | Balance 2,301.23
  - Q25: Ingresos 23,346 | Gastos 22,412.74 | Balance 933.26
```

**Labels:** `fase-1`, `prioridad-media`

---

## Issue #9: Script de verificacion de DDL

**Title:** `Fase 1 - Script de verificacion de DDL`

**Body:**
```
## Objetivo
Crear un script que verifique que el DDL se ejecuto correctamente.

## Contexto
Despues de ejecutar las migraciones y seeds, necesitamos confirmar que todo esta bien antes de migrar datos.

## Tarea
1. Crear script que verifique:
   - Todas las tablas existen
   - Todas las vistas existen
   - Seeds insertados correctamente (9 categorias, 2 usuarios, 7 cuentas, 4 metodos, 20 quincenas)
   - Integridad referencial (no hay FK rotas)
   - Enums creados correctamente

## Archivos a crear
- scripts/verify-ddl.sql o scripts/verify-ddl.js

## Criterio de aceptacion
- El script reporta "OK" en todas las verificaciones
- No hay errores de tablas faltantes o datos inconsistentes
```

**Labels:** `fase-1`, `prioridad-media`

---

## Issue #10: Actualizar AGENTS.md con estado Fase 1

**Title:** `Fase 1 - Actualizar estado de fases en AGENTS.md`

**Body:**
```
## Objetivo
Mantener AGENTS.md actualizado con el progreso real.

## Contexto
AGENTS.md debe reflejar que Fase 1 esta en progreso y que issues estan completados.

## Tarea
1. Actualizar tabla de fases en AGENTS.md
2. Marcar Fase 1 como "en progreso"
3. Agregar entregables completados de Fase 1
4. Verificar que DEVELOPMENT_POLICY.md tambien esta actualizado

## Criterio de aceptacion
- AGENTS.md refleja el estado real del proyecto
- No hay inconsistencias entre AGENTS.md y DEVELOPMENT_POLICY.md
```

**Labels:** `fase-1`, `prioridad-baja`

---

## Resumen de Issues Fase 1

| Issue | Titulo | Prioridad | Dependencias |
|-------|--------|-----------|--------------|
| #6 | Setup PostgreSQL y Prisma | Alta | Ninguna |
| #7 | Generar tipos de Prisma | Alta | #6 |
| #8 | Vista de dashboard principal | Media | #6 |
| #9 | Script de verificacion | Media | #6 |
| #10 | Actualizar AGENTS.md | Baja | Todos anteriores |

## Orden de ejecucion recomendado

1. Issue #6 (Setup PostgreSQL y Prisma)
2. Issue #7 (Generar tipos)
3. Issue #8 (Vista dashboard)
4. Issue #9 (Script verificacion)
5. Issue #10 (Actualizar docs)
