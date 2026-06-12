# Issues Fase 1 - DDL Final Y Base De Datos

## Issue #6: Instalar PostgreSQL

**Title:** `Fase 1 - Instalar PostgreSQL`

**Body:**
```
## Objetivo
Tener PostgreSQL funcionando en la maquina de desarrollo.

## Prerequisito
PostgreSQL no esta instalado. Hay que instalarlo antes de cualquier otro task.

## Opciones de instalacion (elegir una)
1. **Windows**: Descargar desde https://www.postgresql.org/download/windows/ y ejecutar instalador
2. **winget**: `winget install PostgreSQL.PostgreSQL.17`
3. **Docker**: `docker run -d --name gastos-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:17`
4. **Cloud**: Usar Supabase (supabase.com) o Neon (neon.tech) - tier gratuito

## Configuracion minima
- Puerto: 5432 (default)
- Usuario: postgres
- Password: definir en .env
- Base de datos: gastos

## Verificacion
- `psql --version` funciona
- `psql -U postgres -c "SELECT 1"` retorna 1

## Criterio de aceptacion
- PostgreSQL esta corriendo y accesible
- Se puede crear la base de datos "gastos"
```

**Labels:** `fase-1`, `prioridad-alta`, `prerequisito`

---

## Issue #7: Setup Prisma y schema

**Title:** `Fase 1 - Setup Prisma y schema`

**Body:**
```
## Objetivo
Configurar Prisma con el schema basado en el DDL.

## Prerequisito
Issue #6 completado (PostgreSQL instalado y corriendo).

## Tarea
1. Crear prisma/schema.prisma basado en ddl_plan.md
2. Configurar DATABASE_URL en .env
3. Ejecutar prisma migrate dev --name init
4. Verificar que todas las tablas se crean

## Archivos a crear
- prisma/schema.prisma
- Actualizar .env con DATABASE_URL

## Criterio de aceptacion
- prisma migrate dev crea todas las tablas
- prisma studio muestra las tablas vacias
```

**Labels:** `fase-1`, `prioridad-alta`

---

## Issue #8: Seed de datos semilla

**Title:** `Fase 1 - Crear seed de datos semilla`

**Body:**
```
## Objetivo
Insertar datos iniciales: usuarios, categorias, metodos de pago, cuentas, quincenas.

## Prerequisito
Issue #7 completado (schema creado y migrado).

## Tarea
1. Crear prisma/seed.js con:
   - 2 usuarios (Rene, Mariana)
   - 9 categorias oficiales
   - 4 metodos de pago
   - 7 cuentas
   - 20 quincenas (Q23-Q42)
2. Configurar package.json para usar seed
3. Ejecutar prisma db seed

## Archivos a crear
- prisma/seed.js
- Actualizar package.json

## Criterio de aceptacion
- prisma db seed ejecuta sin errores
- Conteos: 2 users, 9 categorias, 4 metodos, 7 cuentas, 20 quincenas
```

**Labels:** `fase-1`, `prioridad-alta`

---

## Issue #9: Generar cliente Prisma

**Title:** `Fase 1 - Generar cliente Prisma y tipos`

**Body:**
```
## Objetivo
Generar el cliente de Prisma para usar en la app.

## Prerequisito
Issue #7 completado.

## Tarea
1. Ejecutar prisma generate
2. Crear src/lib/prisma.js con instancia singleton
3. Verificar que se puede importar y hacer queries basicas

## Archivos a crear
- src/lib/prisma.js

## Criterio de aceptacion
- prisma generate no tiene errores
- Se puede hacer una query basica desde src/lib/prisma.js
```

**Labels:** `fase-1`, `prioridad-alta`

---

## Issue #10: Vista de dashboard principal

**Title:** `Fase 1 - Crear vista de dashboard principal`

**Body:**
```
## Objetivo
Crear vista SQL que resuma el Dashboard del Excel.

## Tarea
1. Crear vista v_dashboard_resumen con:
   - Ingresos por quincena
   - Presupuesto total
   - Gastado real
   - Pendiente
   - Margen
   - % consumido
2. Validar contra datos del Excel

## Criterio de aceptacion
- Vista retorna datos correctos para Q24, Q25, Q26
- Totales coinciden con Excel
```

**Labels:** `fase-1`, `prioridad-media`

---

## Issue #11: Script de verificacion

**Title:** `Fase 1 - Script de verificacion de DDL`

**Body:**
```
## Objetivo
Script que verifique que todo se creo correctamente.

## Tarea
1. Crear scripts/verify.js que verifique:
   - Todas las tablas existen
   - Todas las vistas existen
   - Seeds insertados correctamente
   - Integridad referencial

## Criterio de aceptacion
- Script reporta "OK" en todas las verificaciones
```

**Labels:** `fase-1`, `prioridad-media`

---

## Resumen de Issues Fase 1

| Issue | Titulo | Prioridad | Dependencias |
|-------|--------|-----------|--------------|
| #6 | Instalar PostgreSQL | Alta | Ninguna |
| #7 | Setup Prisma y schema | Alta | #6 |
| #8 | Seed de datos semilla | Alta | #7 |
| #9 | Generar cliente Prisma | Alta | #7 |
| #10 | Vista de dashboard | Media | #7 |
| #11 | Script verificacion | Media | #7 |

## Orden de ejecucion

1. Issue #6 (Instalar PostgreSQL) - **PREREQUISITO**
2. Issue #7 (Setup Prisma)
3. Issue #8 (Seed)
4. Issue #9 (Cliente Prisma)
5. Issue #10 (Vista dashboard)
6. Issue #11 (Verificacion)

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
