'use client'

import { useCallback, useEffect, useState } from 'react'
import { cuentaParaAgregados, quincenasPendientesDeCierre, type GrupoCierre } from '@/lib/cierre-quincena'
import { normalizeMontos, sumLiquidez } from '@/lib/liquidez'
import {
  calcularCuadre,
  calcularFaltaPorPagar,
  calcularLibreDeQuincena,
  type Cuadre,
} from '@/lib/presupuesto-totales'

// Datos del Inicio ("de un vistazo"). Hace los mismos fetch que ya hace
// Presupuesto > Tabla para una quincena y pasa todo por las mismas funciones
// (calcularCuadre, calcularFaltaPorPagar...), asi que ningun numero del
// Inicio puede contradecir a Tabla.
//
// Fetches: presupuestos de la Q, transacciones de la Q con limit=5 (los
// totales del servidor no dependen de `limit`, asi que un solo fetch sirve
// para los totales y para "Actividad reciente"), liquidez de la Q y los
// movimientos sin partida (asignado=no, solo conteo y monto). Despues de
// pintar el veredicto, uno diferido: todos los presupuestos, para las
// quincenas que siguen sin cerrar.

export interface ResumenPresupuesto {
  id: number
  descripcion: string
  montoEfectivo: number
  real: number
  pendiente: number
  pct: number
  excedido: number
  estadoLinea: string
  categoria: { nombre: string; tipo: string }
}

export interface ResumenTransaccion {
  id: number
  fecha: string
  descripcion: string
  tipo: string
  monto: number | string
  estatus: string
  presupuestoId: number | null
  categoria: { nombre: string }
}

export interface ResumenQuincena {
  presupuestos: ResumenPresupuesto[]
  transacciones: ResumenTransaccion[]
  // null = no hay corte de liquidez para la quincena.
  liquidez: { total: number; fechaCorte: string | null } | null
  corteDias: number | null
  cuadre: Cuadre | null
  // "Segun tu presupuesto": respaldo del veredicto cuando no hay corte.
  teorico: number
  ingresoReal: number
  ingresoPresupuestado: number
  gastoReal: number
  gastoPresupuestado: number
  gastoFaltaPorPagar: number
  balancePresupuestado: number
  sinPartida: { cantidad: number; monto: number }
}

interface Crudo {
  presupuestos: ResumenPresupuesto[]
  transacciones: ResumenTransaccion[]
  ingresosTotales: number
  gastoTotal: number
  liquidez: { total: number; fechaCorte: string | null } | null
  sinPartida: { cantidad: number; monto: number }
}

// Dias completos entre dos fechas YYYY-MM-DD (o ISO), nunca negativo.
export function diasEntre(desde: string, hasta: string): number {
  const aUtc = (v: string) => {
    const [y, m, d] = v.split('T')[0].split('-').map(Number)
    return Date.UTC(y, m - 1, d)
  }
  return Math.max(Math.floor((aUtc(hasta) - aUtc(desde)) / 86_400_000), 0)
}

