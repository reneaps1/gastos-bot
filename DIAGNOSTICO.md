# Diagnóstico del Sistema — Milo Gastos

Fecha: 2026-08-25
Alcance: bot de WhatsApp (raíz del repo) + dashboard Next.js (`dashboard/`) + infraestructura (Render, Prisma, docs).
Método: lectura de la documentación oficial (`AGENTS.md`, `DEVELOPMENT_POLICY.md`, `ddl_plan.md`, issues de fase) contrastada contra el código real, más tres auditorías dirigidas (bot, dashboard, config/dependencias/deploy).

---

## Resumen muy claro (léelo primero)

El sistema funciona y está desplegado, pero tiene **tres roturas serias** y bastante **grasa acumulada de la migración**:

1. **El dashboard no tiene ninguna autenticación.** Cualquiera con la URL ve y edita todas las transacciones, presupuestos, deudas y liquidez de la familia. Peor aún: existe una variable `ADMIN_PASSWORD` definida en `.env.example` y en `render.yaml` que sugiere que alguna vez se planeó un candado — pero nunca se escribió el código que la usa. Es un candado fantasma: está la variable, no está la puerta.
2. **Las vistas SQL del dashboard (`views.sql`) nunca se han aplicado en producción**, y estructuralmente *no pueden* aplicarse solas: el archivo vive suelto en `prisma/migrations/views.sql` en vez de dentro de una carpeta de migración numerada, así que `prisma migrate deploy` (que corre en cada arranque) lo ignora siempre. Este pendiente lleva desde junio en la memoria del proyecto y seguirá "pendiente" para siempre si no se convierte en una migración real.
3. **Hay dos copias independientes del schema de Prisma** (`prisma/` en la raíz y `dashboard/prisma/`) que ya divergieron: el dashboard tiene un campo (`fechaVencimiento` en `Credito`) que la raíz no tiene, y la raíz tiene una migración inicial (`init`) y el `views.sql` que el dashboard no tiene. Cada servicio migra su propia base de datos con su propia historia. Es cuestión de tiempo antes de que esto rompa algo en producción de forma silenciosa.

Además, la Fase 8 ("Inteligencia y Automatización", marcada "en progreso" en `AGENTS.md`) está **completamente apagada en producción** — el código de Gemini/Todoist existe y funciona, pero `GEMINI_API_KEY` no está configurada en `render.yaml`, así que en producción `gemini.isEnabled()` siempre es `false`. Nadie está usando esas alertas inteligentes hoy.

El resto son sobras normales de una migración (scripts de inspección de Excel que ya cumplieron su función, una ruta de API sin usar, un par de dependencias muertas) — fáciles de limpiar, sin riesgo.

---

## Hallazgos críticos (arreglar primero)

### 1. Dashboard completamente abierto — sin login, sin middleware, sin sesión — RESUELTO (2026-08-25)

> Implementado: login real con usuario `rene.aps` / password dummy `pass1234` (cambiable desde Configuración → Mi cuenta), sesión de 180 días que se renueva en cada visita (para que quede abierta en varios dispositivos), y `proxy.ts` (el `middleware.ts` de Next 15 se renombró a `proxy.ts` en Next 16 — por eso no bastaba con el nombre viejo) protegiendo todas las páginas y rutas de API salvo `/login`, `/privacy` y `/api/health`. Falta que Rene configure `SESSION_SECRET` en el Environment de `gastos-dashboard` en Render antes del próximo deploy — sin esa variable el servicio no arranca en producción (a propósito, para no correr con un secreto por defecto). Detalle completo abajo, se deja como referencia histórica.



- No existe `middleware.ts`, ni ninguna verificación de sesión/JWT/cookie en `dashboard/src/app/api/**`, ni página de login.
- `DEVELOPMENT_POLICY.md` ya listaba esto como riesgo conocido ("Falta de autenticación para app web") desde antes de construir el dashboard — sigue sin resolverse hoy, con el sistema ya en producción y con datos financieros reales.
- **La variable `ADMIN_PASSWORD` existe en `.env.example`, en `dashboard/.env.local` y en `render.yaml` (servicio `gastos-bot`), pero no aparece referenciada en ningún archivo `.js`/`.ts` del repo.** Es una intención de auth que quedó a medio camino — probablemente para proteger el bot o el dashboard con una contraseña simple, y nunca se conectó a nada.
- Impacto: cualquiera con la URL de `gastos-dashboard.onrender.com` puede ver saldos, editar transacciones, borrar deudas, etc.

