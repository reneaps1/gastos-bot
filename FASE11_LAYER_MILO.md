# Fase 11 - Layer Milo: Asistente Multicanal

Documento base de diseño. Debe leerse completo antes de escribir código de esta fase.

Estado: **planeado**. Ninguna tarea de este documento está implementada.

## 1. Objetivo

Milo hoy tiene un motor financiero potente y una superficie de entrada estrecha: un bot de WhatsApp que registra gastos y responde preguntas, y un dashboard web para quien sepa navegarlo. Toda la complejidad real del dominio — quincenas secuenciales, presupuesto con revisiones y transferencias, créditos con fecha de consumo separada de la fecha de impacto, apartados, liquidez teórica contra real, conciliación plan-vs-caja — vive en la base de datos, pero no hay forma amigable de consultarla ni de actuar sobre ella.

La Fase 11 construye **un solo layer conversacional** encima de esa complejidad:

- Un personaje único (Milo) con una identidad coherente en todos los canales.
- Memoria persistente por usuario.
- Acceso real al sistema: lectura, escritura y acciones de gestión.
- Alcanzable por mensajes (WhatsApp, Telegram), voz telefónica y eventualmente video.
- Capaz de tomar la iniciativa cuando algo financiero se rompe.

El principio rector: **la complejidad no se simplifica, se envuelve.** El dashboard y el modelo de datos siguen siendo la fuente de verdad; el layer es una capa de traducción entre lenguaje natural y el dominio.

## 2. Decisiones cerradas

Cerradas con Rene mediante cuestionario. No se re-litigan sin acuerdo explícito.

| # | Tema | Decisión |
|---|---|---|
| 1 | Canal MVP | Los tres se consideran en el diseño desde el día uno; la implementación es por fases |
| 2 | Telefonía | Sin preferencia previa; se adopta la recomendación de la sección 8 |
| 3 | Motor IA | Reusar y extender `src/aiRouter.js` (DeepSeek primario, Gemini de respaldo). No se construye pipeline aparte |
| 4 | Acceso a datos | Lectura + escritura + acciones de gestión |
| 5 | Confirmación | Configurable por usuario |
| 6 | Persona | El mismo Milo en todos los canales, una sola identidad |
| 7 | Idioma | Configurable por usuario |
| 8 | Memoria | Persistente por usuario: un perfil que crece con hábitos, dudas frecuentes y decisiones pasadas |
| 9 | Proactividad | Reactivo, y además puede iniciar contacto en casos críticos |
| 10 | Presupuesto | Estimar el costo antes de comprometer monto (sección 12) |
| 11 | Infraestructura | Acepta tier pago, viendo el costo antes |
| 12 | Bots actuales | Unificar todo bajo un solo cerebro. Se acepta el trabajo inicial extra para no duplicar después |
| 13 | Seguridad | Whitelist de número + PIN hablado |
| 14 | Usuarios | Piloto con los 2 usuarios del hogar, arquitectura lista para escalar |

## 3. Estado verificado del repo

Hallazgos confirmados contra el código, no supuestos.

### 3.1 La rama de Telegram es puramente aditiva

```
git diff --stat main...origin/feature/telegram-budget-bot
 package.json          |   2 +
 src/aiRouter.js       |  64 ++++
 src/budgetTracker.js  | 143 ++++
 src/deepseek.js       | 192 ++++
 src/telegram-index.js | 391 ++++
 src/telegram.js       | 108 ++++
 src/telegramBrain.js  | 433 ++++
 7 files changed, 1333 insertions(+)
```

Cero borrados. `src/index.js` intacto. **No hay conflicto que negociar: se mergea tal cual antes de empezar.**

### 3.2 Dos cerebros hoy

| Canal | Ruta de IA |
|---|---|
| WhatsApp (`src/index.js`) | Llama a `src/gemini.js` directo. No pasa por router |
| Telegram (rama) | `src/telegramBrain.js` -> `src/aiRouter.js` -> DeepSeek, fallback Gemini |

WhatsApp no se beneficia hoy de DeepSeek ni de la capa determinista de Telegram. Ese es exactamente el desperdicio que la unificación elimina.

### 3.3 Piezas que ya existen y se reusan

| Pieza | Ubicación | Uso en Fase 11 |
|---|---|---|
| `getSystemContext(prisma)` | `src/gemini.js:50` | Snapshot financiero con caché de 2 min, agnóstico al proveedor. Se extrae tal cual a `src/milo/context.js` |
| `transcribeAudio(buffer, mime)` | `src/media.js:34` | Ya transcribe audio con Gemini. Es la mitad del camino de las notas de voz |
| `analyzeImage(buffer, mime)` | `src/media.js:52` | Tickets y capturas de pantalla |
| `classifyQuestionLocally(text)` | `src/telegramBrain.js:99` | Responde preguntas conocidas **sin LLM**. Se conserva como primera línea: barata, rápida y determinista |
| `answerQuestion(text, user)` | `src/telegramBrain.js:409` | Respuestas financieras ya calculadas contra Postgres |
| `complete(messages, opts)` | `src/deepseek.js:11` | Cliente OpenAI-compatible. Se le agrega soporte de `tools` |
| Singleton Prisma | `src/lib/prisma.js` | Evita saturar el pool al unificar servicios |
| `AuditLog` | `prisma/schema.prisma` | Ya tiene `source`, `userId`, `campo`, `valorAnterior`, `valorNuevo`. **Sirve sin cambios de schema** |
| Todoist | `src/todoist.js` | Se envuelve como tool `crear_tarea` |