async function json(url: string) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} -> ${res.status}`)
  return res.json()
}

// Para las llamadas secundarias: si fallan, se tratan como "no hay dato" en
// vez de tumbar todo el Inicio. Asi se comporta Presupuesto > Tabla, y las
// dos pantallas no deben discrepar sobre si hay algo que mostrar.
function jsonOpcional(url: string) {
  return json(url).catch(() => null)
}

function resumir(c: Crudo, today: string): ResumenQuincena {
  const entrada = {
    ingresosTotales: c.ingresosTotales,
    gastoTotal: c.gastoTotal,
    presupuestos: c.presupuestos,
  }
  const ingresoLineas = c.presupuestos.filter(p => p.categoria.tipo === 'Ingreso' && cuentaParaAgregados(p))
  const gastoLineas = c.presupuestos.filter(p => p.categoria.tipo === 'Gasto' && cuentaParaAgregados(p))
  const ingresoPresupuestado = ingresoLineas.reduce((s, p) => s + p.montoEfectivo, 0)
  const gastoPresupuestado = gastoLineas.reduce((s, p) => s + p.montoEfectivo, 0)
  const fechaCorte = c.liquidez?.fechaCorte ?? null
  return {
    presupuestos: c.presupuestos,
    transacciones: c.transacciones,
    liquidez: c.liquidez,
    corteDias: fechaCorte ? diasEntre(fechaCorte, today) : null,
    cuadre: calcularCuadre({ ...entrada, liquidezTotal: c.liquidez ? c.liquidez.total : null }),
    teorico: calcularLibreDeQuincena(entrada),
    ingresoReal: ingresoLineas.reduce((s, p) => s + p.real, 0),
    ingresoPresupuestado,
    gastoReal: gastoLineas.reduce((s, p) => s + p.real, 0),
    gastoPresupuestado,
    gastoFaltaPorPagar: calcularFaltaPorPagar(c.presupuestos),
    balancePresupuestado: ingresoPresupuestado - gastoPresupuestado,
    sinPartida: c.sinPartida,
  }
}

export function useResumenQuincena(quincenaId: string, today: string) {
  // El estado guarda para que quincena se cargo: "cargando" se deriva de ahi
  // en vez de prenderse dentro del efecto (setState sincrono en un efecto
  // provoca renders en cascada). Recargar no borra lo que ya se ve.
  const [cargado, setCargado] = useState<{ id: string; crudo: Crudo | null } | null>(null)
  // Ultima lista de quincenas sin cerrar que SI cargo. Un fallo no la pisa:
  // convertirlo en [] diria "nada pendiente" y vaciaria el asistente abierto.
  const [cierre, setCierre] = useState<GrupoCierre[] | null>(null)
  const [cierreError, setCierreError] = useState(false)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (!quincenaId) return
    let cancelado = false
    Promise.all([
      json(`/api/presupuestos?quincenaId=${quincenaId}`),
      json(`/api/transacciones?quincenaId=${quincenaId}&limit=5`),
      // Liquidez fallida = "sin corte"; sin partida fallida = 0. Solo
      // presupuestos y los totales de transacciones son indispensables.
      jsonOpcional(`/api/liquidez?quincenaId=${quincenaId}`),
      jsonOpcional(`/api/transacciones?quincenaId=${quincenaId}&asignado=no&limit=1`),
    ])
      .then(([presupuestos, txJson, liquidez, sinPartidaJson]) => {
        if (cancelado) return
        const rawSnap = Array.isArray(liquidez) && liquidez.length > 0 ? liquidez[0] : null
        setCargado({
          id: quincenaId,
          crudo: {
            presupuestos: Array.isArray(presupuestos) ? presupuestos : [],
            transacciones: Array.isArray(txJson?.data) ? txJson.data : [],
            ingresosTotales: Number(txJson?.totales?.Ingreso ?? 0),
            gastoTotal: Number(txJson?.totales?.Gasto ?? 0),
            liquidez: rawSnap ? { total: sumLiquidez(normalizeMontos(rawSnap)), fechaCorte: rawSnap.fechaCorte ?? null } : null,
            sinPartida: {
              cantidad: Number(sinPartidaJson?.pagination?.total ?? 0),
              monto: Number(sinPartidaJson?.totales?.Gasto ?? 0),
            },
          },
        })
      })
      .catch(() => {
        if (!cancelado) setCargado({ id: quincenaId, crudo: null })
      })
    return () => { cancelado = true }
  }, [quincenaId, version])

  const listo = cargado != null && cargado.id === quincenaId

  // Diferido: el historial completo solo hace falta para "quincenas sin
  // cerrar", asi que no retrasa el veredicto.
  useEffect(() => {
    if (!listo) return
    let cancelado = false
    json('/api/presupuestos')
      .then(todos => {
        if (cancelado) return
        const lista = (Array.isArray(todos) ? todos : []) as Parameters<typeof quincenasPendientesDeCierre>[0]
        setCierre(quincenasPendientesDeCierre(lista, today))
        setCierreError(false)
      })
      .catch(() => {
        if (!cancelado) setCierreError(true)
      })
    return () => { cancelado = true }
  }, [listo, version, today])

  const recargar = useCallback(() => setVersion(v => v + 1), [])

  return {
    cargando: !listo,
    error: listo && cargado.crudo == null,
    resumen: listo && cargado.crudo ? resumir(cargado.crudo, today) : null,
    // null mientras se carga el historial (o si nunca cargo).
    gruposCierre: cierre,
    // true si el ultimo intento de revisar el historial fallo.
    cierreError,
    recargar,
  }
}