**Sugerencia:** decidir el nivel de protección real que se necesita (¿solo tú y Mariana? ¿basta con una contraseña compartida?) y luego:
- Opción mínima: usar `ADMIN_PASSWORD` de verdad — un `middleware.ts` en el dashboard que pida una cookie/basic-auth simple.
- Opción robusta: NextAuth (o similar) con los dos usuarios reales (Rene, Mariana) en vez de una contraseña compartida.
- No dejar la variable declarada sin uso — o se implementa o se borra para no confundir a futuro.

### 2. `views.sql` nunca se aplica — las páginas de análisis dependen de vistas que no existen en la BD

- Archivo: `prisma/migrations/views.sql`. Está en la raíz de `migrations/`, no dentro de una carpeta `TIMESTAMP_nombre/migration.sql` como las otras 14 migraciones reales.
- Prisma solo ejecuta migraciones dentro de carpetas numeradas registradas en `_prisma_migrations`. Un `.sql` suelto en la raíz **nunca se ejecuta**, ni en desarrollo ni en `prisma migrate deploy` (que corre en cada arranque del bot y del dashboard).
- Vistas afectadas: `v_resumen_quincenal`, `v_estado_deudas`, `v_ejecucion_presupuesto`, `v_corte_liquidez`, `v_liquidez`, y las más nuevas de `ddl_plan.md` (`v_consumo_quincenal`, `v_credito_pagos_quincena`) — no está confirmado que estas dos últimas siquiera estén en el `views.sql` actual.
- Esto coincide con lo que ya sabíamos por memoria del proyecto ("Correr views.sql en la DB — Alta prioridad"), pero el motivo real de por qué sigue pendiente es estructural, no solo un olvido: nadie lo puede "correr" con el flujo normal de deploy, hay que aplicarlo a mano cada vez, y probablemente nunca se hizo desde junio.

**Sugerencia:** convertir `views.sql` en una migración real (`npx prisma migrate dev --name add_views` con el contenido actual, o una migración manual con `CREATE OR REPLACE VIEW`) en **ambos** proyectos Prisma, para que viaje con el flujo normal de `migrate deploy` y quede aplicada de forma reproducible.

### 3. Dos schemas de Prisma independientes, ya divergentes

- `prisma/schema.prisma` (raíz, usado por el bot) y `dashboard/prisma/schema.prisma` (usado por el dashboard) deberían ser el mismo modelo de datos, pero son dos archivos separados que alguien debe mantener sincronizados a mano.
- Diferencia ya detectada: `dashboard/prisma/schema.prisma` tiene `fechaVencimiento DateTime? @map("fecha_vencimiento") @db.Date` en el modelo `Credito`; la raíz no lo tiene.
- Las carpetas de migraciones también divergieron: la raíz tiene 14 migraciones (incluye `20260613123600_init` y `views.sql`), el dashboard tiene 13 (falta `init` y falta `views.sql`). A partir de `20260615034000_creditos_y_pagos` las dos historias coinciden en nombre — parece que el dashboard se copió de la raíz en algún punto, saltándose la migración inicial (probablemente porque apuntaba a una BD que ya tenía esas tablas), y desde entonces ambas ramas se editan por separado.
- Cada servicio corre `prisma migrate deploy` con su propia carpeta de migraciones contra la misma base de datos compartida. Si algún día se agrega una migración solo en un lado (como ya pasó con `fechaVencimiento`), el otro servicio queda con un cliente Prisma que no coincide con la base real, sin que nada lo avise hasta que truene en producción.

**Sugerencia:** elegir una sola fuente de verdad para el schema de Prisma (lo natural es que sea el del dashboard, ya que es el que sirve la mayoría de la lógica de negocio) y hacer que el bot la reutilice — por ejemplo, moviendo `prisma/` a la raíz compartida y apuntando ambos `package.json` al mismo `schema.prisma`/`migrations/`, o generando el cliente del bot a partir del schema del dashboard vía un paso de build. Mientras no se resuelva, cualquier cambio de modelo debe aplicarse a mano en los dos lados y no hay garantía de que eso se recuerde siempre.

### 4. Fase 8 (IA / alertas inteligentes) está programada pero apagada en producción