Nota sobre `AuditLog.source`: es `VarChar(20)`. Los valores de fuente deben caber en 20 caracteres (`milo:wa`, `milo:tg`, `milo:voz`, `milo:video`, `milo:proactivo`).

### 3.4 Deuda técnica que bloquea

Confirmada contra el repo y contra `DIAGNOSTICO.md`:

| Problema | Evidencia | Por qué bloquea |
|---|---|---|
| Dos schemas Prisma divergentes | Existen `prisma/schema.prisma` y `dashboard/prisma/schema.prisma` | El cerebro escribe con un schema y el dashboard lee con otro. Divergencia silenciosa en datos financieros |
| `views.sql` nunca aplicado | `prisma/migrations/views.sql` fuera del flujo de migraciones | Las vistas de resumen no existen en prod |
| Dashboard sin auth real | `ADMIN_PASSWORD` declarada y sin usar | El layer multiplica la superficie de escritura sobre datos hoy públicos |
| Fase 8 muerta en prod | `GEMINI_API_KEY` ausente en `render.yaml` | Todo el layer depende de tener al menos un proveedor de IA vivo |
| Sin modelo de hogar | No existe `Hogar` ni `hogarId` | Retrofittear multi-tenancy después obliga a tocar cada query del dashboard |
| Free tier duerme | `render.yaml` declara `plan: free` en ambos servicios | Un cold start de ~50s mata una llamada de voz entrante y un cron no sobrevive |

## 4. Arquitectura objetivo

### 4.1 Vista general

```
   WhatsApp    Telegram    Llamada de voz    Video
      |            |             |             |
      v            v             v             v
  +---------------------------------------------------+
  |              src/channels/  (adaptadores)          |
  |   normalizan a InboundEvent, verifican whitelist   |
  +---------------------------------------------------+
                          |
                          v
  +---------------------------------------------------+
  |            src/milo/brain.js  (cerebro unico)      |
  |   persona + contexto + memoria + atajo determinista|
  +---------------------------------------------------+
          |                  |                  |
          v                  v                  v
   context.js          memory.js          providers/aiRouter.js
   (snapshot            (perfil,           (DeepSeek -> Gemini)
    financiero)          hechos,
                         resumenes)
                          |
                          v
  +---------------------------------------------------+
  |        src/milo/tools/index.js  (dispatcher)       |
  |   UNICO punto de escritura. Inyecta hogarId.       |
  |   Aplica policy.js. Escribe AuditLog.              |
  +---------------------------------------------------+
                          |
                          v
                     PostgreSQL
```

### 4.2 Estructura de archivos nueva

```
src/milo/
  brain.js              orquestador del turno
  context.js            getSystemContext(prisma, hogarId)  <- movido de gemini.js:50
  memory.js             loadMemory / recordTurn / summarizeSession
  persona.js            prompt de Milo, idioma y tono por usuario
  policy.js             requiresConfirmation / requiresPin / abrirSesionEscritura
  pending.js            PendingAction: crear, resolver, expirar
  types.js              InboundEvent, OutboundMessage, ToolResult
  tools/
    index.js            catalogo + dispatcher + AuditLog
    consultas.js        tools de lectura
    transacciones.js    registrar / editar / eliminar
    presupuesto.js      mover / ajustar linea
    quincena.js         cerrar quincena
    creditos.js         registrar pago
    apartados.js        crear / abonar
    tareas.js           wrapper de todoist.js
  providers/
    aiRouter.js         movido, + metodo run() con tools
    deepseek.js         movido, + soporte de tools
    gemini.js           movido, + functionDeclarations
  proactive/
    rules.js            reglas puras (contexto) -> Evento[]
    dispatcher.js       dedupe + envio

src/channels/
  whatsapp.js           adaptador (envuelve el src/whatsapp.js actual)
  telegram.js           adaptador (envuelve el src/telegram.js de la rama)
  voice.js              webhook del motor de voz (Fase 11.3)
```

### 4.3 Contrato del cerebro

```js
// src/milo/types.js
/**
 * InboundEvent
 *   hogarId    Int
 *   userId     Int | null      null = numero no reconocido
 *   canal      'wa' | 'tg' | 'voz' | 'video'
 *   sessionId  String          agrupa turnos de una conversacion
 *   tipo       'texto' | 'audio' | 'imagen' | 'confirmacion'
 *   texto      String
 *   media      { buffer, mimeType } | null
 *   meta       { messageId, from, timestamp }
 *
 * OutboundMessage
 *   texto      String
 *   audio      Buffer | null   solo si el canal lo pide
 *   pending    PendingAction | null
 *   provider   'deepseek' | 'gemini' | 'local'
 */
```

```js
// src/milo/brain.js
async function handleTurn(event) // -> OutboundMessage
```

Secuencia interna de `handleTurn`:

