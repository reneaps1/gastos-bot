// Mirror de dashboard/src/lib/transaccion-ahorro.ts en CommonJS (el bot no
// puede importar el módulo TS del dashboard). Ver ese archivo para el porqué:
// toda transaccion de categoria "Ahorro" siempre debe tener tipo:'Ahorro',
// para que las cards que agregan por tipo (dashboard, resumen de quincena
// del bot) siempre vean estos movimientos.

function resolverTipoYDireccion(categoriaTipo, tipoSolicitado, direccionSolicitada) {
  if (categoriaTipo === 'Ahorro') {
    const direccion = direccionSolicitada === 'Retiro' || tipoSolicitado === 'Ingreso' ? 'Retiro' : 'Aporte'
    return { tipo: 'Ahorro', direccion }
  }
  const tipo = tipoSolicitado === 'Ahorro' || !tipoSolicitado ? categoriaTipo : tipoSolicitado
  return { tipo, direccion: null }
}

module.exports = { resolverTipoYDireccion }