- `src/gemini.js` y `src/todoist.js` están completos y conectados en `src/index.js`: si el mensaje de WhatsApp se clasifica como tarea, se crea en Todoist; Gemini también responde preguntas y da contexto.
- En producción, `gemini.isEnabled()` depende de `GEMINI_API_KEY`, que **no está declarada en `render.yaml`** (sí lo está `TODOIST_API_TOKEN`, curiosamente). Resultado: en el servicio real, todo el bloque de Gemini queda desactivado — no hay clasificación inteligente, no hay respuestas, y por lo tanto tampoco se generan tareas en Todoist (dependen de que Gemini clasifique el mensaje).
- `GEMINI_API_KEY`, `GEMINI_MODEL`, `TODOIST_API_TOKEN` (este sí está en `render.yaml` pero no en `.env.example`) tampoco están documentadas de forma consistente entre `.env.example` y `render.yaml`.

**Sugerencia:** si Fase 8 sigue siendo una prioridad, agregar `GEMINI_API_KEY`/`GEMINI_MODEL` a `render.yaml` y probar el flujo end-to-end en producción. Si ya no es prioridad, actualizar `AGENTS.md` para reflejar que Fase 8 está "pausada" en vez de "en progreso" — ahora mismo el documento dice una cosa y la producción hace otra.

---

## Código y archivos que ya se pueden quitar

Sobras de la migración de Excel/Sheets que ya cumplieron su función y no las usa nada del sistema en marcha:

| Archivo | Por qué se puede quitar |
|---|---|
| `scripts/inspect-excel.js` | Exploración puntual del `.xlsm` durante la migración; nada lo importa. |
| `scripts/inspect-excel-detail.js` | Igual, exploración puntual. |
| `scripts/inspect-ahorro.js` | Debug ad-hoc de una categoría específica, no parametrizado. |
| `scripts/inspect-captura.js` | Debug ad-hoc de la hoja "Captura". |
| `scripts/inspect-captura-issues.js` | Debug ad-hoc de inconsistencias de captura. |
| `scripts/debug-q25.js` | Debug de una quincena específica (Q25), ya resuelto. |
| `scripts/verify.js` | No referenciado por nada; el `Issue #11` que lo originó ya está "completado" en la documentación. |
| `prisma/scripts/fix-quincena-month-end.js` | Script de arreglo puntual de fechas de quincena, no referenciado por nada; las migraciones `fix_quincena_q28_q29_q36_q37_dates` y `fix_quincena_q33_a_q42_fechas` sugieren que ya se aplicó. |
| `dashboard/scripts/build-ios.sh`, `dashboard/scripts/build-ios.ps1` | No están enlazados a ningún script de `package.json`; si de verdad se van a usar para el build de iOS en Mac, conviene documentarlo en `AGENTS.md`, si no, se pueden borrar. |
| `dashboard/src/app/api/dashboard/route.ts` | Ninguna página hace `fetch` a `/api/dashboard`; la página principal usa `/api/quincenas`, `/api/configuracion`, `/api/transacciones`, etc. por separado. |

Antes de borrar, revisar puntualmente:

- `scripts/migrate-excel.js` — es el script de migración real (no un debug). Consérvalo como archivo histórico/documentación aunque no se vuelva a correr, o muévelo a algo como `scripts/archive/` si quieres sacarlo del directorio activo.
- `scripts/clean-db.js` — utilidad destructiva de reseteo de BD, sin referencias ni documentación. Confirma si la sigues usando en desarrollo local; si sí, agrégale un comentario/README de advertencia; si no, bórrala (es peligrosa para dejar suelta sin contexto).
- `dashboard/src/app/api/whatsapp-messages/route.ts` — no tiene `fetch` desde el dashboard, pero antes de borrarla confirma que no la use el bot u otro proceso externo directamente.

Dependencias que parecen sin uso (confirmar con un intento real de build sin ellas antes de quitarlas):

- Raíz: `ts-node`, `typescript` — el proyecto es JS puro (`"type": "commonjs"`), no hay `.ts` compilándose en `src/`. Puede ser sobra de un scaffold inicial.
- Dashboard: `exceljs` — no aparece importado en ningún archivo bajo `dashboard/src` (los reportes usan `html2canvas`/`jspdf`/`recharts`, no `exceljs`).

Variable sin uso:

- `META_APP_ID` en `.env.example` — no se lee con `process.env` en ningún archivo de `src/`.