1. **Whitelist.** Si `event.userId` es null, responder genérico. Nunca tocar datos. (La verificación real ocurre antes, en el adaptador de canal.)
2. **Confirmación pendiente.** Si hay un `PendingAction` vivo para esa sesión y el turno lo resuelve (sí/no), ejecutar o descartar. Retornar.
3. **Atajo determinista.** `telegramBrain.classifyQuestionLocally(texto)`. Si hay match, responder sin LLM. Registrar turno y retornar.
4. **Armar el prompt**: persona + idioma del perfil + memoria (sección 7) + snapshot financiero de `context.js` + últimos 6 turnos.
5. **Llamar** a `aiRouter.run({ messages, tools })`.
6. **Despachar tool calls** vía `tools/index.js`. Si alguna requiere confirmación o PIN, crear `PendingAction` y retornar la pregunta en lugar de ejecutar.
7. **Registrar** el turno en `MiloTurno` y extraer hechos nuevos a `MiloMemoria`.

### 4.4 Extensión del router de proveedores

Se **agrega** un método a `src/aiRouter.js` sin tocar los tres existentes. `classify`, `answer` y `chat` se conservan como shims para que `src/telegram-index.js` siga funcionando durante la migración.

```js
// src/milo/providers/aiRouter.js
async function run({ messages, tools, temperature = 0.3, maxTokens = 800 })
// -> { text, toolCalls: [{ id, name, args }], provider }
```

| Proveedor | Forma de tool calling | Trabajo |
|---|---|---|
| DeepSeek | OpenAI-compatible: `tools: [{type:'function', function:{...}}]` | Extender `complete()` en `src/deepseek.js:11` para aceptar y devolver `tool_calls` |
| Gemini | `functionDeclarations` en `tools` | Adaptador que traduce JSON Schema a la forma de Gemini y normaliza la respuesta |

El orden del fallback no cambia: DeepSeek primero, Gemini si el primero falla o está deshabilitado.

### 4.5 Migración de canales sin big-bang

- **Telegram**: `src/telegram-index.js` deja de ser un proceso aparte. Su router de `/telegram/webhook` se monta dentro de `src/index.js`. Un solo proceso Express, un solo caché de contexto, un servicio menos en Render.
- **WhatsApp**: `src/index.js` llama hoy a `gemini.js` directo dentro del handler `/webhook`. Esas llamadas se reemplazan por `brain.handleTurn()` **detrás del flag `MILO_BRAIN_ENABLED`**, dejando el camino viejo intacto. WhatsApp es el único canal vivo en producción: no se toca sin flag y sin rollback probado.

## 5. Catálogo de tools

Forma de cada tool:

```js
{
  name: 'registrar_transaccion',
  description: 'Registra un gasto, ingreso o ahorro en el sistema.',
  parameters: { /* JSON Schema estricto */ },
  risk: 'read' | 'write' | 'critical',
  handler: async (ctx, args) => ToolResult
}
```

`ctx` contiene `{ prisma, hogarId, userId, canal, sesionEscrituraActiva }`. **`hogarId` nunca viene del LLM**: lo inyecta el dispatcher.

### 5.1 Lectura (`risk: 'read'`, nunca confirman)

| Tool | Parámetros | Devuelve |
|---|---|---|
| `consultar_saldo` | `{ cuentaId? }` | Liquidez real y teórica, por cuenta o total |
| `consultar_presupuesto` | `{ quincena?, categoria?, linea? }` | Presupuestado, ejecutado, restante, semáforo |
| `consultar_quincena` | `{ quincena? }` | Rango de fechas, ingresos, gastos, margen, estado de cierre |
| `listar_transacciones` | `{ desde?, hasta?, categoria?, tipo?, limite? }` | Lista acotada (máx 25) |
| `estado_creditos` | `{ creditoId? }` | Saldo, próximos pagos, fecha de vencimiento |
| `estado_apartados` | `{ apartadoId? }` | Meta, acumulado, avance |
| `proyeccion_cierre` | `{ quincena? }` | Proyección de cierre de quincena (lógica de Fase 8) |

### 5.2 Escritura (`risk: 'write'`)

| Tool | Parámetros | Confirmación |
|---|---|---|
| `registrar_transaccion` | `{ monto, tipo, categoria, descripcion, metodoPago?, fecha?, creditoId? }` | Según `MiloPerfil.nivelConfirmacion` |
| `editar_transaccion` | `{ transaccionId, campos }` | Siempre |
| `eliminar_transaccion` | `{ transaccionId }` | Siempre |
| `crear_tarea` | `{ contenido, dueString?, prioridad? }` | Según perfil |

### 5.3 Críticas (`risk: 'critical'`, siempre confirman y exigen PIN)

| Tool | Parámetros | Nota |
|---|---|---|
| `mover_presupuesto` | `{ origenLineaId, destinoLineaId, monto, motivo }` | Debe respetar el flujo de revisión/transferencia existente y escribir `PresupuestoCambio` |
| `ajustar_linea_presupuesto` | `{ lineaId, nuevoMonto, motivo }` | Igual |
| `cerrar_quincena` | `{ quincena }` | Irreversible en la práctica. Exige conciliación previa |
| `registrar_pago_credito` | `{ creditoPagoId, monto, fecha }` | No debe duplicar el gasto (ver `DEVELOPMENT_POLICY.md`, sección Créditos y Deudas) |
| `crear_apartado` | `{ nombre, meta, cuentaId }` | |
| `abonar_apartado` | `{ apartadoId, monto }` | |

### 5.4 Reglas del dispatcher

`src/milo/tools/index.js` es el único módulo que escribe. Para cada tool call:

