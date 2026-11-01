# Clasificador de categorías que aprende — Fase A

Parte de la Fase 8 (Inteligencia y Automatización): *"Este gasto parece Super, ¿lo confirmo?"*.

## Qué hace

Cuando llega un gasto por Telegram, el bot propone una categoría y pregunta si es correcta. Cada respuesta se convierte en un ejemplo etiquetado y el modelo aprende de él en ese momento (aprendizaje supervisado).

```
Tú:   95 convivio
Milo: ✅ Gasto registrado … 🏷️ Familia …
      🤖 ¿Es correcta la categoría Familia? (87 % seguro)
      [✅ Sí] [✏️ No, cambiarla]
      ¿A cuál línea lo mando?
      [⭐ Convivios · Familia] …
```

| Respuesta | Qué pasa | Feedback |
|---|---|---|
| ✅ Sí | Muestra las líneas de presupuesto | `aceptada` |
| ✏️ No → elige otra categoría | Cambia la categoría del gasto y muestra las líneas | `corregida` (pesa ×2) |
| Elige directamente una línea de la **misma** categoría | La enlaza (como hoy) | `aceptada`: vio la categoría y no la objetó |
| Elige una línea de **otra** categoría → «Sí, moverlo» | Como hoy (`pk`) | `corregida` |
| … → «No, dejarlo en X» | Como hoy (`pm`) | `aceptada` |
| No contesta | El gasto **se queda guardado** con la categoría propuesta | `pendiente` (no entra al entrenamiento) |
| «Dejar sin asignar» la línea | Como hoy (`pn`) | sigue `pendiente`: no dice nada de la categoría |

El gasto se guarda **antes** de la respuesta (decisión del 1/11/2026): si no contestas, el gasto no se pierde.

Solo pregunta en los gastos (tipo `Gasto`). Ingresos y ahorros tienen una sola categoría y se quedan como estaban.

## Cómo decide la categoría

1. Las reglas de siempre: palabras clave de `src/parser.js` y, en los mensajes ambiguos, la IA (DeepSeek/Gemini).
2. Si las reglas dicen que es un gasto, el modelo opina. **Solo reemplaza a las reglas si está seguro**: probabilidad ≥ 60 % **y** cobertura ≥ 50 % (la cobertura es qué parte del texto ya había visto alguna vez). Si no, se queda lo de las reglas.
3. En los dos casos se pregunta, y la respuesta enseña al modelo.

### El modelo

Naive Bayes multinomial sobre **palabras + fragmentos de 3 y 4 letras** (`src/clasificador/modelo.js`, JavaScript puro, sin dependencias).

- **Por qué no una red neuronal:** hay unos cientos de descripciones de 2 o 3 palabras. Una red se las aprendería de memoria sin generalizar. Naive Bayes aprende bien con pocos datos, se actualiza con un solo ejemplo sin reentrenar todo y cabe en el plan gratis de Render.
- **Los fragmentos** son los que toleran errores de dedo y variantes: «niñera»/«ninera», «guarderya»/«guardería».
- **Normalización:** sin acentos, sin mayúsculas, sin montos ni símbolos, sin palabras vacías («de», «la», «pagué», «hoy»…).
- **Confianza calibrada:** sin ajuste, Naive Bayes sale «100 % seguro» de casi todo, porque los fragmentos de una misma palabra cuentan como evidencia repetida. La evidencia se escala para que valga como máximo 6 rasgos independientes. Los rasgos nunca vistos se ignoran.

### Con qué se entrena

Con la tabla `transacciones` (tipo Gasto, categorías activas), al primer gasto después de arrancar y de nuevo cada 6 horas. Así también aprende lo que corrijas desde el dashboard.

- **Se excluyen** los gastos cuya propuesta sigue `pendiente` y conserva la categoría propuesta. Sin esta regla, el modelo se entrenaría con sus propias adivinanzas sin confirmar y un error se reforzaría solo.
- Si una pendiente se cambió desde el dashboard, sí cuenta: es una decisión humana.
- Las `corregida` pesan ×2. Con ×3, una sola corrección de «uber eats» arrastraba también a «uber» solo.
- Mientras haya menos de 20 ejemplos, el modelo no opina.

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

- `scripts/test-clasificador.js` (45): modelo y servicio. Normalización, tolerancia a errores de dedo, «no sé» con texto desconocido, que una corrección cambie la opinión, exclusión de las pendientes, pesos, idempotencia, que nunca truene y el apagado.
- `scripts/test-telegram-flow.js`, casos CL1–CL10: la pregunta, Sí, No, Volver, Corregir, `kc` forjado hacia otro tipo, línea de la misma categoría = sí, cruce = corrección, que un ingreso no pregunte, que el modelo entrenado le gane a las reglas y que una falla de la tabla no impida el registro.

## Siguientes fases (no incluidas)

- **B:** que también aprenda la **línea de presupuesto**, en lugar de la ⭐ actual que se elige por parecido de texto.
- **C (opcional):** *embeddings* para sinónimos que nunca ha visto («uber eats» ≈ comida).
