# Clasificador que aprende — categoría (Fase A) y línea de presupuesto (Fase B)

Parte de la Fase 8 (Inteligencia y Automatización): *"Este gasto parece Super, ¿lo confirmo?"*.

## Qué hace

**En el bot lo que importa es la línea de presupuesto** (decisión del usuario del 2/11/2026); la categoría es para el dashboard. Por eso:

- Cuando llega un gasto por Telegram y hay sugerida, **el bot lo manda directo a esa línea** y ofrece cambiarla (decisión del usuario del 2/11/2026: «que lo mande, y si quiero cambiar, ese sea el botón»). Sin sugerida, muestra las líneas para elegir. No hay preguntas ni botones de categoría.
- **La categoría sigue a la línea, sin preguntar** (`assignLine` en `src/budgetActions.js`): al elegir una línea de otra categoría, el gasto pasa a la categoría de la línea y el mensaje lo avisa («Categoría: Familia → Super»). Antes el bot preguntaba «¿Muevo también la categoría?». Sigue habiendo un toque humano detrás: el usuario eligió la línea. Lo mismo pasa al crear una línea nueva desde Telegram.

```
Tú:   100, croquetas
Milo: Gasto registrado ... Super ...
      Lo mandé a Super (99 % seguro)
      [Cambiar línea] [Quitar línea]
Tú:   (toca Cambiar línea y elige Diversion)
Milo: Asignado a Diversion
      Categoría: Super -> Diversión
```

**Asignación directa:** con sugerida, el gasto queda enlazado al registrarse (`assignLine`, la misma escritura de los botones, con sus validaciones) y la categoría sigue a la línea. El mensaje dice a dónde fue y qué tan seguro estaba, y trae **Cambiar línea** (`pp:<tx>:0`: la lista completa, que dice «Está en *X*. ¿A cuál la cambio?») y **Quitar línea** (`pn:<tx>`). Si la línea queda excedida, el aviso llega en el mismo mensaje. Medido con los datos reales, la sugerida acierta ~75 % de las veces que aparece: más o menos 1 de cada 4 hay que cambiarla.

La asignación automática **no se le enseña al modelo en el momento** (es su propia adivinanza). Si el usuario la cambia, ese toque sí se aprende; si la deja, el gasto entra al reentreno como cualquier gasto con línea (el usuario la vio y no la cambió).

La categoría propuesta al registrar se guarda en `clasificacion_feedback` como `pendiente`, y el toque de línea la resuelve: `aceptada` si la línea es de la misma categoría, `corregida` si no. Así el modelo de categoría (que propone la categoría de los gastos nuevos, útil para el dashboard) también aprende de cada toque. Si nadie toca una línea (tampoco cuando el bot la asignó solo), sigue `pendiente` y no entra al entrenamiento de categoría.

El gasto se guarda **antes** de cualquier toque (decisión del 1/11/2026): si no se toca nada, el gasto no se pierde.

Historia: la Fase A preguntaba «¿Es correcta la categoría?» con botones Sí/No; el 1/11 se quitó y quedó un solo botón de categoría, y el 2/11 también se quitó, junto con la pregunta de cruce. Los botones viejos (`ka`, `kn`, `kc`, `kb`, `pk`, `pm`) se siguen atendiendo para los mensajes que todavía los tienen.

## Sesión de entrenamiento

«vamos a entrenar» abre un menú con dos estilos (botones `em:g` y `em:p`):

```
¿Cómo entrenamos?
[Tú me muestras gastos]     <- el bot muestra gastos sin línea
[Yo te escribo palabras]    <- el usuario escribe palabras sueltas; más retador
```

### Estilo «Tú me muestras gastos» (línea)

El usuario escribe **«vamos a entrenar»** (también «entrenar», «/entrenar», «entrenemos»; el mensaje tiene que ser solo la frase, así que «entrenamiento de futbol 300» se registra como gasto). El bot muestra, **uno por uno y del más reciente al más viejo, los gastos que todavía no tienen línea**, con la línea que cree, en **un solo mensaje que se va editando**:

```
Entrenamiento
«ropa» -> Gastos Personales     <- lo que acaba de aprender
$100.00 — croquetas
1/11/2026
¿Super? (72 %)
[Sí] [Otra línea]
[Saltar] [Terminar]
```

