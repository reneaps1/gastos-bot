# Clasificador que aprende — categoría (Fase A) y línea de presupuesto (Fase B)

Parte de la Fase 8 (Inteligencia y Automatización): *"Este gasto parece Super, ¿lo confirmo?"*.

## Qué hace

Cuando llega un gasto por Telegram, el bot propone la categoría y la línea de presupuesto. **No pregunta nada aparte**: aprende de lo que el usuario ya hace al elegir la línea (aprendizaje supervisado).

```
Tú:   100, croquetas
Milo: Gasto registrado ... Familia ...
      ¿Lo mando a Super? (99 % seguro) Toca la que corresponda:
      [* Super · Super — $3600.00]   <- primera y marcada
      [Ballet Dalia · Familia — $550.00] ...
```

La pregunta «¿Es correcta la categoría?» con botones Sí/No existió en la Fase A y **se quitó el 1/11/2026** a pedido del usuario: si la categoría ya está, preguntar sobra. El feedback se sigue registrando y se resuelve así:

| Lo que hace el usuario | Feedback de la categoría |
|---|---|
| Elige una línea de la **misma** categoría | `aceptada`: vio la categoría y no la objetó |
| Elige una línea de **otra** categoría y el bot pregunta «¿Muevo también la categoría?» → «Sí, moverlo» (`pk`) | `corregida` (pesa ×2) |
| … → «No, dejarlo en X» (`pm`) | `aceptada` |
| No elige línea, o «Dejar sin asignar» (`pn`) | sigue `pendiente`: no entra al entrenamiento |

El gasto se guarda **antes** de cualquier toque (decisión del 1/11/2026): si no se toca nada, el gasto no se pierde.

Para corregir sin tanto botón, el mensaje trae **un solo** botón «Categoría» (`kn`), en la misma fila que «Dejar sin asignar»: abre el menú de categorías (`kc`), corrige (feedback `corregida`) y vuelve a las líneas. Solo aparece en gastos sin línea; con línea, la categoría se corrige con el cruce o en la sesión de entrenamiento. El botón `ka` («Sí» de la pregunta vieja) se sigue atendiendo para los mensajes que todavía lo tienen.

## Sesión de entrenamiento (categoría y línea)

El usuario escribe **«vamos a entrenar»** (también «entrenar», «/entrenar», «entrenemos»; el mensaje tiene que ser solo la frase, así que «entrenamiento de futbol 300» se registra como gasto). El bot muestra los gastos **uno por uno, del más reciente al más viejo**, con la **categoría y la línea de presupuesto** que cree, en **un solo mensaje que se va editando**:

```
Entrenamiento
«tenis» -> Personal · Gastos Personales     <- lo que acaba de aprender
$100.00 — croquetas
1/11/2026
Categoría: ¿Familia? (87 %)
Ahora está en Personal.
Línea: ¿Super? (72 %)          (o «Super» con palomita si ya tenía línea)
[Sí]
[Categoría] [Línea]
[Saltar] [Terminar]
```

Cada gasto tiene dos partes, y cada una puede estar resuelta o no:

- **Categoría:** resuelta si el gasto ya tiene respuesta en `clasificacion_feedback`. Si no, el bot propone la opinión del modelo (aunque no sea muy firme: en la sesión siempre se revisa) o, si no tiene, la categoría con la que se guardó.
- **Línea:** resuelta si el gasto ya tiene línea (el bot nunca enlaza solo, así que la eligió una persona). Si no, propone la misma sugerida del flujo normal (`src/sugerenciaLinea.js`: regla primero, luego el modelo), **calculada con la categoría propuesta**.

Botones:

- **Sí:** confirma lo que falte (categoría y línea sugerida) y pasa al siguiente. Si no hay nada que confirmar, dice «Siguiente».
- **Categoría / Línea:** corrigen solo esa parte (la línea con un menú paginado de las líneas de la quincena) y **regresan al mismo gasto** con esa parte resuelta. Cuando ya no falta nada, avanza solo.
- **Saltar** no escribe nada. **Terminar** dice cuántos gastos lleva confirmados y en qué porcentaje acertó la categoría.

Cada respuesta corrige el gasto si hace falta y **los dos modelos aprenden en ese momento**. Aquí sí se puede cambiar la categoría de un gasto con línea, y cambiar una línea por otra: son decisiones explícitas y dejan estados válidos.

Se saltan los gastos cuya categoría ya tiene respuesta y los que no tienen letras («$200»).

**Sin estado:** cada botón lleva el id del gasto, y «el siguiente» es el gasto anterior sin respuesta. La sesión sobrevive a que Render duerma o reinicie el servicio.

`callback_data` (`f` = `m` modelo o `r` reglas):

| Prefijo | Qué hace |
|---|---|
| `ea:<tx>:<cat\|0>:<f>:<linea\|0>` | sí (0 = esa parte ya estaba resuelta) |
| `eo:<tx>:<cat>:<f>` | menú de categorías |
| `ec:<tx>:<cat>:<propuesta>:<f>` | categoría elegida |
| `el:<tx>:<pagina>` | menú de líneas |
| `en:<tx>:<linea>` | línea elegida |
| `eb:<tx>` | volver |
| `es:<tx>` | saltar |
| `ef:0` | terminar |

La categoría pasa por `correctTransactionCategory` y la línea por `linkTransactionToBudget`, que revalidan todo contra la base: mismo tipo, misma quincena y línea no cancelada.

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

## Fase B: la línea de presupuesto (la )

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
- `scripts/test-telegram-flow.js`, casos E1–E10: la sesión de entrenamiento (orden, Sí, corregir categoría con línea, `ec` y `en` forjados hacia otro tipo, Saltar sin escrituras, Terminar con marcador, Sí que también enlaza la línea, corregir la línea y volver al mismo gasto, nada por revisar).
- `scripts/test-clasificador.js`, casos C1–C2: `confirmar`, `opinar`, `marcador` y qué frases abren la sesión.
- `scripts/test-telegram-flow.js`, casos CL11–CL12 (Fase B): la la pone el modelo cuando la regla no opina, la paginación la conserva y dos toques le enseñan una línea nueva.
- `scripts/test-telegram-flow.js`, casos CL1–CL10: la pregunta, Sí, No, Volver, Corregir, `kc` forjado hacia otro tipo, línea de la misma categoría = sí, cruce = corrección, que un ingreso no pregunte, que el modelo entrenado le gane a las reglas y que una falla de la tabla no impida el registro.

## Siguientes fases

- **C (opcional):** *embeddings* para sinónimos que nunca ha visto («uber eats» ≈ comida).
