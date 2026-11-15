// Acciones de PRESUPUESTO que Milo propone y el usuario confirma con un boton
// (Fase B, 2026-11-15): crear una linea (sola o recurrente), ajustar su monto
// u otros datos, retirarla (cancelar), traspasar entre lineas y moverla a otra
// quincena.
//
// Mismo contrato que src/miloAcciones.js:
//   preparar(args, ctx) lee la base y arma el resumen; NUNCA escribe.
//   ejecutar(payload, ctx) corre despues del toque, por la API del dashboard
//     (/api/presupuestos...), que es la unica implementacion de cada regla:
//     el Original nunca cambia, el monto vigente va a montoRevisado, cada
//     cambio queda en presupuesto_cambios con el actor "milo:<persona>".
//   yaAplicada(payload, fila) en un reintento revisa si el intento anterior
//     ya se guardo, para no duplicar.
//
// Se arma con las utilidades de miloAcciones (h) para no duplicarlas.

function crearTiposPresupuesto(h) {
  const { prisma, dashboardApi, formatMXN, fechaCorta, dateOnly, parseMonto, parseId, normalize, parseFecha, elegirPorNombre, resolverCategoria, mismaHuella } = h

  // Carga perezosa: miloTools requiere a miloAcciones al cargar.
  const resolvePeriod = periodo => require('./miloTools').resolvePeriod(periodo)

  const efectivo = linea => Number(linea.montoRevisado ?? linea.montoPresupuestado)

  async function realDe(lineaId) {
    const agg = await prisma.transaccion.aggregate({ where: { presupuestoId: lineaId }, _sum: { monto: true } })
    return Number(agg._sum.monto ?? 0)
  }

  async function cargarLinea(id) {
    return prisma.presupuesto.findUnique({ where: { id }, include: { categoria: true, quincena: true } })
  }

  async function quincenaDe(periodo) {
    const q = await resolvePeriod(periodo || 'actual')
    return q || null
  }

  // Una linea por id, o por nombre dentro de una quincena (default la actual).
  // Las Canceladas no se ofrecen: ya no estan en el plan.
  async function resolverLinea(args, { campoId = 'id', campoNombre = 'line', campoPeriodo = 'period', etiqueta = 'línea' } = {}) {
    const id = parseId(args[campoId])
    if (id) {
      const linea = await cargarLinea(id)
      if (!linea) return { ok: false, error: `No existe la ${etiqueta} #${id}.` }
      return { ok: true, valor: linea }
    }
    const nombre = args[campoNombre]
    if (!nombre) return { ok: false, error: `Falta la ${etiqueta}: manda su id (list_budget_lines) o su nombre.` }
    const quincena = await quincenaDe(args[campoPeriodo])
    if (!quincena) return { ok: false, error: `No encontré la quincena ${args[campoPeriodo] || 'actual'}.` }
    const lineas = await prisma.presupuesto.findMany({
      where: { quincenaId: quincena.id, estadoLinea: { not: 'Cancelada' } },
      include: { categoria: true, quincena: true },
      orderBy: { id: 'asc' },
    })
    if (!lineas.length) return { ok: false, error: `${quincena.codigo} no tiene líneas de presupuesto.` }
    return elegirPorNombre(lineas, nombre, etiqueta, 'descripcion')
  }

  function huellaLinea(linea) {
    return {
      quincenaId: linea.quincenaId,
      descripcion: linea.descripcion,
      categoriaId: linea.categoriaId,
      efectivo: efectivo(linea),
      estadoLinea: linea.estadoLinea,
      clasificacion: linea.clasificacion ?? null,
    }
  }

  async function verificarHuella(id, guardada) {
    const linea = await cargarLinea(id)
    if (!linea) throw new Error(`La línea #${id} ya no existe.`)
    if (!mismaHuella(huellaLinea(linea), guardada)) {
      throw new Error('La línea cambió desde que te lo propuse. Pídemelo otra vez para ver los datos actuales.')
    }
    return linea
  }

  function clasificacionValida(valor) {
    if (valor == null || valor === '') return undefined
    const t = normalize(String(valor))
    if (t === 'fijo') return 'Fijo'
    if (t === 'variable') return 'Variable'
    if (['ninguna', 'sin', 'none', 'null'].includes(t)) return null
    return false
  }

  function frecuenciaValida(valor) {
    const t = normalize(String(valor || ''))
    if (!t || ['quincenal', 'cada quincena', 'cada_quincena'].includes(t)) return 'CADA_QUINCENA'
    if (['mensual', 'cada mes'].includes(t)) return 'MENSUAL'
    return null
  }

  const describir = linea => `${linea.descripcion} (${linea.categoria?.nombre || 'sin categoría'}, ${linea.quincena?.codigo || '—'})`

  return {
    'presupuesto.crear': {
      async preparar(args) {
        const descripcion = String(args.description || '').trim().slice(0, 200)
        if (!descripcion) return { ok: false, error: 'Falta la descripción de la línea.' }
        const monto = parseMonto(args.amount)
        if (!monto) return { ok: false, error: 'Falta el monto (mayor que cero).' }
        if (!args.category) return { ok: false, error: 'Falta la categoría. Usa list_categories si no la sabes.' }
        const cat = await resolverCategoria(args.category)
        if (!cat.ok) return cat
        const categoria = cat.valor

        const quincena = await quincenaDe(args.period)
        if (!quincena) return { ok: false, error: `No encontré la quincena ${args.period || 'actual'}.` }

        const clasificacion = clasificacionValida(args.classification)
        if (clasificacion === false) return { ok: false, error: 'classification debe ser Fijo o Variable.' }

        let fechaVencimiento = null
        if (args.dueDate) {
          fechaVencimiento = parseFecha(args.dueDate)
          if (!fechaVencimiento) return { ok: false, error: `No entendí la fecha de vencimiento "${args.dueDate}". Usa YYYY-MM-DD.` }
        }

        const recurrente = args.recurrent === true || args.recurrent === 'true'
        let frecuencia = null
        let numOcurrencias = null
        let diaCobro = null
        if (recurrente) {
          frecuencia = frecuenciaValida(args.frequency)
          if (!frecuencia) return { ok: false, error: 'frequency debe ser quincenal o mensual.' }
          if (args.occurrences != null && args.occurrences !== '') {
            numOcurrencias = Number.parseInt(args.occurrences, 10)
            if (!Number.isInteger(numOcurrencias) || numOcurrencias < 1 || numOcurrencias > 48) {
              return { ok: false, error: 'occurrences debe ser un número entre 1 y 48 (o nada, sin fin).' }
            }
          }
          if (args.payDay != null && args.payDay !== '') {
            diaCobro = Number.parseInt(args.payDay, 10)
            if (!Number.isInteger(diaCobro) || diaCobro < 1 || diaCobro > 31) return { ok: false, error: 'payDay debe ser un día del 1 al 31.' }
          }
        }

        const duplicada = await prisma.presupuesto.findFirst({
          where: { quincenaId: quincena.id, categoriaId: categoria.id, estadoLinea: { not: 'Cancelada' }, descripcion: { equals: descripcion, mode: 'insensitive' } },
        })

        const renglones = [
          `Crear línea de presupuesto: ${descripcion} — ${formatMXN(monto)}`,
          `• Quincena: ${quincena.codigo}${recurrente ? ' en adelante' : ''}`,
          `• Categoría: ${categoria.nombre} (${categoria.tipo})`,
        ]
        if (clasificacion) renglones.push(`• Clasificación: ${clasificacion}`)
        if (fechaVencimiento) renglones.push(`• Vence: ${fechaCorta(fechaVencimiento)}`)
        if (recurrente) {
          renglones.push(`• Se repite ${frecuencia === 'MENSUAL' ? 'cada mes' : 'cada quincena'}${numOcurrencias ? `, ${numOcurrencias} veces` : ', sin fin'}${diaCobro ? `, el día ${diaCobro}` : ''}`)
        }
        if (duplicada) renglones.push(`\nOjo: ya existe "${duplicada.descripcion}" en ${quincena.codigo} con esa categoría (#${duplicada.id}). Esta sería otra línea.`)

        return {
          ok: true,
          payload: {
            quincenaId: quincena.id,
            descripcion,
            categoriaId: categoria.id,
            montoPresupuestado: monto,
            ...(clasificacion !== undefined ? { clasificacion } : {}),
            fechaVencimiento,
            recurrente,
            frecuencia,
            numOcurrencias,
            diaCobro,
          },
          resumen: renglones.join('\n'),
        }
      },

      async yaAplicada(payload, fila) {
        const existente = await prisma.presupuesto.findFirst({
          where: {
            quincenaId: payload.quincenaId, categoriaId: payload.categoriaId, descripcion: payload.descripcion,
            fechaRegistro: { gte: fila.createdAt },
          },
          orderBy: { id: 'desc' },
        })
        if (!existente) return null
        return { mensaje: `La línea ${payload.descripcion} ya estaba creada (#${existente.id}).`, resultado: { presupuestoId: existente.id } }
      },

      async ejecutar(payload, ctx) {
        const r = await dashboardApi.llamar('POST', '/api/presupuestos', { body: payload, actor: ctx.actor, userId: ctx.userId })
        const extra = payload.recurrente && r?.created ? ` (${r.created} quincenas)` : ''
        return { mensaje: `Listo: creé la línea ${payload.descripcion} por ${formatMXN(payload.montoPresupuestado)}${extra}.`, resultado: { presupuestoId: r?.id ?? null, grupoId: r?.grupoId ?? null } }
      },
    },

    'presupuesto.ajustar': {
      async preparar(args) {
        const r = await resolverLinea(args)
        if (!r.ok) return r
        const linea = r.valor
        if (linea.estadoLinea === 'Cancelada') return { ok: false, error: `La línea ${linea.descripcion} está cancelada.` }

        const cambios = {}
        const renglones = []
        if (args.amount != null && args.amount !== '') {
          const monto = parseMonto(args.amount)
          if (!monto) return { ok: false, error: 'El monto nuevo debe ser mayor que cero.' }
          const real = await realDe(linea.id)
          cambios.montoRevisado = monto
          renglones.push(`• Monto vigente: ${formatMXN(efectivo(linea))} → ${formatMXN(monto)} (el original de ${formatMXN(Number(linea.montoPresupuestado))} queda en el historial)`)
          // El dashboard lo permite; se avisa, igual que se veria en la tabla.
          if (monto < real) renglones.push(`• Ojo: ya lleva ${formatMXN(real)} gastado; quedaría excedida por ${formatMXN(real - monto)}`)
        }
        if (args.description) {
          const d = String(args.description).trim().slice(0, 200)
          if (d && d !== linea.descripcion) { cambios.descripcion = d; renglones.push(`• Nombre: ${linea.descripcion} → ${d}`) }
        }
        if (args.classification !== undefined) {
          const c = clasificacionValida(args.classification)
          if (c === false) return { ok: false, error: 'classification debe ser Fijo o Variable.' }
          if (c !== undefined && c !== (linea.clasificacion ?? null)) { cambios.clasificacion = c; renglones.push(`• Clasificación: ${linea.clasificacion || '—'} → ${c || '—'}`) }
        }
        if (args.dueDate !== undefined && args.dueDate !== '') {
          const sin = ['ninguna', 'sin', 'none', 'null'].includes(normalize(String(args.dueDate)))
          const f = sin ? null : parseFecha(args.dueDate)
          if (!sin && !f) return { ok: false, error: `No entendí la fecha de vencimiento "${args.dueDate}". Usa YYYY-MM-DD.` }
          cambios.fechaVencimiento = f
          renglones.push(`• Vence: ${linea.fechaVencimiento ? fechaCorta(dateOnly(linea.fechaVencimiento)) : '—'} → ${f ? fechaCorta(f) : '—'}`)
        }
        if (!renglones.length) return { ok: false, error: 'No hay nada que cambiar: manda amount, description, classification o dueDate.' }

        // "De aqui en adelante" en una serie recurrente: el PUT regenera las
        // futuras, y SIN recurrente:true las borra y deja de repetir la linea.
        // Se manda la recurrencia que ya tiene la serie, tal cual.
        const serie = Boolean(linea.recurrenciaGrupoId)
        const enAdelante = serie && ['forward', 'adelante', 'en adelante', 'this_forward', 'serie', 'todas'].includes(normalize(String(args.scope || '')))
        const body = {
          ...cambios,
          motivoCambio: args.reason ? String(args.reason).trim().slice(0, 200) : 'Ajuste pedido a Milo',
          scope: enAdelante ? 'this_forward' : 'single',
          ...(enAdelante ? { recurrente: true, frecuencia: linea.frecuencia, diaCobro: linea.diaCobro, numOcurrencias: linea.numOcurrencias } : {}),
        }
        if (enAdelante) renglones.push('• Aplica a esta quincena y a las siguientes de la serie')
        else if (serie) renglones.push('• Solo esta quincena (la serie sigue igual)')

        return {
          ok: true,
          payload: { id: linea.id, body, huella: huellaLinea(linea), objetivo: cambios },
          resumen: [`Ajustar línea: ${describir(linea)}`, ...renglones].join('\n'),
        }
      },

      async yaAplicada(payload) {
        const linea = await cargarLinea(payload.id)
        if (!linea) return null
        const o = payload.objetivo || {}
        const listo = (o.montoRevisado == null || Math.abs(efectivo(linea) - o.montoRevisado) < 0.005) &&
          (o.descripcion == null || linea.descripcion === o.descripcion)
        return listo ? { mensaje: `La línea ${linea.descripcion} ya tenía ese cambio.`, resultado: { presupuestoId: linea.id } } : null
      },

      async ejecutar(payload, ctx) {
        const linea = await verificarHuella(payload.id, payload.huella)
        await dashboardApi.llamar('PUT', `/api/presupuestos/${payload.id}`, { body: payload.body, actor: ctx.actor, userId: ctx.userId })
        return { mensaje: `Listo: actualicé la línea ${payload.body.descripcion || linea.descripcion}.`, resultado: { presupuestoId: payload.id } }
      },
    },

    'presupuesto.cancelar': {
      async preparar(args) {
        const r = await resolverLinea(args)
        if (!r.ok) return r
        const linea = r.valor
        if (linea.estadoLinea === 'Cancelada') return { ok: false, error: `La línea ${linea.descripcion} ya está cancelada.` }

        const t = normalize(String(args.scope || ''))
        let alcance = 'single'
        if (linea.recurrenciaGrupoId && ['future', 'futuras', 'siguientes', 'en adelante', 'adelante'].includes(t)) alcance = 'future'
        if (linea.recurrenciaGrupoId && ['all', 'todas', 'serie', 'toda la serie'].includes(t)) alcance = 'all'

        // La base no deja cancelar una linea con movimientos (trigger). Se dice
        // antes, con la salida: mover esos movimientos o ajustar el monto.
        if (alcance === 'single') {
          const conMovimientos = await prisma.transaccion.count({ where: { presupuestoId: linea.id } })
          if (conMovimientos > 0) {
            return { ok: false, error: `${linea.descripcion} tiene ${conMovimientos} movimiento(s) asignado(s) y no se puede cancelar. Ofrece quitarles la línea (proponer_editar_movimiento con budgetLine "ninguna") o ajustar el monto.` }
          }
        } else {
          // Toda la serie o sus futuras: basta UNA ocurrencia con movimientos
          // para que la base rechace todo el lote.
          const enSerie = await prisma.transaccion.count({
            where: {
              presupuesto: {
                recurrenciaGrupoId: linea.recurrenciaGrupoId,
                ...(alcance === 'future' ? { quincena: { fechaInicio: { gt: linea.quincena.fechaInicio } } } : {}),
              },
            },
          })
          if (enSerie > 0) {
            return { ok: false, error: `Esa serie tiene ${enSerie} movimiento(s) asignado(s) en las quincenas que se cancelarían. Ofrece cancelar solo las futuras sin gasto o quitarles la línea primero.` }
          }
        }

        const renglones = [`Cancelar línea: ${describir(linea)} — ${formatMXN(efectivo(linea))}`]
        if (alcance === 'future') renglones.push('• Solo las quincenas SIGUIENTES de la serie (esta se queda)')
        else if (alcance === 'all') renglones.push('• TODA la serie recurrente')
        else if (linea.recurrenciaGrupoId) renglones.push('• Solo esta quincena (la serie sigue)')
        renglones.push('\nNo se borra: queda como Cancelada en el historial.')

        return {
          ok: true,
          payload: { id: linea.id, alcance, grupoId: linea.recurrenciaGrupoId || null, huella: huellaLinea(linea) },
          resumen: renglones.join('\n'),
        }
      },

      async yaAplicada(payload) {
        if (payload.alcance !== 'single') return null
        const linea = await cargarLinea(payload.id)
        return linea?.estadoLinea === 'Cancelada' ? { mensaje: `La línea ${linea.descripcion} ya estaba cancelada.`, resultado: { presupuestoId: linea.id } } : null
      },

      async ejecutar(payload, ctx) {
        const linea = await verificarHuella(payload.id, payload.huella)
        let ruta = `/api/presupuestos/${payload.id}`
        if (payload.alcance === 'future') ruta += `?grupoId=${encodeURIComponent(payload.grupoId)}&scope=future`
        else if (payload.alcance === 'all') ruta += `?grupoId=${encodeURIComponent(payload.grupoId)}`
        const r = await dashboardApi.llamar('DELETE', ruta, { actor: ctx.actor, userId: ctx.userId })
        const cuantas = r?.count && r.count > 1 ? ` (${r.count} quincenas)` : ''
        return { mensaje: `Listo: cancelé ${linea.descripcion}${cuantas}.`, resultado: { presupuestoId: payload.id, count: r?.count ?? null } }
      },
    },

    'presupuesto.traspasar': {
      async preparar(args) {
        const monto = parseMonto(args.amount)
        if (!monto) return { ok: false, error: 'Falta el monto del traspaso (mayor que cero).' }

        const rDestino = await resolverLinea(args, { campoId: 'toId', campoNombre: 'to', etiqueta: 'línea destino' })
        if (!rDestino.ok) return rDestino
        const destino = rDestino.valor

        const desdeSinAsignar = !args.fromId && (!args.from || ['sin asignar', 'libre', 'colchon', 'colchón', 'disponible'].includes(normalize(String(args.from))))
        let origen = null
        if (!desdeSinAsignar) {
          const rOrigen = await resolverLinea({ ...args, period: args.period || destino.quincena?.codigo }, { campoId: 'fromId', campoNombre: 'from', etiqueta: 'línea origen' })
          if (!rOrigen.ok) return rOrigen
          origen = rOrigen.valor
          if (origen.id === destino.id) return { ok: false, error: 'La línea origen y la destino son la misma.' }
          if (origen.quincenaId !== destino.quincenaId) return { ok: false, error: 'El traspaso solo va entre líneas de la MISMA quincena.' }
          const disponible = efectivo(origen) - await realDe(origen.id)
          if (monto > disponible + 0.005) {
            return { ok: false, error: `${origen.descripcion} solo tiene ${formatMXN(Math.max(0, disponible))} sin gastar; no alcanza para ${formatMXN(monto)}.` }
          }
        }

        const nota = args.reason ? String(args.reason).trim().slice(0, 200) : undefined
        const renglones = [
          `Traspaso de presupuesto: ${formatMXN(monto)} (${destino.quincena?.codigo || '—'})`,
          origen
            ? `• De: ${origen.descripcion} — ${formatMXN(efectivo(origen))} → ${formatMXN(efectivo(origen) - monto)}`
            : '• De: dinero sin asignar de la quincena',
          `• A: ${destino.descripcion} — ${formatMXN(efectivo(destino))} → ${formatMXN(efectivo(destino) + monto)}`,
        ]
        if (nota) renglones.push(`• Nota: ${nota}`)

        return {
          ok: true,
          payload: {
            destinoId: destino.id,
            origenId: origen?.id ?? null,
            monto,
            nota,
            antes: { destino: efectivo(destino), origen: origen ? efectivo(origen) : null },
          },
          resumen: renglones.join('\n'),
        }
      },

      // Ya aplicado si los montos vigentes quedaron justo como se planeo.
      async yaAplicada(payload) {
        const destino = await cargarLinea(payload.destinoId)
        if (!destino || Math.abs(efectivo(destino) - (payload.antes.destino + payload.monto)) >= 0.005) return null
        if (payload.origenId) {
          const origen = await cargarLinea(payload.origenId)
          if (!origen || Math.abs(efectivo(origen) - (payload.antes.origen - payload.monto)) >= 0.005) return null
        }
        return { mensaje: `Ese traspaso de ${formatMXN(payload.monto)} ya estaba hecho.`, resultado: { presupuestoId: payload.destinoId } }
      },

      async ejecutar(payload, ctx) {
        // Si alguna de las dos lineas cambio de monto desde la propuesta, el
        // resumen que vio el usuario ya no es cierto.
        const destino = await cargarLinea(payload.destinoId)
        if (!destino) throw new Error('La línea destino ya no existe.')
        if (Math.abs(efectivo(destino) - payload.antes.destino) >= 0.005) throw new Error('La línea destino cambió desde que te lo propuse. Pídemelo otra vez.')
        if (payload.origenId) {
          const origen = await cargarLinea(payload.origenId)
          if (!origen) throw new Error('La línea origen ya no existe.')
          if (Math.abs(efectivo(origen) - payload.antes.origen) >= 0.005) throw new Error('La línea origen cambió desde que te lo propuse. Pídemelo otra vez.')
        }
        await dashboardApi.llamar('POST', `/api/presupuestos/${payload.destinoId}/transferir`, {
          body: { monto: payload.monto, ...(payload.origenId ? { origenId: payload.origenId } : {}), ...(payload.nota ? { nota: payload.nota } : {}) },
          actor: ctx.actor,
          userId: ctx.userId,
        })
        return { mensaje: `Listo: pasé ${formatMXN(payload.monto)} a ${destino.descripcion}.`, resultado: { presupuestoId: payload.destinoId } }
      },
    },

    'presupuesto.mover': {
      async preparar(args) {
        const r = await resolverLinea(args)
        if (!r.ok) return r
        const linea = r.valor
        if (linea.estadoLinea === 'Cancelada') return { ok: false, error: `La línea ${linea.descripcion} está cancelada.` }
        if (!args.toPeriod) return { ok: false, error: 'Falta toPeriod: a qué quincena (p. ej. "siguiente" o "Q40").' }
        const destino = await quincenaDe(args.toPeriod)
        if (!destino) return { ok: false, error: `No encontré la quincena ${args.toPeriod}.` }
        if (destino.id === linea.quincenaId) return { ok: false, error: `La línea ya está en ${destino.codigo}.` }
        if (linea.recurrenciaGrupoId) {
          const choca = await prisma.presupuesto.findFirst({ where: { quincenaId: destino.id, recurrenciaGrupoId: linea.recurrenciaGrupoId } })
          if (choca) return { ok: false, error: `${destino.codigo} ya tiene la ocurrencia de esta serie (#${choca.id}). Ajusta esa en vez de mover esta.` }
        }
        const conMovimientos = await prisma.transaccion.count({ where: { presupuestoId: linea.id } })
        if (conMovimientos > 0) {
          return { ok: false, error: `${linea.descripcion} tiene ${conMovimientos} movimiento(s) de ${linea.quincena?.codigo}; no se mueve una línea con gasto ya registrado.` }
        }
        return {
          ok: true,
          payload: { id: linea.id, quincenaId: destino.id, huella: huellaLinea(linea) },
          resumen: `Mover línea: ${describir(linea)} — ${formatMXN(efectivo(linea))}\n• De ${linea.quincena?.codigo || '—'} a ${destino.codigo}`,
        }
      },

      async yaAplicada(payload) {
        const linea = await cargarLinea(payload.id)
        return linea?.quincenaId === payload.quincenaId ? { mensaje: `${linea.descripcion} ya estaba en ${linea.quincena?.codigo}.`, resultado: { presupuestoId: linea.id } } : null
      },

      async ejecutar(payload, ctx) {
        const linea = await verificarHuella(payload.id, payload.huella)
        await dashboardApi.llamar('PUT', `/api/presupuestos/${payload.id}`, {
          body: { quincenaId: payload.quincenaId, scope: 'single', motivoCambio: 'Movida de quincena por Milo' },
          actor: ctx.actor,
          userId: ctx.userId,
        })
        return { mensaje: `Listo: moví ${linea.descripcion} de quincena.`, resultado: { presupuestoId: payload.id } }
      },
    },
  }
}

module.exports = { crearTiposPresupuesto }