- **Sí** asigna la línea sugerida; **Otra línea** abre el menú paginado de las líneas de la quincena. En los dos casos la categoría sigue a la línea, el gasto pasa al siguiente y **los dos modelos aprenden en ese momento** (la línea, y la categoría de la línea como respuesta del modelo de categoría).
- Si el bot no tiene sugerencia, el único botón es «Elegir línea».
- **Saltar** no escribe nada; **Terminar** cierra.
- La sugerida es la misma del flujo normal (`src/sugerenciaLinea.js`: regla primero, luego el modelo), así que lo que se enseña es lo mismo que el bot propone.
- Salen solo gastos de tipo Gasto **sin línea**, con al menos una línea posible en su quincena y con letras en la descripción. Un gasto con línea ya la eligió una persona.
- **Sin estado:** cada botón lleva el id del gasto, y «el siguiente» es el gasto anterior que cumple lo de arriba. La sesión sobrevive a que Render duerma o reinicie el servicio.

| `callback_data` | Qué hace |
|---|---|
| `ea:<tx>:<linea>` | sí, esa línea |
| `el:<tx>:<pagina>` | menú de líneas |
| `en:<tx>:<linea>` | línea elegida |
| `eb:<tx>` | volver |
| `es:<tx>` | saltar |
| `ef:0` | terminar |
| `eo`, `ec` | botones de categoría de la versión anterior: redibujan el gasto |

Todo pasa por `assignLine` (`linkTransactionToBudget` + `alignTransactionCategory`), que revalida contra la base: mismo tipo, misma quincena y línea no cancelada.

### Estilo «Yo te escribo palabras»

El usuario escribe palabras o frases sueltas y el bot adivina la línea. **No se registra ningún gasto**: cada palabra se guarda en la tabla `clasificador_ejemplos` y, al confirmarla, entra a los dos modelos (la línea, y la categoría de esa línea). Al terminar, el bot dice cuántas acertó: ese es el reto.

```
Tú:   croquetas
Milo: «croquetas» -> ¿Super? (72 %)
      [Sí] [Otra línea]
      [Terminar]
Tú:   (Sí)
Milo: ¡Acerté! «croquetas» -> Super. Escríbeme otra.
Tú:   listo
Milo: Entrenamiento de palabras terminado. Acerté 7 de 10.
```

- La línea se adivina **solo con el modelo**, entre las líneas de gasto de la quincena actual: no hay un gasto con categoría, así que la regla de texto no opina. Por eso es el estilo más retador.
- **Siempre manda una aproximación** (pedido del usuario: «que siempre me mande la aproximación y yo confirmo»). Si el modelo no pasa su umbral, propone su mejor apuesta sin umbral (`clasificador.mejorLinea`) y lo marca: «¿Diversion? (mi mejor intento, 12 %)». Si el modelo no tiene ni un ejemplo, propone la línea que más se parece por texto. Nunca responde «no sé».
- Si el bot falla y el usuario lo corrige, el ejemplo pesa ×2, como cualquier corrección. Con eso una sola corrección le cambia la opinión (caso W4 de las pruebas).
- **Es el único modo con estado** (en memoria, **por persona dentro de cada chat**: chat + usuario de Telegram). En un grupo, si uno entrena, los mensajes de los demás siguen el flujo normal: un «hola» de otro miembro no se vuelve palabra, y su «listo» no termina la sesión ajena. El botón Terminar sí cierra la sesión del chat aunque lo toque otro miembro. Mientras está activo, un mensaje **sin números ni «?»** se toma como palabra. Un mensaje con monto («150 super») **se registra como gasto normal** y una pregunta se contesta normal: olvidar que se está entrenando no hace perder un gasto.
- Termina con «listo» (también «terminar», «salir», «ya»), con el botón Terminar o tras **15 minutos sin escribir**. Si el servicio reinicia, el modo se pierde (hay que volver a entrar), pero **lo aprendido no**: está en `clasificador_ejemplos` y se carga en cada reentreno.
- Contestar dos veces el mismo mensaje no enseña dos veces.
- En los menús de «Otra línea» de los dos estilos de entrenamiento, la sugerida va primero y el resto **de la más probable a la menos** según el modelo (`clasificador.ordenarLineas`), así que las que importan salen en la primera página. En producción se vio que, con el orden por parecido de texto, había que paginar 4 o 5 veces por palabra.

| `callback_data` | Qué hace |
|---|---|
| `wa:<ejemplo>:<linea>` | sí, la sugerida (acertó) |
| `wl:<ejemplo>:<pagina>:<sugerida>` | menú de líneas |
| `wn:<ejemplo>:<linea>:<sugerida>` | línea elegida (acertó si es la sugerida) |
| `wb:<ejemplo>` | volver |
| `wf:0` | terminar |

La línea se revalida contra la base: que exista, que no esté cancelada y que sea de gasto.

### Tabla `clasificador_ejemplos`

Migración `20261102120000_clasificador_ejemplos` (raíz y dashboard, idénticas). Es **aditiva**: tabla nueva, `IF NOT EXISTS`. Guarda `texto`, `linea_descripcion` (el **nombre** de la línea, que se repite cada quincena), `categoria_id` (la de la línea), `estado` (`pendiente` o `confirmado`) y `acerto` (si la sugerida del bot fue la correcta). Solo las `confirmado` entran al entrenamiento. Si la tabla fallara, el clasificador entrena igual con lo demás.