1. Validar `args` contra el JSON Schema. Argumento inválido: rechazar sin ejecutar y devolver el error al LLM para que reformule.
2. Inyectar `hogarId` en todo `where` de Prisma.
3. Consultar `policy.js`. Si exige confirmación o PIN y no hay sesión de escritura abierta: **no ejecutar**, crear `PendingAction`, retornar.
4. Ejecutar dentro de una transacción Prisma.
5. Escribir `AuditLog` con `tabla`, `registroId`, `operacion`, `campo`, `valorAnterior`, `valorNuevo`, `userId` y `source`.
6. Devolver un `ToolResult` en lenguaje natural corto, no el objeto crudo.

**Nunca exponer `prisma` crudo al LLM. Solo tools tipadas.** El aislamiento por `hogarId` en el dispatcher es la única defensa real contra inyección de prompt.

## 6. Confirmación y PIN

### 6.1 Niveles

`MiloPerfil.nivelConfirmacion`:

| Valor | Comportamiento |
|---|---|
| `SIEMPRE` | Confirma toda escritura, incluido un gasto de 50 pesos |
| `SOLO_CRITICAS` | Registra gastos directo; confirma edición, borrado y todo lo `critical` |
| `NUNCA` | Registra y edita directo; **las `critical` siguen confirmando y pidiendo PIN** — no es configurable hacia abajo |

### 6.2 Máquina de estados de una acción con confirmación

```
turno N    : el LLM emite tool call -> policy exige confirmacion
             dispatcher NO ejecuta
             crea PendingAction (TTL 5 min) con la tool y los args
             Milo responde: "Voy a registrar 450 en Familia. Confirmas?"

turno N+1  : usuario responde
             si -> dispatcher ejecuta la PendingAction y confirma
             no -> se descarta
             otra cosa -> se descarta y se procesa como turno normal
             expirada -> se descarta silenciosamente
```

El mismo flujo sirve para texto y para voz. Es lo que permite que ambos canales compartan exactamente la misma lógica.

### 6.3 PIN hablado

- `MiloPerfil.pinHash`: 4 dígitos, bcrypt. Se configura desde el dashboard, nunca por el bot.
- Al invocar una tool `critical`, Milo pide el PIN. Al validarlo se abre una **sesión de escritura de 10 minutos**, persistida para que sobreviva a un reinicio del proceso.
- **El STT de dígitos falla con ruido.** Aceptar 2 intentos y caer a confirmación por WhatsApp ("responde SI a este mensaje para autorizar"). Sin esta salida, la voz se vuelve inusable en la calle.
- Un PIN fallido se registra en `AuditLog`.

## 7. Memoria persistente

### 7.1 Modelos nuevos en `prisma/schema.prisma`

```prisma
enum ConfirmLevel { SIEMPRE SOLO_CRITICAS NUNCA }
enum MemoriaTipo  { HABITO PREFERENCIA DECISION DUDA_FRECUENTE ENTIDAD }
enum CanalMilo    { WA TG VOZ VIDEO }

model MiloPerfil {
  id                Int          @id @default(autoincrement())
  userId            Int          @unique @map("user_id")
  idioma            String       @default("es") @db.VarChar(5)
  nivelConfirmacion ConfirmLevel @default(SOLO_CRITICAS) @map("nivel_confirmacion")
  pinHash           String?      @map("pin_hash")
  tono              String?      @db.VarChar(30)
  ultimoResumen     String?      @map("ultimo_resumen")
  tokensPresupuesto Int          @default(1200) @map("tokens_presupuesto")
  user              User         @relation(fields: [userId], references: [id])
  @@map("milo_perfiles")
}

model MiloSesion {
  id           Int        @id @default(autoincrement())
  userId       Int        @map("user_id")
  canal        CanalMilo
  inicio       DateTime   @default(now()) @db.Timestamptz()
  fin          DateTime?  @db.Timestamptz()
  resumen      String?
  tokensUsados Int        @default(0) @map("tokens_usados")
  turnos       MiloTurno[]
  @@index([userId, inicio])
  @@map("milo_sesiones")
}

model MiloTurno {
  id        Int        @id @default(autoincrement())
  sesionId  Int        @map("sesion_id")
  rol       String     @db.VarChar(10)
  contenido String
  toolCalls Json?      @map("tool_calls")
  provider  String?    @db.VarChar(20)
  fecha     DateTime   @default(now()) @db.Timestamptz()
  sesion    MiloSesion @relation(fields: [sesionId], references: [id])
  @@index([sesionId])
  @@map("milo_turnos")
}

model MiloMemoria {
  id            Int         @id @default(autoincrement())
  userId        Int         @map("user_id")
  tipo          MemoriaTipo
  clave         String      @db.VarChar(100)
  valor         String
  confianza     Float       @default(0.5)
  usos          Int         @default(0)
  fuenteTurnoId Int?        @map("fuente_turno_id")
  vigenteHasta  DateTime?   @map("vigente_hasta") @db.Timestamptz()
  creado        DateTime    @default(now()) @db.Timestamptz()
  @@unique([userId, tipo, clave])
  @@index([userId, confianza])
  @@map("milo_memorias")
}

model MiloEvento {
  id         Int       @id @default(autoincrement())
  userId     Int       @map("user_id")
  tipo       String    @db.VarChar(40)
  clave      String    @db.VarChar(100)
  severidad  String    @db.VarChar(10)
  payload    Json
  ventana    String    @db.VarChar(20)
  notificado DateTime? @db.Timestamptz()
  creado     DateTime  @default(now()) @db.Timestamptz()
  @@unique([userId, tipo, clave, ventana])
  @@map("milo_eventos")
}

model MiloPendiente {
  id        Int      @id @default(autoincrement())
  userId    Int      @map("user_id")
  sesionId  Int      @map("sesion_id")
  tool      String   @db.VarChar(50)
  args      Json
  expiraEn  DateTime @map("expira_en") @db.Timestamptz()
  @@index([sesionId])
  @@map("milo_pendientes")
}
```

