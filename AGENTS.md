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

El proyecto está en **Fase 0**. No saltar fases.

| Fase | Estado |
|------|--------|
| 0 - Alinear Reglas Del Negocio | pendiente |
| 1 - DDL Final Y Base De Datos | pendiente |
| 2 - Setup Técnico De La App | pendiente |
| 3 - Migración De Datos | pendiente |
| 4 - Refactor Del Bot | pendiente |
| 5 - API Interna | pendiente |
| 6 - Dashboard MVP | pendiente |
| 7 - Administración | pendiente |
| 8 - Inteligencia Y Automatización | pendiente |

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
