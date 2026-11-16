// CIERRE DE QUINCENA por chat (Fase B2, 2026-11-16): lo mismo que el asistente
// de cierre del dashboard (dashboard/src/components/ui/CierreQuincenaWizard.tsx).
//
// Una quincena que ya termino no se cierra mientras tenga lineas de Gasto sin
// resolver. Por linea, el motivo decide que opciones hay (mismas reglas que
// dashboard/src/lib/cierre-quincena.ts):
//   sinRegistro      nunca se registro nada  -> registrar como pagado, mover a
//                                               la quincena actual, cancelar
//   pendienteDePago  hay algo sin pagar       -> marcar pagado, mover
//   excedido         se gasto de mas          -> aceptar la variacion (absorber);
//                                               cubrir el exceso es un traspaso
//                                               (proponer_traspaso)
// Todo va por POST /api/presupuestos/:id/resolver, que ademas cierra la
// quincena sola cuando ya no le queda nada pendiente (cerrarSiCorresponde).

const { fechaMexico } = require('./financeUtils')
const finanzas = require('./lib/finanzas-quincena')

function motivoPendiente(linea) {
  if (linea.estadoLinea !== 'Abierta') return null
  if (linea.categoria?.tipo !== 'Gasto') return null
  if (linea.real === 0) return 'sinRegistro'
  if (linea.pendiente > 0) return 'pendienteDePago'
  if (linea.real > linea.montoEfectivo) return 'excedido'
  return null
}

function montoPendiente(linea, motivo) {
  if (motivo === 'excedido') return linea.real - linea.montoEfectivo
  return linea.pendiente + Math.max(linea.montoEfectivo - linea.real, 0)
}

const MOTIVO_TEXTO = {
  sinRegistro: 'sin registrar',
  pendienteDePago: 'pendiente de pago',
  excedido: 'excedido',
}

// Opciones validas por motivo (las mismas que muestra el asistente).
const OPCIONES = {
  sinRegistro: ['registrar_pagado', 'mover', 'cancelar'],
  pendienteDePago: ['pagar_existente', 'mover'],
  excedido: ['absorber'],
}

const r2 = n => Math.round(Number(n) * 100) / 100
const fechaISO = d => (d ? new Date(d).toISOString().slice(0, 10) : null)

// Quincenas que ya terminaron (fechaFin < hoy), sin cerrar, con lineas que
// necesitan una decision. De la mas vieja a la mas reciente.
async function pendientesDeCierre(prisma, hoy = fechaMexico()) {
  const quincenas = await prisma.quincena.findMany({
    where: { fechaFin: { lt: new Date(`${hoy}T00:00:00.000Z`) }, fechaCierre: null },
    orderBy: { fechaFin: 'asc' },
  })
  const grupos = []
  for (const q of quincenas) {
    const lineas = await finanzas.cargarLineasDeQuincena(prisma, q.id)
    const items = []
    for (const l of lineas) {
      const motivo = motivoPendiente(l)
      if (!motivo) continue
      items.push({
        lineId: l.id,
        line: l.descripcion,
        category: l.categoria?.nombre,
        reason: MOTIVO_TEXTO[motivo],
        motivo,
        amount: r2(montoPendiente(l, motivo)),
        budget: r2(l.montoEfectivo),
        spent: r2(l.real),
        pending: r2(l.pendiente),
        options: OPCIONES[motivo],
      })
    }
    if (items.length) {
      grupos.push({ period: q.codigo, ended: fechaISO(q.fechaFin), total: r2(items.reduce((s, i) => s + i.amount, 0)), lines: items })
    }
  }
  return grupos
}