También se agrega a `User`: `telegramId String? @unique`, `phoneVoz String? @unique`, y la relación con `MiloPerfil`.

### 7.2 Inyección de memoria con presupuesto duro

Techo de ~1,200 tokens de memoria por turno. Composición:

| Bloque | Fuente | Tokens aprox |
|---|---|---|
| Perfil (idioma, tono, nivel de confirmación) | `MiloPerfil` | 50 |
| Hechos duraderos | Top-15 de `MiloMemoria` por `confianza * usos` | 400 |
| Resumen de la sesión anterior | `MiloSesion.resumen` más reciente | 200 |
| Turnos crudos | Últimos 6 de la sesión actual | 550 |

Sin embeddings en la primera fase: el orden por `confianza * usos` alcanza con 2 usuarios. Si el volumen crece, `pgvector` sobre `MiloMemoria.valor`.

El **snapshot financiero no cuenta aquí**: viene de `context.js` con su caché de 2 minutos y se inyecta aparte.

### 7.3 Ciclo de vida

- **Extracción**: al cerrar un turno, una llamada barata a DeepSeek propone hechos nuevos (`tipo`, `clave`, `valor`). Se hace upsert por `[userId, tipo, clave]`; un hecho repetido sube `confianza` y `usos`.
- **Resumen**: al cerrar sesión (30 min de inactividad) se genera `MiloSesion.resumen` y se copia a `MiloPerfil.ultimoResumen`.
- **Caducidad**: `vigenteHasta` permite hechos temporales (por ejemplo, una meta de ahorro con fecha). Un job los limpia.
- **Corrección**: si el usuario contradice un hecho, baja `confianza`. Bajo 0.2, deja de inyectarse.

## 8. Canales

### 8.1 Mensajes (WhatsApp y Telegram)

No cambian de transporte. `src/whatsapp.js` y `src/telegram.js` siguen siendo capas tontas de envío y recepción. Lo que cambia es quién los invoca: ahora pasan por `src/channels/*` y de ahí al cerebro.

Ganancia inmediata y gratis: **WhatsApp hereda el router DeepSeek y la capa determinista** que hoy solo tiene Telegram.

### 8.2 Voz telefónica

Comparación evaluada:

| Opción | Latencia | Costo por minuto | Esfuerzo | Encaje con el stack |
|---|---|---|---|---|
| **WhatsApp Calling API (Meta)** | media | entrante $0, saliente ~$0.05 | medio | Mismo número, token e identidad que ya usa Milo |
| Twilio Voice + Media Streams | baja | ~$0.014 + costo del número | alto | Número nuevo; hay que escribir el puente de audio a mano |
| Vapi / Retell | baja | $0.11 a $0.31 todo incluido | bajo | Aceptan SIP trunk; tool calling por webhook HTTP |
| OpenAI Realtime | muy baja | ~$0.10 a $0.15 | alto | Un proveedor más que mantener |
| Notas de voz en WA/TG | asíncrona | ~$0 | mínimo | `src/media.js` ya transcribe |

**Recomendación: WhatsApp Calling API como transporte + Retell (o Vapi) como motor de voz, conectados por SIP.**

Razones:

- El tráfico entrante es gratis para el negocio.
- Es el mismo número e identidad que ya usa Milo, coherente con la decisión de "un solo Milo".
- Meta publica configuración SIP, lo que evita escribir SRTP/ICE en Node.
- Retell hace tool calling contra un webhook HTTP que apunta directo a `src/milo/tools/index.js`.

**Riesgo a validar en Fase 11.0, no en la 11.3**: que WhatsApp Calling esté habilitado para la WABA en México. Si no lo está, el plan B es Twilio Voice + SIP trunk contra el mismo agente. **Cambia el transporte; el cerebro no se entera.** Por eso el adaptador de canal está separado.

Guardarraíl obligatorio: fijar `maxDurationSeconds` en el agente de voz. Una llamada olvidada abierta cuesta minutos reales.

### 8.3 Notas de voz (escalón intermedio, Fase 11.2)

No es un consuelo, es un escalón con valor propio: cubre el grueso de "le hablo a Milo y me contesta hablando" a costo casi cero, y valida la persona antes de pagar minutos de telefonía.

`transcribeAudio()` ya existe. Falta únicamente TTS de salida: ElevenLabs Starter ($5/mes) o `gemini-tts`.

### 8.4 Video-llamada (Fase 11.5, opcional)

| Opción | Costo |
|---|---|
| Tavus CVI | $59/mes mínimo (100 min incluidos, luego $0.37/min) |
| HeyGen interactive | ~$0.20/min, solo API |
| LiveKit + avatar | Variable, más control, más trabajo |

