// AHORRO, DEUDAS y CREDITOS por chat (Fase B3, 2026-11-16): lo que hacen las
// pantallas Ahorro, Deudas y Creditos del dashboard, con boton Confirmar y por
// las mismas rutas.
//
//   apartado.crear / apartado.editar   /api/apartados        (metas de ahorro)
//   deuda.crear / deuda.editar         /api/deudas           (incluye liquidarla)
//   credito.crear / credito.editar     /api/creditos         (tarjetas, prestamos, MSI)
//   credito.compra                     /api/transacciones    compra a meses: la
//                                      ruta crea un pago por mes en el credito
//
// Los aportes y retiros a un apartado son movimientos normales: van por
// proponer_registrar_movimiento (transaccion.registrar) con direction y
// savingsBucket. Un abono a una deuda tambien es un movimiento de la
// categoria de la deuda.
//
// Lo que NO se ofrece: borrar deudas (la ruta borra sin dejar rastro; la
// pantalla las desactiva) ni editar los pagos de un credito uno por uno.

const { dbDate, fechaMexico } = require('./financeUtils')

function crearTiposAhorroDeudas(h) {
  const { prisma, dashboardApi, formatMXN, fechaCorta, dateOnly, parseMonto, parseId, normalize, parseFecha, elegirPorNombre, resolverCategoria, quincenaParaFecha } = h

  const TIPOS_CREDITO = ['Tarjeta', 'CreditoTienda', 'Prestamo', 'MSI', 'LineaCredito', 'Informal', 'Otro']
  const ALIAS_CREDITO = { tarjeta: 'Tarjeta', 'tarjeta de credito': 'Tarjeta', tienda: 'CreditoTienda', 'credito de tienda': 'CreditoTienda', prestamo: 'Prestamo', msi: 'MSI', 'meses sin intereses': 'MSI', 'linea de credito': 'LineaCredito', informal: 'Informal', otro: 'Otro' }

  const texto = (v, max) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max)
  const sinValor = v => ['ninguna', 'ninguno', 'sin', 'none', 'null', 'quitar'].includes(normalize(String(v)))

  function siNo(valor) {
    if (valor == null || valor === '') return undefined
    if (typeof valor === 'boolean') return valor
    const t = normalize(String(valor))
    if (['true', 'si', 'sí', '1', 'activa', 'activo', 'activar'].includes(t)) return true
    if (['false', 'no', '0', 'inactiva', 'inactivo', 'desactivar', 'liquidada', 'pagada', 'archivar'].includes(t)) return false
    return null
  }

  function dia(valor, etiqueta) {
    if (valor == null || valor === '') return { ok: true, valor: undefined }
    const n = Number.parseInt(valor, 10)
    if (!Number.isInteger(n) || n < 1 || n > 31) return { ok: false, error: `${etiqueta} debe ser un día del 1 al 31.` }
    return { ok: true, valor: n }
  }

  // Monto opcional: undefined si no viene, null para quitarlo, false si es invalido.
  function montoOpcional(valor) {
    if (valor === undefined || valor === '') return undefined
    if (sinValor(valor)) return null
    return parseMonto(valor) || false
  }

  async function buscar(modelo, args, etiqueta, campo = 'nombre') {
    const id = parseId(args.id)
    if (id) {
      const fila = await prisma[modelo].findUnique({ where: { id } })
      return fila ? { ok: true, valor: fila } : { ok: false, error: `No existe ${etiqueta} #${id}.` }
    }
    const nombre = args.name ?? args.creditor
    if (!nombre) return { ok: false, error: `Falta cuál ${etiqueta}: manda id o name.` }
    const lista = await prisma[modelo].findMany({ orderBy: { id: 'asc' } })
    return elegirPorNombre(lista, nombre, etiqueta, campo)
  }

  // Antes de aplicar una edicion: si cambio desde la propuesta, no se aplica.
  async function verificar(modelo, id, antes, etiqueta) {
    const fila = await prisma[modelo].findUnique({ where: { id } })
    if (!fila) throw new Error(`${etiqueta} #${id} ya no existe.`)
    for (const [k, v] of Object.entries(antes)) {
      const actual = fila[k] == null ? null : (typeof v === 'number' ? Number(fila[k]) : fila[k])
      if (actual !== v) throw new Error(`${etiqueta} cambió desde que te lo propuse. Pídemelo otra vez.`)
    }
    return fila
  }

  function yaConCambios(modelo, etiqueta, nombreDe) {
    return async payload => {
      const fila = await prisma[modelo].findUnique({ where: { id: payload.id } })
      if (!fila) return null
      const listo = Object.entries(payload.cambios).every(([k, v]) => {
        const actual = fila[k] == null ? null : (typeof v === 'number' ? Number(fila[k]) : fila[k])
        return actual === (v instanceof Date ? v : v)
      })
      return listo ? { mensaje: `${etiqueta} ${nombreDe(fila)} ya tenía ese cambio.`, resultado: { id: fila.id } } : null
    }
  }

  return {
    // ---- Apartados de ahorro ------------------------------------------------------
    'apartado.crear': {
      async preparar(args) {
        const nombre = texto(args.name, 50)
        if (!nombre) return { ok: false, error: 'Falta el nombre del apartado.' }
        const lista = await prisma.apartado.findMany()
        if (lista.some(a => normalize(a.nombre) === normalize(nombre))) return { ok: false, error: `Ya existe el apartado ${nombre}.` }
        const meta = montoOpcional(args.goal)
        if (meta === false) return { ok: false, error: 'goal debe ser un monto.' }
        return {
          ok: true,
          payload: { nombre, metaMonto: meta ?? null },
          resumen: `Crear apartado de ahorro: ${nombre}${meta ? `\n• Meta: ${formatMXN(meta)}` : ''}`,
        }
      },
      async yaAplicada(payload) {
        const fila = await prisma.apartado.findFirst({ where: { nombre: payload.nombre } })
        return fila ? { mensaje: `El apartado ${payload.nombre} ya estaba creado (#${fila.id}).`, resultado: { id: fila.id } } : null
      },
      async ejecutar(payload, ctx) {
        const r = await dashboardApi.llamar('POST', '/api/apartados', { body: payload, actor: ctx.actor, userId: ctx.userId })
        return { mensaje: `Listo: creé el apartado ${payload.nombre}.`, resultado: { id: r?.id ?? null } }
      },
    },

    'apartado.editar': {
      async preparar(args) {
        const r = await buscar('apartado', args, 'el apartado')
        if (!r.ok) return r
        const a = r.valor
        const cambios = {}
        const renglones = []
        if (args.newName) {
          const n = texto(args.newName, 50)
          if (n && n !== a.nombre) { cambios.nombre = n; renglones.push(`• Nombre: ${a.nombre} → ${n}`) }
        }
        const meta = montoOpcional(args.goal)
        if (meta === false) return { ok: false, error: 'goal debe ser un monto o "ninguna".' }
        if (meta !== undefined && meta !== (a.metaMonto == null ? null : Number(a.metaMonto))) {
          cambios.metaMonto = meta
          renglones.push(`• Meta: ${a.metaMonto == null ? '—' : formatMXN(Number(a.metaMonto))} → ${meta == null ? '—' : formatMXN(meta)}`)
        }
        const activo = siNo(args.active)
        if (activo === null) return { ok: false, error: 'active debe ser true o false.' }
        if (activo !== undefined && activo !== a.activo) { cambios.activo = activo; renglones.push(`• ${activo ? 'Reactivar' : 'Desactivar'} (lo ahorrado no cambia)`) }
        if (!renglones.length) return { ok: false, error: 'No hay nada que cambiar: manda newName, goal o active.' }
        return {
          ok: true,
          payload: { id: a.id, cambios, antes: { nombre: a.nombre, activo: a.activo } },
          resumen: [`Editar apartado: ${a.nombre}`, ...renglones].join('\n'),
        }
      },
      yaAplicada: yaConCambios('apartado', 'El apartado', f => f.nombre),
      async ejecutar(payload, ctx) {
        const a = await verificar('apartado', payload.id, payload.antes, 'El apartado')
        await dashboardApi.llamar('PUT', `/api/apartados/${payload.id}`, { body: payload.cambios, actor: ctx.actor, userId: ctx.userId })
        return { mensaje: `Listo: actualicé el apartado ${payload.cambios.nombre || a.nombre}.`, resultado: { id: payload.id } }
      },
    },

    // ---- Deudas -------------------------------------------------------------------
    'deuda.crear': {
      async preparar(args) {
        const acreedor = texto(args.creditor, 100)
        if (!acreedor) return { ok: false, error: 'Falta a quién se le debe (creditor).' }
        const monto = parseMonto(args.amount)
        if (!monto) return { ok: false, error: 'Falta el monto de la deuda (mayor que cero).' }
        const abono = montoOpcional(args.monthlyPayment)
        if (abono === false) return { ok: false, error: 'monthlyPayment debe ser un monto.' }
        let fechaInicio = null
        if (args.startDate) {
          fechaInicio = parseFecha(args.startDate)
          if (!fechaInicio) return { ok: false, error: `No entendí la fecha "${args.startDate}". Usa YYYY-MM-DD.` }
        }
        const notas = args.notes ? String(args.notes).trim().slice(0, 300) : null
        const renglones = [`Registrar deuda con ${acreedor}: ${formatMXN(monto)}`]
        if (abono) renglones.push(`• Abono mensual: ${formatMXN(abono)}`)
        if (fechaInicio) renglones.push(`• Desde: ${fechaCorta(fechaInicio)}`)
        if (notas) renglones.push(`• Notas: ${notas}`)
        return { ok: true, payload: { acreedor, deudaOriginal: monto, abonoMensual: abono ?? null, fechaInicio, notas }, resumen: renglones.join('\n') }
      },
      async yaAplicada(payload, fila) {
        const existente = await prisma.deuda.findFirst({ where: { acreedor: payload.acreedor, deudaOriginal: payload.deudaOriginal, fechaRegistro: { gte: fila.createdAt } } })
        return existente ? { mensaje: `La deuda con ${payload.acreedor} ya estaba registrada (#${existente.id}).`, resultado: { id: existente.id } } : null
      },
      async ejecutar(payload, ctx) {
        const r = await dashboardApi.llamar('POST', '/api/deudas', { body: payload, actor: ctx.actor, userId: ctx.userId })
        return { mensaje: `Listo: registré la deuda con ${payload.acreedor} por ${formatMXN(payload.deudaOriginal)}.`, resultado: { id: r?.id ?? null } }
      },
    },

    'deuda.editar': {
      async preparar(args) {
        const r = await buscar('deuda', args, 'la deuda', 'acreedor')
        if (!r.ok) return r
        const d = r.valor
        const cambios = {}
        const renglones = []
        if (args.newCreditor) {
          const n = texto(args.newCreditor, 100)
          if (n && n !== d.acreedor) { cambios.acreedor = n; renglones.push(`• Acreedor: ${d.acreedor} → ${n}`) }
        }
        if (args.amount != null && args.amount !== '') {
          const m = parseMonto(args.amount)
          if (!m) return { ok: false, error: 'amount debe ser mayor que cero.' }
          if (m !== Number(d.deudaOriginal)) { cambios.deudaOriginal = m; renglones.push(`• Monto: ${formatMXN(Number(d.deudaOriginal))} → ${formatMXN(m)}`) }
        }
        const abono = montoOpcional(args.monthlyPayment)
        if (abono === false) return { ok: false, error: 'monthlyPayment debe ser un monto o "ninguno".' }
        if (abono !== undefined && abono !== (d.abonoMensual == null ? null : Number(d.abonoMensual))) {
          cambios.abonoMensual = abono
          renglones.push(`• Abono mensual: ${d.abonoMensual == null ? '—' : formatMXN(Number(d.abonoMensual))} → ${abono == null ? '—' : formatMXN(abono)}`)
        }
        if (args.notes !== undefined && args.notes !== '') { cambios.notas = String(args.notes).trim().slice(0, 300); renglones.push(`• Notas: ${cambios.notas}`) }
        const activo = siNo(args.active)
        if (activo === null) return { ok: false, error: 'active debe ser true o false.' }
        if (activo !== undefined && activo !== d.activo) { cambios.activo = activo; renglones.push(activo ? '• Reactivar la deuda' : '• Marcarla liquidada (deja de salir como activa; no se borra)') }
        if (!renglones.length) return { ok: false, error: 'No hay nada que cambiar: manda newCreditor, amount, monthlyPayment, notes o active.' }
        return {
          ok: true,
          payload: { id: d.id, cambios, antes: { acreedor: d.acreedor, activo: d.activo, deudaOriginal: Number(d.deudaOriginal) } },
          resumen: [`Editar deuda con ${d.acreedor}`, ...renglones].join('\n'),
        }
      },
      yaAplicada: yaConCambios('deuda', 'La deuda con', f => f.acreedor),
      async ejecutar(payload, ctx) {
        const d = await verificar('deuda', payload.id, payload.antes, 'La deuda')
        await dashboardApi.llamar('PUT', `/api/deudas/${payload.id}`, { body: payload.cambios, actor: ctx.actor, userId: ctx.userId })
        return { mensaje: `Listo: actualicé la deuda con ${payload.cambios.acreedor || d.acreedor}.`, resultado: { id: payload.id } }
      },
    },

    // ---- Creditos -----------------------------------------------------------------
    'credito.crear': {
      async preparar(args) {
        const nombre = texto(args.name, 100)
        if (!nombre) return { ok: false, error: 'Falta el nombre del crédito (p. ej. "Tarjeta Nu").' }
        const acreedor = texto(args.creditor, 100) || nombre
        const lista = await prisma.credito.findMany()
        if (lista.some(c => normalize(c.nombre) === normalize(nombre))) return { ok: false, error: `Ya existe el crédito ${nombre}.` }
        const tipo = args.type ? (ALIAS_CREDITO[normalize(String(args.type))] || TIPOS_CREDITO.find(t => normalize(t) === normalize(String(args.type)))) : 'Otro'
        if (!tipo) return { ok: false, error: `type debe ser uno de: ${TIPOS_CREDITO.join(', ')}.` }
        const limite = montoOpcional(args.limit)
        const pagoFijo = montoOpcional(args.fixedPayment)
        if (limite === false || pagoFijo === false) return { ok: false, error: 'limit y fixedPayment deben ser montos.' }
        const corte = dia(args.cutDay, 'cutDay')
        const pago = dia(args.payDay, 'payDay')
        if (!corte.ok) return corte
        if (!pago.ok) return pago
        let cuentaPagoId = null
        let cuentaNombre = null
        if (args.payAccount) {
          const cuentas = await prisma.cuenta.findMany({ where: { activo: true } })
          const rc = elegirPorNombre(cuentas, args.payAccount, 'cuenta')
          if (!rc.ok) return rc
          cuentaPagoId = rc.valor.id
          cuentaNombre = rc.valor.nombre
        }
        const payload = {
          nombre, acreedor, tipoCredito: tipo,
          limiteCredito: limite ?? null, montoPagoFijo: pagoFijo ?? null,
          diaCorte: corte.valor ?? null, diaPago: pago.valor ?? null,
          cuentaPagoId, notas: args.notes ? String(args.notes).trim().slice(0, 300) : null,
        }
        const renglones = [`Dar de alta crédito: ${nombre} (${tipo})`, `• Acreedor: ${acreedor}`]
        if (limite) renglones.push(`• Límite: ${formatMXN(limite)}`)
        if (pagoFijo) renglones.push(`• Pago fijo: ${formatMXN(pagoFijo)}`)
        if (corte.valor) renglones.push(`• Día de corte: ${corte.valor}`)
        if (pago.valor) renglones.push(`• Día de pago: ${pago.valor}`)
        if (cuentaNombre) renglones.push(`• Se paga desde: ${cuentaNombre}`)
        return { ok: true, payload, resumen: renglones.join('\n') }
      },
      async yaAplicada(payload) {
        const fila = await prisma.credito.findFirst({ where: { nombre: payload.nombre } })
        return fila ? { mensaje: `El crédito ${payload.nombre} ya estaba dado de alta (#${fila.id}).`, resultado: { id: fila.id } } : null
      },
      async ejecutar(payload, ctx) {
        const r = await dashboardApi.llamar('POST', '/api/creditos', { body: payload, actor: ctx.actor, userId: ctx.userId })
        return { mensaje: `Listo: di de alta el crédito ${payload.nombre}.`, resultado: { id: r?.id ?? null } }
      },
    },

    'credito.editar': {
      async preparar(args) {
        const r = await buscar('credito', args, 'el crédito')
        if (!r.ok) return r
        const c = r.valor
        const cambios = {}
        const renglones = []
        if (args.newName) {
          const n = texto(args.newName, 100)
          if (n && n !== c.nombre) { cambios.nombre = n; renglones.push(`• Nombre: ${c.nombre} → ${n}`) }
        }
        for (const [arg, campo, etiqueta] of [['limit', 'limiteCredito', 'Límite'], ['fixedPayment', 'montoPagoFijo', 'Pago fijo']]) {
          const m = montoOpcional(args[arg])
          if (m === false) return { ok: false, error: `${arg} debe ser un monto o "ninguno".` }
          if (m !== undefined && m !== (c[campo] == null ? null : Number(c[campo]))) {
            cambios[campo] = m
            renglones.push(`• ${etiqueta}: ${c[campo] == null ? '—' : formatMXN(Number(c[campo]))} → ${m == null ? '—' : formatMXN(m)}`)
          }
        }
        for (const [arg, campo, etiqueta] of [['cutDay', 'diaCorte', 'Día de corte'], ['payDay', 'diaPago', 'Día de pago']]) {
          const d = dia(args[arg], arg)
          if (!d.ok) return d
          if (d.valor !== undefined && d.valor !== c[campo]) { cambios[campo] = d.valor; renglones.push(`• ${etiqueta}: ${c[campo] ?? '—'} → ${d.valor}`) }
        }
        const activo = siNo(args.active)
        if (activo === null) return { ok: false, error: 'active debe ser true o false.' }
        if (activo !== undefined && activo !== c.activo) { cambios.activo = activo; renglones.push(activo ? '• Reactivar el crédito' : '• Archivarlo (deja de salir como activo; sus pagos se conservan)') }
        if (!renglones.length) return { ok: false, error: 'No hay nada que cambiar: manda newName, limit, fixedPayment, cutDay, payDay o active.' }
        return {
          ok: true,
          payload: { id: c.id, cambios, antes: { nombre: c.nombre, activo: c.activo } },
          resumen: [`Editar crédito: ${c.nombre}`, ...renglones].join('\n'),
        }
      },
      yaAplicada: yaConCambios('credito', 'El crédito', f => f.nombre),
      async ejecutar(payload, ctx) {
        const c = await verificar('credito', payload.id, payload.antes, 'El crédito')
        await dashboardApi.llamar('PUT', `/api/creditos/${payload.id}`, { body: payload.cambios, actor: ctx.actor, userId: ctx.userId })
        return { mensaje: `Listo: actualicé el crédito ${payload.cambios.nombre || c.nombre}.`, resultado: { id: payload.id } }
      },
    },

    // Compra a meses (o a un pago) con un credito: un movimiento Pendiente con
    // creditoId; la ruta crea un CreditoPago por mes en la quincena que cae
    // cada fecha. Aqui se validan esas fechas ANTES de proponer, para que el
    // resumen muestre exactamente los pagos que quedaran.
    'credito.compra': {
      async preparar(args) {
        const r = await buscar('credito', { id: args.creditId, name: args.credit }, 'el crédito')
        if (!r.ok) return r
        const credito = r.valor
        if (!credito.activo) return { ok: false, error: `El crédito ${credito.nombre} está archivado.` }
        const monto = parseMonto(args.amount)
        if (!monto) return { ok: false, error: 'Falta el monto total de la compra.' }
        const descripcion = texto(args.description, 200)
        if (!descripcion) return { ok: false, error: 'Falta qué se compró (description).' }
        if (!args.category) return { ok: false, error: 'Falta la categoría (list_categories).' }
        const cat = await resolverCategoria(args.category)
        if (!cat.ok) return cat
        const meses = args.installments == null || args.installments === '' ? 1 : Number.parseInt(args.installments, 10)
        if (!Number.isInteger(meses) || meses < 1 || meses > 48) return { ok: false, error: 'installments debe ser de 1 a 48 meses.' }

        const fecha = args.date ? parseFecha(args.date) : fechaMexico()
        if (!fecha) return { ok: false, error: `No entendí la fecha de compra "${args.date}".` }
        const quincena = await quincenaParaFecha(fecha)
        if (!quincena) return { ok: false, error: `No hay quincena dada de alta para el ${fecha}.` }

        // Primer pago: el que diga el usuario; si no, el dia de pago del
        // credito en el mes siguiente a la compra.
        let primerPago = args.firstPaymentDate ? parseFecha(args.firstPaymentDate) : null
        if (args.firstPaymentDate && !primerPago) return { ok: false, error: `No entendí la fecha del primer pago "${args.firstPaymentDate}".` }
        if (!primerPago) {
          if (!credito.diaPago) return { ok: false, error: `${credito.nombre} no tiene día de pago: pregunta la fecha del primer pago (firstPaymentDate).` }
          const d = dbDate(fecha)
          const y = d.getUTCFullYear()
          const m = d.getUTCMonth() + 1
          const ultimo = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
          primerPago = dateOnly(new Date(Date.UTC(y, m, Math.min(credito.diaPago, ultimo))))
        }

        // Mismas fechas y montos que calcula la ruta (addMonths + reparto con
        // el residuo en el ultimo pago); cada fecha necesita su quincena.
        const base = Math.floor((monto / meses) * 100) / 100
        const pagos = []
        let acumulado = 0
        for (let i = 0; i < meses; i++) {
          const d = dbDate(primerPago)
          const objetivo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + i, 1))
          const ultimo = new Date(Date.UTC(objetivo.getUTCFullYear(), objetivo.getUTCMonth() + 1, 0)).getUTCDate()
          objetivo.setUTCDate(Math.min(d.getUTCDate(), ultimo))
          const f = dateOnly(objetivo)
          const q = await quincenaParaFecha(f)
          if (!q) return { ok: false, error: `El pago ${i + 1} (${fechaCorta(f)}) cae en una fecha sin quincena dada de alta. Primero hay que crear esa quincena en el dashboard.` }
          const parte = i === meses - 1 ? Math.round((monto - acumulado) * 100) / 100 : base
          acumulado = Math.round((acumulado + parte) * 100) / 100
          pagos.push({ fecha: f, quincena: q.codigo, monto: parte })
        }

        const renglones = [
          `Compra con ${credito.nombre}: ${descripcion} — ${formatMXN(monto)}${meses > 1 ? ` a ${meses} meses` : ''}`,
          `• Fecha: ${fechaCorta(fecha)} (${quincena.codigo}) · ${cat.valor.nombre}`,
          `• Queda Pendiente; los pagos:`,
          ...pagos.slice(0, 6).map((p, i) => `  ${i + 1}. ${fechaCorta(p.fecha)} (${p.quincena}) — ${formatMXN(p.monto)}`),
        ]
        if (pagos.length > 6) renglones.push(`  … y ${pagos.length - 6} más`)

        return {
          ok: true,
          payload: {
            fecha, quincenaId: quincena.id, descripcion, categoriaId: cat.valor.id, tipo: cat.valor.tipo,
            monto, creditoId: credito.id, totalPagos: meses, fechaPagoProgramada: primerPago, estatus: 'Pendiente',
          },
          resumen: renglones.join('\n'),
        }
      },
      async yaAplicada(payload, fila) {
        const existente = await prisma.transaccion.findFirst({
          where: { creditoId: payload.creditoId, monto: payload.monto, descripcion: payload.descripcion, fechaRegistro: { gte: fila.createdAt } },
        })
        return existente ? { mensaje: `Esa compra ya estaba registrada (#${existente.id}).`, resultado: { transaccionId: existente.id } } : null
      },
      async ejecutar(payload, ctx) {
        const r = await dashboardApi.llamar('POST', '/api/transacciones', {
          body: { ...payload, source: ctx.canal === 'web' ? 'web-milo' : 'telegram' },
          actor: ctx.actor,
          userId: ctx.userId,
        })
        return { mensaje: `Listo: registré la compra ${payload.descripcion} con ${payload.totalPagos} pago(s).`, resultado: { transaccionId: r?.id ?? null } }
      },
    },
  }
}

module.exports = { crearTiposAhorroDeudas }