function crearTiposCierre(h) {
  const { prisma, dashboardApi, formatMXN, fechaCorta, parseMonto, parseId, normalize, parseFecha, elegirPorNombre } = h
  const resolvePeriod = periodo => require('./miloTools').resolvePeriod(periodo)

  const ALIAS = {
    registrar_pagado: ['registrar_pagado', 'registrar', 'registrar como pagado', 'pagado sin registro', 'ya se pago'],
    pagar_existente: ['pagar_existente', 'marcar pagado', 'marcar como pagado', 'pagado', 'ya se pago lo registrado'],
    mover: ['mover', 'mover a la actual', 'pasar a la siguiente', 'recorrer'],
    cancelar: ['cancelar', 'no aplico', 'no aplicó', 'no se hizo'],
    absorber: ['absorber', 'aceptar', 'aceptar variacion', 'aceptar variación', 'dejarlo asi', 'dejarlo así'],
  }
  function accionDe(valor) {
    const t = normalize(String(valor || '')).replace(/_/g, ' ')
    for (const [accion, nombres] of Object.entries(ALIAS)) {
      if (nombres.some(n => normalize(n).replace(/_/g, ' ') === t)) return accion
    }
    return null
  }

  // La linea con su real/pendiente al dia (misma matematica del dashboard).
  async function cargarLinea(id) {
    const fila = await prisma.presupuesto.findUnique({ where: { id }, include: { quincena: true, categoria: true } })
    if (!fila) return null
    const [calculada] = await finanzas.cargarLineasDeQuincena(prisma, fila.quincenaId, { id })
    return calculada ? { ...calculada, quincena: fila.quincena } : null
  }

  async function resolverLinea(args) {
    const id = parseId(args.lineId ?? args.id)
    if (id) {
      const l = await cargarLinea(id)
      return l ? { ok: true, valor: l } : { ok: false, error: `No existe la línea #${id}.` }
    }
    if (!args.line) return { ok: false, error: 'Falta la línea: manda lineId (get_closing_status) o line + period.' }
    const pendientes = await pendientesDeCierre(prisma)
    const candidatas = pendientes.flatMap(g => g.lines.map(l => ({ ...l, period: g.period })))
      .filter(l => !args.period || normalize(l.period) === normalize(args.period))
    if (!candidatas.length) return { ok: false, error: 'No hay líneas pendientes de cierre con esos datos. Consulta get_closing_status.' }
    const r = elegirPorNombre(candidatas, args.line, 'línea pendiente', 'line')
    if (!r.ok) return r
    const l = await cargarLinea(r.valor.lineId)
    return l ? { ok: true, valor: l } : { ok: false, error: 'Esa línea ya no existe.' }
  }

  return {
    'cierre.resolver': {
      async preparar(args) {
        const r = await resolverLinea(args)
        if (!r.ok) return r
        const linea = r.valor
        const motivo = motivoPendiente(linea)
        if (!motivo) return { ok: false, error: `${linea.descripcion} ya no necesita cierre (está ${linea.estadoLinea}${linea.estadoLinea === 'Abierta' ? ' y cuadrada' : ''}).` }
        const hoy = fechaMexico()
        if (fechaISO(linea.quincena.fechaFin) >= hoy) return { ok: false, error: `${linea.quincena.codigo} todavía no termina; el cierre es para quincenas pasadas.` }

        const accion = accionDe(args.action)
        if (!accion) return { ok: false, error: `action debe ser una de: ${OPCIONES[motivo].join(', ')} (la línea está ${MOTIVO_TEXTO[motivo]}).` }
        if (!OPCIONES[motivo].includes(accion)) {
          const extra = motivo === 'excedido' ? ' Para cubrir el exceso con otra línea usa proponer_traspaso.' : ''
          return { ok: false, error: `Con la línea ${MOTIVO_TEXTO[motivo]} las opciones son: ${OPCIONES[motivo].join(', ')}.${extra}` }
        }

        const pendiente = r2(montoPendiente(linea, motivo))
        const cab = `Cierre de ${linea.quincena.codigo}: ${linea.descripcion} (${linea.categoria?.nombre}) — ${MOTIVO_TEXTO[motivo]}, ${formatMXN(pendiente)}`
        const body = { accion }
        const renglones = [cab]
        let extra = {}

        if (accion === 'registrar_pagado') {
          const monto = args.amount != null && args.amount !== '' ? parseMonto(args.amount) : r2(linea.montoEfectivo)
          if (!monto) return { ok: false, error: 'El monto pagado debe ser mayor que cero.' }
          const fecha = args.date ? parseFecha(args.date) : fechaISO(linea.quincena.fechaFin)
          if (!fecha) return { ok: false, error: `No entendí la fecha "${args.date}". Usa YYYY-MM-DD.` }
          Object.assign(body, { fecha, monto })
          renglones.push(`• Registrar un pago de ${formatMXN(monto)} el ${fechaCorta(fecha)} (Pagado) y marcar la línea cumplida`)
        } else if (accion === 'pagar_existente') {
          renglones.push(`• Marcar como Pagado lo registrado pendiente (${formatMXN(r2(linea.pendiente))}) y la línea cumplida`)
        } else if (accion === 'mover') {
          const actual = await resolvePeriod('actual')
          if (!actual) return { ok: false, error: 'No hay quincena actual a la cual mover la línea.' }
          if (actual.id === linea.quincenaId) return { ok: false, error: 'La línea ya está en la quincena actual.' }
          body.targetQuincenaId = actual.id
          extra = { destino: actual.codigo }
          renglones.push(`• Pasarla a ${actual.codigo} (sigue abierta allá)`)
        } else if (accion === 'cancelar' || accion === 'absorber') {
          const nota = args.note ? String(args.note).trim().slice(0, 200) : null
          if (nota) body.nota = nota
          renglones.push(accion === 'cancelar'
            ? '• Cancelarla: no aplicó esta quincena (queda en el historial)'
            : `• Aceptar la variación: se gastó ${formatMXN(pendiente)} de más y se da por buena`)
          if (nota) renglones.push(`• Nota: ${nota}`)
        }
        renglones.push('\nSi era lo último pendiente, la quincena se cierra sola.')

        return {
          ok: true,
          payload: { id: linea.id, body, motivo, quincenaId: linea.quincenaId, ...extra },
          resumen: renglones.join('\n'),
        }
      },

      async yaAplicada(payload) {
        const linea = await cargarLinea(payload.id)
        if (!linea) return null
        const listo = payload.body.accion === 'mover' ? linea.quincenaId === payload.body.targetQuincenaId : linea.estadoLinea !== 'Abierta'
        return listo ? { mensaje: `${linea.descripcion} ya estaba resuelta.`, resultado: { presupuestoId: linea.id } } : null
      },

      async ejecutar(payload, ctx) {
        const linea = await cargarLinea(payload.id)
        if (!linea) throw new Error('La línea ya no existe.')
        if (linea.quincenaId !== payload.quincenaId || motivoPendiente(linea) !== payload.motivo) {
          throw new Error('La línea cambió desde que te lo propuse. Pídemelo otra vez.')
        }
        await dashboardApi.llamar('POST', `/api/presupuestos/${payload.id}/resolver`, { body: payload.body, actor: ctx.actor, userId: ctx.userId })
        const hecho = {
          registrar_pagado: 'registré el pago y la marqué cumplida',
          pagar_existente: 'marqué pagado lo pendiente',
          mover: `la pasé a ${payload.destino || 'la quincena actual'}`,
          cancelar: 'la cancelé',
          absorber: 'acepté la variación',
        }[payload.body.accion]
        return { mensaje: `Listo: ${linea.descripcion}, ${hecho}.`, resultado: { presupuestoId: payload.id } }
      },
    },
  }
}

module.exports = { crearTiposCierre, pendientesDeCierre, _interno: { motivoPendiente, montoPendiente, OPCIONES } }