Es el rubro más caro del plan — más que toda la infraestructura junta — y el que menos valor financiero agrega: nadie necesita ver una cara para saber cuánto le queda de presupuesto.

**Recomendación honesta: llegar con voz sólida primero.** Si se hace, LiveKit + Tavus reusando el mismo agente de voz. Decisión aparte, con su propio presupuesto.

## 9. Seguridad y multi-tenancy

### 9.1 Whitelist

- WhatsApp: `User.phoneWhatsapp` (ya existe, `@unique`).
- Telegram: `User.telegramId` (nuevo).
- Voz: `User.phoneVoz` (nuevo).

Un número no registrado recibe una respuesta genérica y **nunca toca datos**. La verificación vive en el adaptador de canal, **antes** de `brain.handleTurn`, no dentro del cerebro.

### 9.2 Aislamiento por hogar

- Modelo `Hogar` + `hogarId Int @default(1)` en `User`, `Transaccion`, `Quincena`, `Presupuesto`, `Cuenta`, `Categoria`, `Credito`, `Deuda`, `Apartado`.
- Migración que crea el hogar id=1 y se lo asigna a todo lo existente. Los 2 usuarios actuales no notan nada.
- El dispatcher inyecta `hogarId` en todo `where`. **Ninguna tool lo recibe del LLM.**

### 9.3 Superficie de riesgo

El dashboard sin auth deja de ser un problema teórico cuando el layer puede escribir. La auth mínima (`dashboard/middleware.ts` + `ADMIN_PASSWORD`) entra en Fase 11.0 por eso, aunque técnicamente no bloquee el código del cerebro.

## 10. Proactividad

### 10.1 Reglas

`src/milo/proactive/rules.js` — funciones puras `(contexto) -> Evento[]`. Sin efectos secundarios, testeables sin base de datos.

| Regla | Umbral | Severidad |
|---|---|---|
| Línea de presupuesto sobregirada | ejecutado > 85% del presupuestado | media |
| Línea rebasada | ejecutado > 100% | alta |
| Crédito por vencer | `fechaVencimiento` en 3 días o menos | alta |
| Quincena por cerrar sin conciliar | fin de quincena en 2 días y hay movimientos sin presupuesto | media |
| Proyección de cierre negativa | proyección de margen < 0 | alta |
| Gasto atípico | monto > 3x la mediana de esa categoría | baja |

### 10.2 Dedupe y envío

Cada regla emite a `MiloEvento` con `@@unique([userId, tipo, clave, ventana])`, donde `ventana` es típicamente la quincena. Esto evita que Milo avise 40 veces de lo mismo: el mismo evento en la misma ventana se ignora.

Severidad `alta` puede escalar a llamada saliente; `media` y `baja` van por mensaje.

### 10.3 Bloqueante de infraestructura

El free tier de Render **duerme a los 15 minutos de inactividad**. Consecuencias:

- El cron no puede vivir dentro del web service.
- Un cold start de ~50 segundos mata una llamada de voz entrante.

Solución: un **Render Cron Job** (~$1/mes, proceso propio) que corre las reglas cada 30 minutos, y subir `gastos-bot` a **Starter ($7/mes)** antes de la Fase 11.3.

### 10.4 Ventana de 24 horas de WhatsApp

Fuera de la ventana de 24 horas desde el último mensaje del usuario, **Meta exige plantillas aprobadas**. El trámite tarda. **Iniciarlo en la Fase 11.2**, no cuando se necesite.

## 11. Variables de entorno nuevas

| Variable | Servicio | Propósito |
|---|---|---|
| `DEEPSEEK_API_KEY` | gastos-bot | Proveedor primario |
| `DEEPSEEK_MODEL` | gastos-bot | Default `deepseek-v4-flash` |
| `GEMINI_API_KEY` | gastos-bot | Fallback y visión/STT. **Hoy falta en prod** |
| `MILO_BRAIN_ENABLED` | gastos-bot | Flag de corte para WhatsApp |
| `TELEGRAM_BOT_TOKEN` | gastos-bot | Ya usado por la rama |
| `ADMIN_PASSWORD` | gastos-dashboard | Auth mínima. Declarada, sin usar |
| `ELEVENLABS_API_KEY` | gastos-bot | TTS (Fase 11.2) |
| `VOICE_AGENT_WEBHOOK_SECRET` | gastos-bot | Firma del webhook del motor de voz (Fase 11.3) |
| `RETELL_API_KEY` | gastos-bot | Motor de voz (Fase 11.3) |

Todas con `sync: false` en `render.yaml`.

## 12. Costos estimados

Supuestos: 2 usuarios, 200 turnos de texto al mes, 60 minutos de voz entrante, 20 de saliente, 20 de video.

| Rubro | Fase 11.1-11.2 | Fase 11.3 | Fase 11.5 |
|---|---|---|---|
| LLM DeepSeek (~0.8M in / 0.1M out) | ~$0.20 | ~$0.50 | ~$0.50 |
| Gemini fallback y visión | ~$1 | ~$1 | ~$1 |
| STT/TTS notas de voz (ElevenLabs Starter) | $5 | $5 | $5 |
| Motor de voz Retell ($0.11-0.15 x 60) | - | $7-9 | $7-9 |
| Telefonía WhatsApp Calling (entrante $0, saliente $0.05 x 20) | - | $1 | $1 |
| Video Tavus Starter (100 min incluidos) | - | - | $59 |
| Render: web $7 + dashboard $7 + Postgres $6 + cron $1 | $21 | $21 | $21 |
| **Total mensual** | **~$27** | **~$36-38** | **~$95** |