Detalle menor de config: el script `cap:release` en `dashboard/package.json` apunta a `ios/App/App.xcworkspace`, pero solo existe `ios/App/App.xcodeproj/project.xcworkspace` — ese comando fallaría tal cual está si se corriera hoy. Consistente con que Fase 9 sigue pendiente de terminarse en Mac (issues #30/#31/#33).

---

## Deuda de documentación (lo que dicen los docs vs. lo que hay)

- `AGENTS.md`/`DEVELOPMENT_POLICY.md` proponen como estructura del bot los módulos `whatsapp`, `parser`, `classifier`, `transactions`, `analytics`, `sheets-export`, `database`. La estructura real (`src/analytics.js`, `database.js`, `gemini.js`, `index.js`, `media.js`, `parser.js`, `quincenas.js`, `sheets.js`, `todoist.js`, `whatsapp.js`) es más plana y no separa `classifier`/`transactions` como módulos propios (esa lógica vive repartida en `gemini.js` e `index.js`). No es un bug, pero si alguien nuevo lee `AGENTS.md` esperando encontrar `src/classifier.js` no lo va a encontrar.
- El `render.yaml` no es la fuente de verdad para los servicios ya creados en Render (esto ya está documentado en `AGENTS.md`), pero además contiene redundancia real: `prisma generate` se ejecuta hasta 3 veces por deploy del bot (en `buildCommand`, en `startCommand`, y otra vez dentro de `src/index.js` al arrancar). Funciona, pero es ruido que puede limpiarse ahora que ya se entendió el patrón correcto (memoria del proyecto ya documenta por qué se hace en `src/index.js`; sobra repetirlo en `buildCommand`/`startCommand`).
- `dashboard/.env.local` tiene copiadas variables que el dashboard nunca lee (`META_VERIFY_TOKEN`, `META_ACCESS_TOKEN`, `META_PHONE_NUMBER_ID`, `GOOGLE_SHEET_ID`, `GOOGLE_SHEETS_ENABLED`, `GOOGLE_CREDENTIALS_JSON`) — parece una copia del `.env.example` de la raíz pegada sin filtrar. El dashboard, según su propio `src/lib/prisma.ts`, solo necesita `DATABASE_URL` y `NODE_ENV`.

---

## Cosas que están bien y no hace falta tocar

- Sin secretos filtrados en git (`.env`, credenciales, `.xlsm`/`.xlsx` están bien ignorados en ambos `.gitignore`).
- Integración de Google Sheets correctamente implementada y apagable (`GOOGLE_SHEETS_ENABLED`), tal como pedía `DEVELOPMENT_POLICY.md`.
- Cero `TODO`/`FIXME`/`console.log` de debug sueltos en el código — el código en sí está limpio, el problema es más de piezas sueltas a nivel de proyecto que de código sucio dentro de los archivos.
- Todas las páginas y componentes del dashboard están enlazados y en uso (no hay pantallas huérfanas ni componentes muertos, salvo la ruta de API señalada arriba).
- `.agents/`, `.claude/`, `skills-lock.json` son configuración de herramientas de desarrollo (Claude Code), correctamente ignorados por git, no forman parte del runtime — no requieren limpieza.

---

## Qué hacer y en qué orden (sugerido)

1. **Seguridad ya**: decidir el modelo de auth del dashboard e implementarlo (o al menos poner una contraseña básica usando `ADMIN_PASSWORD`, que ya existe declarada). Es información financiera familiar expuesta públicamente hoy.
2. **Convertir `views.sql` en migración real** en ambos proyectos Prisma y aplicarla en producción — desbloquea las páginas de análisis que dependen de esas vistas.
3. **Unificar los dos schemas de Prisma** en una sola fuente de verdad (o al menos documentar y automatizar cómo se mantienen sincronizados) antes de que la divergencia actual (`fechaVencimiento`) cause un error en producción.
4. **Decidir el destino de Fase 8**: activarla de verdad (agregar `GEMINI_API_KEY` a Render) o marcarla como pausada en la documentación para que deje de decir "en progreso" sin estarlo.
5. **Limpieza de bajo riesgo**: borrar los scripts de inspección de Excel ya cumplidos, la ruta `/api/dashboard` sin usar, y las dependencias/variables sin uso listadas arriba.
6. **Documentación**: actualizar `AGENTS.md` para que la estructura de módulos descrita coincida con la real, y limpiar `dashboard/.env.local` de variables que no le corresponden.
