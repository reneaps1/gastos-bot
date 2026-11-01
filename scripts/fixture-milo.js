// Datos de prueba para Milo: una quincena tipo Q38 armada para que el panel
// "¿Cuadra tu dinero?" del dashboard diga exactamente lo que dijo en
// produccion:
//
//   Te faltan $9,075.39 · $17,886.14 en cuentas − $26,961.53 por pagar
//   Según tu presupuesto: Falta $9,394.37 · Vas $318.98 mejor
//
// Trae los casos que mueven la cuenta: una linea cancelada (no cuenta nunca),
// una con parte pendiente de pago, una excedida, una sin nada registrado, un
// ahorro con un retiro (neteo por direccion), un gasto sin linea y un abono de
// credito. Q37 es la quincena anterior, para comparar periodos.
//
// Las fechas son relativas a "hoy" (hora de Mexico) para que Q38 sea siempre
// la quincena activa, corra el test el dia que corra.

const { fechaMexico } = require('../src/financeUtils')

function dia(iso) {
  return new Date(`${iso}T00:00:00.000Z`)
}

function mover(iso, dias) {
  const d = dia(iso)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

function datosMilo({ hoy = fechaMexico() } = {}) {
  const inicio38 = mover(hoy, -1)
  const fin38 = mover(hoy, 11)
  const inicio37 = mover(hoy, -16)
  const fin37 = mover(hoy, -2)

  const quincena = [
    { id: 37, codigo: 'Q37', tipo: 'QUINCENAL', fechaInicio: dia(inicio37), fechaFin: dia(fin37), fechaCierre: null },
    { id: 38, codigo: 'Q38', tipo: 'QUINCENAL', fechaInicio: dia(inicio38), fechaFin: dia(fin38), fechaCierre: null },
    { id: 39, codigo: 'Q39', tipo: 'QUINCENAL', fechaInicio: dia(mover(fin38, 1)), fechaFin: dia(mover(fin38, 14)), fechaCierre: null },
  ]

  const categoria = [
    { id: 1, nombre: 'Hogar', tipo: 'Gasto', activo: true, cuentaParaLimite: true, clasificacion: 'Fijo', ejemplos: null },
    { id: 2, nombre: 'Familia', tipo: 'Gasto', activo: true, cuentaParaLimite: true, clasificacion: 'Variable', ejemplos: null },
    { id: 3, nombre: 'Transporte', tipo: 'Gasto', activo: true, cuentaParaLimite: true, clasificacion: 'Variable', ejemplos: null },
    { id: 4, nombre: 'Personal', tipo: 'Gasto', activo: true, cuentaParaLimite: true, clasificacion: 'Variable', ejemplos: null },
    { id: 8, nombre: 'Ingresos', tipo: 'Ingreso', activo: true, cuentaParaLimite: false, clasificacion: null, ejemplos: null },
    { id: 9, nombre: 'Ahorro', tipo: 'Ahorro', activo: true, cuentaParaLimite: false, clasificacion: null, ejemplos: null },
  ]

  const linea = (id, quincenaId, categoriaId, descripcion, monto, extra = {}) => ({
    id, quincenaId, categoriaId, descripcion,
    tipo: categoria.find(c => c.id === categoriaId).tipo,
    montoPresupuestado: monto, montoRevisado: null, estadoLinea: 'Abierta',
    recurrente: false, diaCobro: null, fechaVencimiento: null, clasificacion: null, ...extra,
  })

  const presupuesto = [
    linea(101, 38, 8, 'Sueldo', 27611.13),
    linea(102, 38, 1, 'Renta', 12000, { fechaVencimiento: dia(mover(hoy, 3)) }),
    linea(103, 38, 2, 'Super', 8000),
    // Original 1200, Modificado 1500: la cuenta usa el efectivo (1500).
    linea(104, 38, 3, 'Gasolina', 1200, { montoRevisado: 1500 }),
    linea(105, 38, 1, 'Tarjeta de credito', 14961.53, { fechaVencimiento: dia(mover(hoy, -1)) }),
    linea(106, 38, 4, 'Cine cancelado', 900, { estadoLinea: 'Cancelada' }),
    linea(107, 38, 9, 'Ahorro viaje', 200),
    // Q37: la anterior, ya ejercida
    linea(201, 37, 8, 'Sueldo', 26000),
    linea(202, 37, 1, 'Renta', 12000),
    linea(203, 37, 2, 'Super', 7000),
  ]

  let id = 1
  const tx = (quincenaId, tipo, categoriaId, descripcion, monto, extra = {}) => ({
    id: id++, quincenaId, quincenaConsumoId: quincenaId, tipo, categoriaId, descripcion, monto,
    estatus: 'Pagado', direccion: null, presupuestoId: null, creditoId: null, userId: null,
    metodoPagoId: null, apartadoId: null, fecha: dia(hoy), source: 'telegram', ...extra,
  })

  const transaccion = [
    tx(38, 'Ingreso', 8, 'Nomina', 27611.13, { presupuestoId: 101 }),
    tx(38, 'Gasto', 1, 'Renta parcial', 6000, { presupuestoId: 102 }),
    tx(38, 'Gasto', 2, 'Super semana 1', 2000, { presupuestoId: 103 }),
    tx(38, 'Gasto', 2, 'Super semana 2', 500, { presupuestoId: 103, estatus: 'Pendiente' }),
    tx(38, 'Gasto', 3, 'Gasolina', 1813, { presupuestoId: 104 }),
    tx(38, 'Gasto', 4, 'Lamparas', 30.97),
    tx(38, 'Ahorro', 9, 'Aporte viaje', 500, { presupuestoId: 107, direccion: 'Aporte' }),
    tx(38, 'Ahorro', 9, 'Retiro viaje', 300, { presupuestoId: 107, direccion: 'Retiro' }),
    tx(37, 'Ingreso', 8, 'Nomina', 26000, { presupuestoId: 201, fecha: dia(inicio37) }),
    tx(37, 'Gasto', 1, 'Renta', 12000, { presupuestoId: 202, fecha: dia(inicio37) }),
    tx(37, 'Gasto', 2, 'Super', 7400, { presupuestoId: 203, fecha: dia(inicio37) }),
    tx(37, 'Gasto', 4, 'Cena', 850, { fecha: dia(inicio37) }),
  ]

  const cuenta = [
    { id: 1, nombre: 'BBVA', tipo: 'Debito', activo: true, orden: 1 },
    { id: 2, nombre: 'Efectivo', tipo: 'Efectivo', activo: true, orden: 2 },
  ]

  const liquidezSnapshot = [
    {
      id: 1, quincenaId: 38, fechaCorte: new Date(`${hoy}T15:00:00.000Z`), fechaRegistro: new Date(`${hoy}T15:00:00.000Z`),
      faltaPagar: 99999, pagosQuincena: 0, gastosReales: null, gastosPronosticados: null, teorico: null, validado: false,
      montos: [
        { cuentaId: 1, monto: 10000, nota: null, cuenta: cuenta[0] },
        { cuentaId: 2, monto: 7886.14, nota: null, cuenta: cuenta[1] },
      ],
    },
    // Dos cortes que NO deben ganar, para que la prueba de paridad vea cual
    // elige cada lado (fechaCorte desc, fechaRegistro desc, id desc):
    //   - id 2: mismo fechaCorte pero registrado ANTES; con id mayor, asi que
    //     si alguien quita fechaRegistro del orden, gana el y truena.
    //   - id 3: corte de AYER registrado DESPUES; si alguien ordena por
    //     fechaRegistro primero, gana el y truena.
    {
      id: 2, quincenaId: 38, fechaCorte: new Date(`${hoy}T15:00:00.000Z`), fechaRegistro: new Date(`${hoy}T09:00:00.000Z`),
      faltaPagar: 0, pagosQuincena: 0, gastosReales: null, gastosPronosticados: null, teorico: null, validado: false,
      montos: [{ cuentaId: 1, monto: 1111.11, nota: null, cuenta: cuenta[0] }],
    },
    {
      id: 3, quincenaId: 38, fechaCorte: new Date(`${mover(hoy, -1)}T15:00:00.000Z`), fechaRegistro: new Date(`${hoy}T20:00:00.000Z`),
      faltaPagar: 0, pagosQuincena: 0, gastosReales: null, gastosPronosticados: null, teorico: null, validado: false,
      montos: [{ cuentaId: 1, monto: 2222.22, nota: null, cuenta: cuenta[0] }],
    },
  ]

  const credito = [{ id: 1, nombre: 'Coppel', acreedor: 'Coppel', activo: true, tipoCredito: 'Otro' }]
  const creditoPago = [
    { id: 1, creditoId: 1, quincenaId: 38, categoriaId: 1, presupuestoId: null, fechaPagoProgramada: dia(mover(hoy, 5)), montoTotal: 650, estatus: 'Pendiente', numeroPago: 3, totalPagos: 12 },
  ]

  return {
    hoy,
    tablas: { quincena, categoria, presupuesto, transaccion, cuenta, liquidezSnapshot, credito, creditoPago },
    esperado: { real: -9075.39, enCuentas: 17886.14, porPagar: 26961.53, teorico: -9394.37, delta: 318.98 },
  }
}

module.exports = { datosMilo, dia, mover }