Hoy se paga $0. **El salto de $0 a $27 es casi todo infraestructura**, no IA: el free tier de Render ya no alcanza (duerme, y la base free expira). El video triplica el costo y es una decisión aparte.

Precios consultados en septiembre de 2026. Revalidar antes de contratar.

## 13. Fases e issues

### Fase 11.0 - Saneamiento (bloqueante)

Se hace primero porque el layer amplifica cada deuda técnica existente.

| # | Tarea | Criterio de aceptación |
|---|---|---|
| 11.0.1 | Mergear `feature/telegram-budget-bot` a `main` vía PR | `main` contiene `aiRouter.js`, `deepseek.js`, `telegramBrain.js`, `telegram.js`, `telegram-index.js`, `budgetTracker.js` |
| 11.0.2 | Unificar schemas Prisma. Portar a la raíz `enum TipoCambioPresupuesto`, `model PresupuestoCambio` y `Credito.fechaVencimiento`; eliminar `dashboard/prisma/` y apuntar el dashboard a `prisma/schema.prisma` | Una sola carpeta `prisma/`; el dashboard compila y levanta |
| 11.0.3 | Convertir `prisma/migrations/views.sql` en migración real con `CREATE OR REPLACE VIEW` | `npx prisma migrate deploy` corre limpio en prod y las vistas existen |
| 11.0.4 | Auth mínima del dashboard: `dashboard/middleware.ts` + `ADMIN_PASSWORD` | El dashboard pide password; ninguna ruta de datos queda pública |
| 11.0.5 | Agregar `GEMINI_API_KEY` y `DEEPSEEK_API_KEY` a `render.yaml` | La Fase 8 revive en producción |
| 11.0.6 | Modelo `Hogar` + `hogarId` en las 9 tablas del dominio + migración de asignación | Todo registro existente queda en hogar id=1; el dashboard sigue funcionando |
| 11.0.7 | Validar disponibilidad de WhatsApp Calling API para la WABA en México | Respuesta documentada: disponible, o se adopta el plan B (Twilio) |

### Fase 11.1 - Cerebro único, solo lectura

| # | Tarea | Criterio de aceptación |
|---|---|---|
| 11.1.1 | Crear `src/milo/`; mover `getSystemContext` de `gemini.js:50` a `context.js` con firma `(prisma, hogarId)` | Telegram y WhatsApp siguen respondiendo igual |
| 11.1.2 | Mover proveedores a `src/milo/providers/`; agregar `run({messages, tools})` a `aiRouter.js` y soporte de `tools` a `deepseek.js` y `gemini.js` | Un test manual devuelve un `toolCall` bien formado desde ambos proveedores |
| 11.1.3 | Implementar `brain.js` con la secuencia de 7 pasos, usando `classifyQuestionLocally` como primera línea | Una pregunta conocida se responde sin llamar al LLM |
| 11.1.4 | Implementar las 7 tools de lectura + dispatcher con inyección de `hogarId` | Las 7 responden con datos reales de Postgres |
| 11.1.5 | Memoria: modelos Prisma + `memory.js` + inyección con presupuesto de tokens | Tras una semana de uso hay 5 o más hechos en `MiloMemoria` |
| 11.1.6 | `persona.js` con idioma y tono desde `MiloPerfil` | Cambiar `idioma` a `en` cambia el idioma de la respuesta |
| 11.1.7 | Adaptadores `src/channels/whatsapp.js` y `telegram.js` + whitelist; montar el router de Telegram dentro de `src/index.js` | Un número fuera de la whitelist no obtiene ningún dato |
| 11.1.8 | Conectar WhatsApp al cerebro detrás de `MILO_BRAIN_ENABLED` | Con el flag en false, WhatsApp se comporta exactamente como hoy |

**La Fase 11.1 NO incluye**: escritura, voz, llamadas, video, proactividad, PIN, ni multi-hogar real (solo la columna). Es únicamente "un cerebro, dos bocas, y memoria".

### Fase 11.2 - Escritura, confirmación y notas de voz

| # | Tarea | Criterio de aceptación |
|---|---|---|
| 11.2.1 | `policy.js` + `pending.js` + `MiloPendiente` | Una tool que exige confirmación no escribe hasta el turno siguiente |
| 11.2.2 | Tools de escritura (`registrar_transaccion`, `editar`, `eliminar`, `crear_tarea`) con `AuditLog` | Registrar un gasto por chat deja `AuditLog` con `source='milo:wa'` y `userId` correcto |
| 11.2.3 | Tools críticas (presupuesto, quincena, créditos, apartados) respetando el flujo de revisión existente | `mover_presupuesto` sin PIN es rechazada y no escribe nada |
| 11.2.4 | PIN hablado: `pinHash`, sesión de escritura de 10 min, fallback a confirmación por WhatsApp | 3 PIN incorrectos bloquean y quedan registrados |
| 11.2.5 | TTS de salida; notas de voz de entrada reusando `transcribeAudio` | Mandar un audio con un gasto lo registra y Milo contesta hablando |
| 11.2.6 | Iniciar el trámite de plantillas de WhatsApp con Meta | Plantilla enviada a revisión |

