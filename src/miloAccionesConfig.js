// Acciones de CONFIGURACION que Milo propone y el usuario confirma con un boton
// (Fase B4, 2026-11-16): cuentas, categorias, referencias de una quincena,
// usuarios y formas de pago. Rene le pidio a Milo "crea una cuenta" y no
// pudo: estas son las pantallas de Configuracion, ahora por chat.
//
// Mismo contrato que src/miloAcciones.js (preparar / ejecutar / yaAplicada) y
// por las mismas rutas del dashboard que usan esas pantallas.
//
// Lo que NO se ofrece a proposito:
//   - Cambiar el TIPO de una categoria (Gasto/Ingreso/Ahorro): la ruta no
//     actualiza los movimientos ni las lineas que ya la usan y los totales se
//     descuadran. Eso se queda en el dashboard (Admin de categorias).
//   - Cambiar fechas o codigo de una quincena: mueve que movimientos caen en
//     cada periodo. Se queda en Configuracion > Quincenas.
//   - La contraseña y el login.

function crearTiposConfig(h) {
  const { prisma, dashboardApi, formatMXN, parseMonto, parseId, normalize, elegirPorNombre } = h
  const resolvePeriod = periodo => require('./miloTools').resolvePeriod(periodo)

  const TIPOS_CUENTA = ['Debito', 'Credito', 'Efectivo', 'Vales', 'Inversion', 'Otro']
  const TIPOS_CATEGORIA = ['Gasto', 'Ingreso', 'Ahorro']

  function opcion(valor, opciones) {
    if (valor == null || valor === '') return undefined
    const t = normalize(String(valor))
    // "débito" -> Debito, "inversión" -> Inversion; "tarjeta de credito" -> Credito.
    return opciones.find(o => normalize(o) === t) ||
      opciones.find(o => t.includes(normalize(o))) || null
  }

  function siNo(valor) {
    if (valor == null || valor === '') return undefined
    if (typeof valor === 'boolean') return valor
    const t = normalize(String(valor))
    if (['true', 'si', 'sí', '1', 'activa', 'activo', 'activar'].includes(t)) return true
    if (['false', 'no', '0', 'inactiva', 'inactivo', 'desactivar', 'desactivada'].includes(t)) return false
    return null
  }

  const nombreLimpio = (valor, max = 50) => String(valor ?? '').trim().replace(/\s+/g, ' ').slice(0, max)

  // Busca por id o por nombre en toda la tabla (incluye inactivas: reactivar
  // una cuenta es un caso real).
  async function buscar(modelo, args, etiqueta, campoNombre = 'name') {
    const id = parseId(args.id)
    if (id) {
      const fila = await prisma[modelo].findUnique({ where: { id } })
      return fila ? { ok: true, valor: fila } : { ok: false, error: `No existe la ${etiqueta} #${id}.` }
    }
    if (!args[campoNombre]) return { ok: false, error: `Falta cuál ${etiqueta}: manda id o ${campoNombre}.` }
    const lista = await prisma[modelo].findMany({ orderBy: { id: 'asc' } })
    return elegirPorNombre(lista, args[campoNombre], etiqueta)
  }

  async function nombreLibre(modelo, nombre, excepto = null) {
    const lista = await prisma[modelo].findMany({ orderBy: { id: 'asc' } })
    return !lista.some(x => normalize(x.nombre) === normalize(nombre) && x.id !== excepto)
  }

  // yaAplicada generica para las altas: existe una con ese nombre exacto.
  function yaCreada(modelo, etiqueta) {
    return async payload => {
      const fila = await prisma[modelo].findFirst({ where: { nombre: payload.nombre } })
      return fila ? { mensaje: `La ${etiqueta} ${payload.nombre} ya estaba creada (#${fila.id}).`, resultado: { id: fila.id } } : null
    }
  }

  // Ejecutar una edicion: si el registro cambio desde la propuesta, no se aplica.
  async function verificar(modelo, id, antes, etiqueta) {
    const fila = await prisma[modelo].findUnique({ where: { id } })
    if (!fila) throw new Error(`La ${etiqueta} #${id} ya no existe.`)
    for (const [k, v] of Object.entries(antes)) {
      const actual = fila[k] == null ? null : (typeof v === 'number' ? Number(fila[k]) : fila[k])
      if (actual !== v) throw new Error(`La ${etiqueta} cambió desde que te lo propuse. Pídemelo otra vez.`)
    }
    return fila
  }

  const marca = activo => (activo ? 'activa' : 'inactiva')

  return {
    // ---- Cuentas ----------------------------------------------------------------
    'cuenta.crear': {
      async preparar(args) {
        const nombre = nombreLimpio(args.name)
        if (!nombre) return { ok: false, error: 'Falta el nombre de la cuenta.' }
        if (!(await nombreLibre('cuenta', nombre))) return { ok: false, error: `Ya existe una cuenta llamada ${nombre}.` }
        const tipo = opcion(args.type, TIPOS_CUENTA)
        if (tipo === null) return { ok: false, error: `type debe ser uno de: ${TIPOS_CUENTA.join(', ')}.` }
        const ultimas = await prisma.cuenta.findMany({ orderBy: { orden: 'desc' }, take: 1 })
        const orden = (ultimas[0]?.orden ?? 0) + 1
        return {
          ok: true,
          payload: { nombre, tipo: tipo || null, orden },
          resumen: `Crear cuenta: ${nombre}\n• Tipo: ${tipo || 'sin tipo'}\n• Aparecerá en los cortes de liquidez`,
        }
      },
      yaAplicada: yaCreada('cuenta', 'cuenta'),
      async ejecutar(payload, ctx) {
        const r = await dashboardApi.llamar('POST', '/api/cuentas', { body: payload, actor: ctx.actor, userId: ctx.userId })
        return { mensaje: `Listo: creé la cuenta ${payload.nombre}.`, resultado: { id: r?.id ?? null } }
      },
    },

    'cuenta.editar': {
      async preparar(args) {
        const r = await buscar('cuenta', args, 'cuenta')
        if (!r.ok) return r
        const cuenta = r.valor
        const cambios = {}
        const renglones = []
        if (args.newName) {
          const n = nombreLimpio(args.newName)
          if (n && n !== cuenta.nombre) {
            if (!(await nombreLibre('cuenta', n, cuenta.id))) return { ok: false, error: `Ya existe una cuenta llamada ${n}.` }
            cambios.nombre = n
            renglones.push(`• Nombre: ${cuenta.nombre} → ${n}`)
          }
        }
        if (args.type !== undefined && args.type !== '') {
          const t = opcion(args.type, TIPOS_CUENTA)
          if (!t) return { ok: false, error: `type debe ser uno de: ${TIPOS_CUENTA.join(', ')}.` }
          if (t !== cuenta.tipo) { cambios.tipo = t; renglones.push(`• Tipo: ${cuenta.tipo || '—'} → ${t}`) }
        }
        const activo = siNo(args.active)
        if (activo === null) return { ok: false, error: 'active debe ser true o false.' }
        if (activo !== undefined && activo !== cuenta.activo) {
          cambios.activo = activo
          renglones.push(`• Estado: ${marca(cuenta.activo)} → ${marca(activo)}${activo ? '' : ' (deja de salir en los cortes nuevos; los viejos no cambian)'}`)
        }
        if (!renglones.length) return { ok: false, error: 'No hay nada que cambiar: manda newName, type o active.' }
        return {
          ok: true,
          payload: { id: cuenta.id, cambios, antes: { nombre: cuenta.nombre, tipo: cuenta.tipo ?? null, activo: cuenta.activo } },
          resumen: [`Editar cuenta: ${cuenta.nombre}`, ...renglones].join('\n'),
        }
      },
      async yaAplicada(payload) {
        const fila = await prisma.cuenta.findUnique({ where: { id: payload.id } })
        if (!fila) return null
        const listo = Object.entries(payload.cambios).every(([k, v]) => fila[k] === v)
        return listo ? { mensaje: `La cuenta ${fila.nombre} ya tenía ese cambio.`, resultado: { id: fila.id } } : null
      },
      async ejecutar(payload, ctx) {
        const cuenta = await verificar('cuenta', payload.id, payload.antes, 'cuenta')
        await dashboardApi.llamar('PUT', `/api/cuentas/${payload.id}`, { body: payload.cambios, actor: ctx.actor, userId: ctx.userId })
        return { mensaje: `Listo: actualicé la cuenta ${payload.cambios.nombre || cuenta.nombre}.`, resultado: { id: payload.id } }
      },
    },

    'cuenta.borrar': {
      async preparar(args) {
        const r = await buscar('cuenta', args, 'cuenta')
        if (!r.ok) return r
        const cuenta = r.valor
        // Misma regla que la ruta: con creditos o cortes no se borra (se perderia
        // la historia); se desactiva.
        const [creditos, cortes] = await Promise.all([
          prisma.credito.count({ where: { cuentaPagoId: cuenta.id } }),
          prisma.liquidezSnapshotCuenta.count({ where: { cuentaId: cuenta.id } }),
        ])
        if (creditos > 0 || cortes > 0) {
          return { ok: false, error: `${cuenta.nombre} aparece en ${cortes} corte(s) y ${creditos} crédito(s): no se puede borrar. Ofrece desactivarla con proponer_editar_cuenta (active=false).` }
        }
        return {
          ok: true,
          payload: { id: cuenta.id, nombre: cuenta.nombre },
          resumen: `Borrar cuenta: ${cuenta.nombre}\n• No tiene cortes ni créditos\n\nNo se puede deshacer.`,
        }
      },
      async yaAplicada(payload) {
        const fila = await prisma.cuenta.findUnique({ where: { id: payload.id } })
        return fila ? null : { mensaje: `La cuenta ${payload.nombre} ya estaba borrada.`, resultado: { id: payload.id } }
      },
      async ejecutar(payload, ctx) {
        await dashboardApi.llamar('DELETE', `/api/cuentas/${payload.id}`, { actor: ctx.actor, userId: ctx.userId })
        return { mensaje: `Listo: borré la cuenta ${payload.nombre}.`, resultado: { id: payload.id } }
      },
    },

    // ---- Categorias -------------------------------------------------------------
    'categoria.crear': {
      async preparar(args) {
        const nombre = nombreLimpio(args.name)
        if (!nombre) return { ok: false, error: 'Falta el nombre de la categoría.' }
        if (!(await nombreLibre('categoria', nombre))) return { ok: false, error: `Ya existe una categoría llamada ${nombre}.` }
        const tipo = opcion(args.type, TIPOS_CATEGORIA)
        if (!tipo) return { ok: false, error: `type es requerido: ${TIPOS_CATEGORIA.join(', ')}.` }
        const clasificacion = opcion(args.classification, ['Fijo', 'Variable'])
        if (clasificacion === null) return { ok: false, error: 'classification debe ser Fijo o Variable.' }
        const ejemplos = args.examples ? String(args.examples).trim().slice(0, 300) : null
        const renglones = [`Crear categoría: ${nombre}`, `• Tipo: ${tipo}`]
        if (clasificacion) renglones.push(`• Clasificación: ${clasificacion}`)
        if (ejemplos) renglones.push(`• Ejemplos: ${ejemplos}`)
        return { ok: true, payload: { nombre, tipo, clasificacion: clasificacion || null, ejemplos }, resumen: renglones.join('\n') }
      },
      yaAplicada: yaCreada('categoria', 'categoría'),
      async ejecutar(payload, ctx) {
        const r = await dashboardApi.llamar('POST', '/api/categorias', { body: payload, actor: ctx.actor, userId: ctx.userId })
        return { mensaje: `Listo: creé la categoría ${payload.nombre}.`, resultado: { id: r?.id ?? null } }
      },
    },

    'categoria.editar': {
      async preparar(args) {
        if (args.type) {
          return { ok: false, error: 'El tipo de una categoría no se cambia desde aquí: los movimientos y líneas que ya la usan no se actualizarían. Eso va en el dashboard (Admin de categorías).' }
        }
        const r = await buscar('categoria', args, 'categoría')
        if (!r.ok) return r
        const cat = r.valor
        const cambios = {}
        const renglones = []
        if (args.newName) {
          const n = nombreLimpio(args.newName)
          if (n && n !== cat.nombre) {
            if (!(await nombreLibre('categoria', n, cat.id))) return { ok: false, error: `Ya existe una categoría llamada ${n}.` }
            cambios.nombre = n
            renglones.push(`• Nombre: ${cat.nombre} → ${n}`)
          }
        }
        if (args.classification !== undefined && args.classification !== '') {
          const sin = ['ninguna', 'sin', 'none', 'null'].includes(normalize(String(args.classification)))
          const c = sin ? null : opcion(args.classification, ['Fijo', 'Variable'])
          if (c === undefined || (!sin && !c)) return { ok: false, error: 'classification debe ser Fijo, Variable o ninguna.' }
          if (c !== (cat.clasificacion ?? null)) { cambios.clasificacion = c; renglones.push(`• Clasificación: ${cat.clasificacion || '—'} → ${c || '—'}`) }
        }
        if (args.examples !== undefined && args.examples !== '') {
          cambios.ejemplos = String(args.examples).trim().slice(0, 300)
          renglones.push(`• Ejemplos: ${cambios.ejemplos}`)
        }
        const activo = siNo(args.active)
        if (activo === null) return { ok: false, error: 'active debe ser true o false.' }
        if (activo !== undefined && activo !== cat.activo) {
          cambios.activo = activo
          renglones.push(`• Estado: ${marca(cat.activo)} → ${marca(activo)}${activo ? '' : ' (no se ofrece para movimientos nuevos; lo registrado no cambia)'}`)
        }
        const limite = siNo(args.countsForLimit)
        if (limite === null) return { ok: false, error: 'countsForLimit debe ser true o false.' }
        if (limite !== undefined && limite !== cat.cuentaParaLimite) {
          cambios.cuentaParaLimite = limite
          renglones.push(`• Cuenta para el límite de gasto: ${cat.cuentaParaLimite ? 'sí' : 'no'} → ${limite ? 'sí' : 'no'}`)
        }
        if (!renglones.length) return { ok: false, error: 'No hay nada que cambiar: manda newName, classification, examples, active o countsForLimit.' }
        return {
          ok: true,
          payload: { id: cat.id, cambios, antes: { nombre: cat.nombre, activo: cat.activo, clasificacion: cat.clasificacion ?? null } },
          resumen: [`Editar categoría: ${cat.nombre} (${cat.tipo})`, ...renglones].join('\n'),
        }
      },
      async yaAplicada(payload) {
        const fila = await prisma.categoria.findUnique({ where: { id: payload.id } })
        if (!fila) return null
        const listo = Object.entries(payload.cambios).every(([k, v]) => (fila[k] ?? null) === v)
        return listo ? { mensaje: `La categoría ${fila.nombre} ya tenía ese cambio.`, resultado: { id: fila.id } } : null
      },
      async ejecutar(payload, ctx) {
        const cat = await verificar('categoria', payload.id, payload.antes, 'categoría')
        await dashboardApi.llamar('PUT', `/api/categorias/${payload.id}`, { body: payload.cambios, actor: ctx.actor, userId: ctx.userId })
        return { mensaje: `Listo: actualicé la categoría ${payload.cambios.nombre || cat.nombre}.`, resultado: { id: payload.id } }
      },
    },

    // ---- Referencias de una quincena ----------------------------------------------
    'quincena.referencias': {
      async preparar(args) {
        const q = await resolvePeriod(args.period || 'actual')
        if (!q) return { ok: false, error: `No encontré la quincena ${args.period || 'actual'}.` }
        const fila = await prisma.quincena.findUnique({ where: { id: q.id } })
        const cambios = {}
        const renglones = []
        const leer = (valor, campo, etiqueta) => {
          if (valor === undefined || valor === '') return true
          const sin = ['ninguna', 'ninguno', 'sin', 'none', 'null', 'quitar'].includes(normalize(String(valor)))
          const n = sin ? null : parseMonto(valor)
          if (!sin && n == null) return false
          const antes = fila[campo] == null ? null : Number(fila[campo])
          if (antes !== n) {
            cambios[campo] = n
            renglones.push(`• ${etiqueta}: ${antes == null ? 'sin referencia' : formatMXN(antes)} → ${n == null ? 'sin referencia (usa la general)' : formatMXN(n)}`)
          }
          return true
        }
        if (!leer(args.income, 'ingresoReferencia', 'Ingreso de referencia')) return { ok: false, error: 'income debe ser un monto, o "ninguna" para quitarla.' }
        if (!leer(args.spendingLimit, 'limiteGastoReferencia', 'Límite de gasto')) return { ok: false, error: 'spendingLimit debe ser un monto, o "ninguna" para quitarla.' }
        if (!renglones.length) return { ok: false, error: 'No hay nada que cambiar: manda income o spendingLimit.' }
        return {
          ok: true,
          payload: { id: fila.id, codigo: fila.codigo, cambios, antes: { ingresoReferencia: fila.ingresoReferencia == null ? null : Number(fila.ingresoReferencia), limiteGastoReferencia: fila.limiteGastoReferencia == null ? null : Number(fila.limiteGastoReferencia) } },
          resumen: [`Referencias de ${fila.codigo}`, ...renglones].join('\n'),
        }
      },
      async yaAplicada(payload) {
        const fila = await prisma.quincena.findUnique({ where: { id: payload.id } })
        if (!fila) return null
        const listo = Object.entries(payload.cambios).every(([k, v]) => (fila[k] == null ? null : Number(fila[k])) === v)
        return listo ? { mensaje: `${fila.codigo} ya tenía esas referencias.`, resultado: { id: fila.id } } : null
      },
      async ejecutar(payload, ctx) {
        await verificar('quincena', payload.id, payload.antes, 'quincena')
        // Solo las referencias: sin fechas ni codigo, la ruta no toca nada mas.
        await dashboardApi.llamar('PUT', `/api/quincenas/${payload.id}`, { body: payload.cambios, actor: ctx.actor, userId: ctx.userId })
        return { mensaje: `Listo: actualicé las referencias de ${payload.codigo}.`, resultado: { id: payload.id } }
      },
    },

    // ---- Usuarios -----------------------------------------------------------------
    'usuario.crear': {
      async preparar(args) {
        const nombre = nombreLimpio(args.name)
        if (!nombre) return { ok: false, error: 'Falta el nombre de la persona.' }
        if (!(await nombreLibre('user', nombre))) return { ok: false, error: `Ya existe una persona llamada ${nombre}.` }
        const telefono = args.phone ? String(args.phone).replace(/[^\d+]/g, '').slice(0, 20) : null
        return {
          ok: true,
          payload: { nombre, phoneWhatsapp: telefono },
          resumen: `Dar de alta a: ${nombre}${telefono ? `\n• WhatsApp: ${telefono}` : ''}\n• Aparecerá como persona en los movimientos (no es un acceso al dashboard)`,
        }
      },
      yaAplicada: yaCreada('user', 'persona'),
      async ejecutar(payload, ctx) {
        const r = await dashboardApi.llamar('POST', '/api/users', { body: payload, actor: ctx.actor, userId: ctx.userId })
        return { mensaje: `Listo: di de alta a ${payload.nombre}.`, resultado: { id: r?.id ?? null } }
      },
    },

    'usuario.editar': {
      async preparar(args) {
        const r = await buscar('user', args, 'persona')
        if (!r.ok) return r
        const u = r.valor
        const cambios = {}
        const renglones = []
        if (args.newName) {
          const n = nombreLimpio(args.newName)
          if (n && n !== u.nombre) {
            if (!(await nombreLibre('user', n, u.id))) return { ok: false, error: `Ya existe una persona llamada ${n}.` }
            cambios.nombre = n
            renglones.push(`• Nombre: ${u.nombre} → ${n}`)
          }
        }
        if (args.phone !== undefined && args.phone !== '') {
          const t = String(args.phone).replace(/[^\d+]/g, '').slice(0, 20) || null
          if (t !== (u.phoneWhatsapp ?? null)) { cambios.phoneWhatsapp = t; renglones.push(`• WhatsApp: ${u.phoneWhatsapp || '—'} → ${t || '—'}`) }
        }
        const activo = siNo(args.active)
        if (activo === null) return { ok: false, error: 'active debe ser true o false.' }
        if (activo !== undefined && activo !== u.activo) { cambios.activo = activo; renglones.push(`• Estado: ${activo ? 'activa' : 'inactiva'}`) }
        if (!renglones.length) return { ok: false, error: 'No hay nada que cambiar: manda newName, phone o active.' }
        return {
          ok: true,
          payload: { id: u.id, cambios, antes: { nombre: u.nombre, activo: u.activo } },
          resumen: [`Editar persona: ${u.nombre}`, ...renglones].join('\n'),
        }
      },
      async yaAplicada(payload) {
        const fila = await prisma.user.findUnique({ where: { id: payload.id } })
        if (!fila) return null
        const listo = Object.entries(payload.cambios).every(([k, v]) => (fila[k] ?? null) === v)
        return listo ? { mensaje: `${fila.nombre} ya tenía ese cambio.`, resultado: { id: fila.id } } : null
      },
      async ejecutar(payload, ctx) {
        const u = await verificar('user', payload.id, payload.antes, 'persona')
        await dashboardApi.llamar('PUT', `/api/users/${payload.id}`, { body: payload.cambios, actor: ctx.actor, userId: ctx.userId })
        return { mensaje: `Listo: actualicé a ${payload.cambios.nombre || u.nombre}.`, resultado: { id: payload.id } }
      },
    },

    // ---- Formas de pago -----------------------------------------------------------
    'metodo_pago.crear': {
      async preparar(args) {
        const nombre = nombreLimpio(args.name)
        if (!nombre) return { ok: false, error: 'Falta el nombre de la forma de pago.' }
        if (!(await nombreLibre('metodoPago', nombre))) return { ok: false, error: `Ya existe la forma de pago ${nombre}.` }
        return { ok: true, payload: { nombre }, resumen: `Crear forma de pago: ${nombre}` }
      },
      yaAplicada: yaCreada('metodoPago', 'forma de pago'),
      async ejecutar(payload, ctx) {
        const r = await dashboardApi.llamar('POST', '/api/metodos-pago', { body: payload, actor: ctx.actor, userId: ctx.userId })
        return { mensaje: `Listo: creé la forma de pago ${payload.nombre}.`, resultado: { id: r?.id ?? null } }
      },
    },
  }
}

module.exports = { crearTiposConfig }