### En grupos de Telegram

No hace falta configurar nada extra para que el aprendizaje funcione en un grupo. Basta con lo mismo que ya necesita el bot para registrar gastos ahí:

- el id del grupo en `TELEGRAM_ALLOWED_CHAT_IDS`;
- el modo privacidad del bot apagado en @BotFather (`/setprivacy` → Disable), para que lleguen los mensajes sueltos y no solo los comandos. Si está prendido, el arranque deja `TELEGRAM_PRIVACY_MODE_ON` en el log.

Verificado el 2/11/2026: un gasto del grupo «Control de gastos» llegó y se registró, y no hubo avisos de privacidad, de chat no autorizado ni de migración a supergrupo.

El modelo es **uno solo para todos los chats**: lo que se enseña en el grupo o en un chat privado alimenta las mismas sugerencias. Los botones (de línea y de entrenamiento) los puede tocar cualquier miembro del grupo. Solo el modo palabras es por persona (ver arriba).

## Cómo decide la categoría

1. Las reglas de siempre: palabras clave de `src/parser.js` y, en los mensajes ambiguos, la IA (DeepSeek/Gemini).
2. Si las reglas dicen que es un gasto, el modelo opina. **Solo reemplaza a las reglas si está muy seguro**: probabilidad ≥ 80 % **y** cobertura ≥ 50 % (la cobertura es qué parte del texto ya había visto alguna vez). Si no, se queda lo de las reglas.
3. En los dos casos se registra la propuesta, y la línea que se elija la confirma o la corrige.

### El modelo

Naive Bayes multinomial sobre **palabras + fragmentos de 3 y 4 letras** (`src/clasificador/modelo.js`, JavaScript puro, sin dependencias).

- **Por qué no una red neuronal:** hay unos cientos de descripciones de 2 o 3 palabras. Una red se las aprendería de memoria sin generalizar. Naive Bayes aprende bien con pocos datos, se actualiza con un solo ejemplo sin reentrenar todo y cabe en el plan gratis de Render.
- **Los fragmentos** son los que toleran errores de dedo y variantes: «niñera»/«ninera», «guarderya»/«guardería».
- **Normalización:** sin acentos, sin mayúsculas, sin montos ni símbolos, sin palabras vacías («de», «la», «pagué», «hoy»…).
- **Confianza calibrada:** sin ajuste, Naive Bayes sale «100 % seguro» de casi todo, porque los fragmentos de una misma palabra cuentan como evidencia repetida. La evidencia se escala para que valga como máximo 6 rasgos independientes. Los rasgos nunca vistos se ignoran.

### Con qué se entrena la categoría

**Solo con las respuestas** en Telegram (feedback `aceptada` o `corregida`, ver la tabla de arriba), no con el historial. Se carga al primer gasto después de arrancar, se recarga cada 6 horas y cada respuesta se aprende en ese momento.

- Las `corregida` pesan ×2. Con ×3, una sola corrección de «uber eats» arrastraba también a «uber» solo.
- Las `pendiente` (nadie contestó) no cuentan.
- Mientras haya menos de 20 respuestas, el modelo no opina y deciden las reglas de siempre.

**Por qué no el historial (decisión de la Fase B, medida con datos reales):** en la Fase A se entrenaba con la categoría de todas las transacciones. Medido con los 545 movimientos de producción, ese modelo acertaba **menos** que las palabras clave (60–65 % contra 68 %). Las categorías históricas casi nunca las confirmó nadie, porque las puso el mismo parser, y son inconsistentes: «tacos» aparece como Familia, Personal y Diversión. El modelo aprendía ruido.

## Fase B: la línea de presupuesto (la sugerida)

Las líneas se repiten cada quincena con el mismo nombre («Super», «Gasolina Spark») pero con otro id, así que **el modelo aprende el nombre de la línea**. Se entrena con todos los gastos que ya tienen línea: 430 en producción, y cada una la eligió una persona con un toque, así que son etiquetas confiables.

La se decide así:

1. **Primero la regla de siempre** (`resolveBudgetLine`: parecido de texto dentro de la categoría). Cuando opina acierta 94 %, pero solo opina en 1 de cada 3 gastos.
2. **Si no opina, el modelo**, elegido **solo entre las líneas de la quincena** y del tipo del movimiento, con probabilidad ≥ 40 % y cobertura ≥ 50 %. El mensaje dice qué tan seguro está: «¿Lo mando a *Super*? (72 % seguro)», con tope de 99 %: un modelo estadístico nunca está «100 % seguro».
3. Cada toque de línea (`pl`) y cada línea creada desde Telegram (`pd`) se aprende al momento.