### Fase 11.3 - Llamada de voz en vivo

| # | Tarea | Criterio de aceptación |
|---|---|---|
| 11.3.1 | Subir `gastos-bot` y `gastos-dashboard` a Starter; Postgres a Basic | Sin cold starts; la base deja de tener fecha de expiración |
| 11.3.2 | Configurar el agente de voz (Retell/Vapi) con SIP hacia WhatsApp Calling o Twilio | Una llamada de prueba conecta y Milo saluda |
| 11.3.3 | `src/channels/voice.js`: webhook firmado que despacha tool calls al mismo dispatcher | Las tools ejecutadas por voz dejan `AuditLog` con `source='milo:voz'` |
| 11.3.4 | Guardarraíles: `maxDurationSeconds`, límite de gasto, log de duración por llamada | Una llamada se corta sola al llegar al límite |

**Criterio de aceptación de la fase**: una llamada de 3 minutos donde Milo consulta el presupuesto y registra un gasto con confirmación hablada.

### Fase 11.4 - Proactividad

| # | Tarea | Criterio de aceptación |
|---|---|---|
| 11.4.1 | `proactive/rules.js` con las 6 reglas, puras y testeables | Tests unitarios sin base de datos |
| 11.4.2 | `MiloEvento` + dispatcher con dedupe por ventana | Simular una línea al 90% y recibir el aviso **una sola vez** |
| 11.4.3 | Render Cron Job cada 30 min | El cron corre con el web service dormido |
| 11.4.4 | Salida por plantilla de WhatsApp; llamada saliente solo en severidad alta | Un evento de severidad media nunca llama |

### Fase 11.5 - Video (opcional)

Solo si la Fase 11.3 se usa de verdad. Se re-evalúa con datos de uso reales, no antes.

## 14. Riesgos

| # | Riesgo | Mitigación |
|---|---|---|
| 1 | WhatsApp Calling no disponible para la WABA en México | Se valida en Fase 11.0. Plan B: Twilio + SIP al mismo agente; solo cambia el transporte |
| 2 | DeepSeek alucina argumentos de tools en español con prompt largo | JSON Schema estricto, validación en el dispatcher, y `classifyQuestionLocally` como primera línea |
| 3 | Romper WhatsApp en producción: es el único canal vivo | Flag `MILO_BRAIN_ENABLED` y camino viejo intacto |
| 4 | Saturar el pool de conexiones de Postgres al unificar servicios | Singleton `src/lib/prisma.js`, revisar `connection_limit` |
| 5 | La ventana de 24h bloquea la proactividad | Tramitar plantillas desde Fase 11.2 |
| 6 | Deriva de costos de voz por llamadas abiertas | `maxDurationSeconds` obligatorio |
| 7 | El LLM ejecuta una acción crítica no deseada | Ninguna tool recibe `hogarId`; confirmación y PIN no son opcionales en `critical` |
| 8 | Divergencia de schemas vuelve a aparecer | Un solo `prisma/` tras Fase 11.0; agregarlo a las reglas de código |

## 15. Verificación end-to-end

1. `npx prisma migrate deploy` corre limpio contra producción tras la Fase 11.0.
2. `node scripts/test-bot-flow.js` sigue pasando.
3. Con `MILO_BRAIN_ENABLED=false`, WhatsApp se comporta exactamente como hoy (rollback probado).
4. Con el flag activo, la misma pregunta en WhatsApp y en Telegram devuelve la misma respuesta y el mismo `provider`.
5. Una escritura por voz o audio deja `AuditLog` con `source` y `userId` correctos.
6. Una tool `critical` sin PIN es rechazada y no escribe nada en la base.
7. Un número fuera de la whitelist no obtiene ningún dato del sistema.
8. Un evento proactivo repetido en la misma quincena se envía una sola vez.

## 16. Mapa de archivos

| Archivo | Acción |
|---|---|
| `src/index.js` | Modificar: handler `/webhook` llama a `brain.handleTurn()` tras flag; monta el router de Telegram |
| `src/gemini.js` | `getSystemContext` (línea 50) se extrae a `src/milo/context.js` |
| `src/aiRouter.js` | Mover a `src/milo/providers/`; agregar `run()` con tools |
| `src/deepseek.js` | Mover; extender `complete()` con `tools` |
| `src/telegramBrain.js` | Mover; se absorbe como capa determinista |
| `src/telegram-index.js` | Su router se monta en `src/index.js`; deja de ser proceso aparte |
| `src/media.js` | Reusar `transcribeAudio` y `analyzeImage` |
| `src/lib/prisma.js` | Reusar el singleton |
| `src/todoist.js` | Envolver como tool `crear_tarea` |
| `src/milo/**` | Crear (ver sección 4.2) |
| `src/channels/**` | Crear |
| `prisma/schema.prisma` | `Hogar`, `MiloPerfil`, `MiloSesion`, `MiloTurno`, `MiloMemoria`, `MiloEvento`, `MiloPendiente`; campos nuevos en `User` |
| `dashboard/prisma/` | Eliminar |
| `dashboard/middleware.ts` | Crear (auth mínima) |
| `render.yaml` | Planes Starter, cron job, variables nuevas |
| `AGENTS.md`, `DEVELOPMENT_POLICY.md` | Documentar Fase 11 |