Medido con los datos reales (60 % más viejo para entrenar, 178 gastos más nuevos para probar, aprendiendo en línea como el bot):

| | correcta | Pone en | Cuando la pone, acierta |
|---|---|---|---|
| Solo la regla (antes) | **34 %** | 36 % | 94 % |
| Solo el modelo | 60 % | 78 % | 70 % |
| **Regla + modelo (el bot)** | **62 %** | 83 % | 75 % |

Por ejemplo, «croquetas» históricamente va a la línea **Super** (de la categoría *Super*), algo que la regla de texto nunca habría adivinado.

## Tabla nueva: `clasificacion_feedback`

Migración `20261101120000_clasificacion_feedback`, idéntica en `prisma/` y `dashboard/prisma/`. Es **aditiva**: no toca ninguna tabla existente, todo es `IF NOT EXISTS` y borrar un gasto borra su feedback (cascade).

| Columna | |
|---|---|
| `transaccion_id` | único; FK a `transacciones` |
| `texto` | la descripción que se clasificó |
| `categoria_propuesta_id` / `categoria_final_id` | lo que propuso el bot / lo que quedó |
| `fuente` | `modelo` o `reglas` |
| `confianza` | solo si la fuente es el modelo |
| `estado` | `pendiente` · `aceptada` · `corregida` |

## Cómo saber si funciona

```bash
DATABASE_URL=... npm run evaluar:clasificador
```

Es de **solo lectura**. Entrena con el 80 % más viejo de los gastos, evalúa con el 20 % más nuevo y compara:

- **reglas:** lo de hoy, solo palabras clave;
- **modelo:** siempre la categoría más probable;
- **combinado:** lo que hace el bot.

También desglosa por categoría, lista los errores más comunes y, cuando ya haya respuestas en Telegram, muestra el porcentaje de aceptación por fuente. Los umbrales (`MIN_PROBABILIDAD`, `MIN_COBERTURA` en `src/clasificador/index.js`) se ajustan con esto.

En los logs de Render: `CLASIFICADOR_ENTRENADO`, `CLASIFICADOR_DIFIERE` (el modelo le ganó a las reglas) y `CLASIFICADOR_FEEDBACK`.

## Seguridad y apagado

- Nada del clasificador puede impedir que se registre un gasto. Cada función atrapa sus errores y devuelve `null`; si la tabla no existe o la base falla, el bot se comporta como antes (caso CL10 de las pruebas).
- `CLASIFICADOR_ML_ENABLED=false` en Render lo apaga sin desplegar código.
- `callback_data` (`ka`, `kn`, `kc`, `kb`) no es confiable: `correctTransactionCategory` revalida todo contra la base. Solo deja cambiar a una categoría activa del **mismo tipo**, y no toca gastos que ya tienen línea (esos se corrigen en el dashboard o con el flujo de cruce).

## Pruebas

- `scripts/test-clasificador.js` (71): modelo y servicio. Normalización, tolerancia a errores de dedo, «no sé» con texto desconocido, que una corrección cambie la opinión, exclusión de las pendientes, pesos, idempotencia, que nunca truene y el apagado.
- `scripts/test-telegram-flow.js`, casos E1–E9: la sesión de entrenamiento de línea (orden, sugerida, Sí, Otra línea con categoría que sigue, `en` forjado hacia otro tipo, Saltar sin escrituras, Terminar, botones viejos, nada por revisar), y AC: elegir una línea de otra categoría mueve la categoría sin preguntar.
- `scripts/test-clasificador.js`, casos C1–C2: `confirmar` y qué frases abren la sesión. P1: las palabras confirmadas entran a los dos modelos, las pendientes no, y sin la tabla entrena igual.
- `scripts/test-telegram-flow.js`, casos W1–W8 (estilo palabras): no registra gastos, acierto, palabra desconocida que igual recibe aproximación, corrección que se aprende a la primera, `wn` forjado hacia una línea de ingreso, monto que sí se registra como gasto, «listo» con marcador, apagado por inactividad y (W9) sesión por persona en un grupo.
- `scripts/test-telegram-flow.js`, casos CL11–CL12 (Fase B): la la pone el modelo cuando la regla no opina, la paginación la conserva y dos toques le enseñan una línea nueva.
- `scripts/test-telegram-flow.js`, casos CL1–CL10: la pregunta, Sí, No, Volver, Corregir, `kc` forjado hacia otro tipo, línea de la misma categoría = sí, cruce = corrección, que un ingreso no pregunte, que el modelo entrenado le gane a las reglas y que una falla de la tabla no impida el registro.

## Siguientes fases

- **C (opcional):** *embeddings* para sinónimos que nunca ha visto («uber eats» ≈ comida).
