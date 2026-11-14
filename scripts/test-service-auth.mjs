// Pruebas del token de servicio del dashboard (dashboard/src/lib/service-auth.ts).
//
// POR QUE EXISTE: el bot de Telegram ejecuta las acciones confirmadas llamando
// a la API del dashboard con MILO_SERVICE_TOKEN. Ese header es una puerta a
// operaciones financieras, asi que lo que tiene que quedar fijo es cuando NO
// abre: sin la variable configurada, con un token incorrecto, o con un header
// mal formado. Y que el actor quede marcado como "milo:<nombre>" y no pueda
// inyectar texto raro a la bitacora.
//
// Corre el .ts directo con el type stripping de Node (22.18+), sin compilar.

const mod = await import('../dashboard/src/lib/service-auth.ts')
const { sesionDeServicio, tokenValido, limpiarActor } = mod

let pass = 0, fail = 0
function check(label, cond, extra) {
  if (cond) { pass++; console.log(`  OK    ${label}`) }
  else { fail++; console.log(`  FALLA ${label}${extra !== undefined ? '  ->  ' + extra : ''}`) }
}

function headers(obj) {
  const h = new Map(Object.entries(obj).map(([k, v]) => [k.toLowerCase(), v]))
  return { get: name => h.get(name.toLowerCase()) ?? null }
}

console.log('=== A: sin MILO_SERVICE_TOKEN el header no abre nada ===')
delete process.env.MILO_SERVICE_TOKEN
check('ni con un Bearer cualquiera', sesionDeServicio(headers({ authorization: 'Bearer algo' })) === null)
check('ni con un Bearer vacio', sesionDeServicio(headers({ authorization: 'Bearer ' })) === null)
check('tokenValido(x) es false', tokenValido('x') === false)

console.log('\n=== B: con la variable, solo el token exacto abre ===')
process.env.MILO_SERVICE_TOKEN = 'token-de-prueba-123'
check('sin header -> null', sesionDeServicio(headers({})) === null)
check('token incorrecto -> null', sesionDeServicio(headers({ authorization: 'Bearer token-de-prueba-124' })) === null)
check('prefijo del token -> null', sesionDeServicio(headers({ authorization: 'Bearer token-de-prueba' })) === null)
check('sin "Bearer" -> null', sesionDeServicio(headers({ authorization: 'token-de-prueba-123' })) === null)
const ok = sesionDeServicio(headers({ authorization: 'Bearer token-de-prueba-123', 'x-milo-actor': 'Rene' }))
check('token correcto -> sesion de servicio', ok?.servicio === true, JSON.stringify(ok))
check('actor milo:Rene', ok?.username === 'milo:Rene', ok?.username)
check('"bearer" en minusculas tambien', sesionDeServicio(headers({ authorization: 'bearer token-de-prueba-123' }))?.servicio === true)

console.log('\n=== C: el actor se limpia ===')
check('sin actor -> milo:bot', sesionDeServicio(headers({ authorization: 'Bearer token-de-prueba-123' }))?.username === 'milo:bot')
check('quita saltos de linea y simbolos', limpiarActor('Rene\n<script>') === 'Renescript', limpiarActor('Rene\n<script>'))
check('respeta acentos', limpiarActor('Mariana Peña') === 'Mariana Peña', limpiarActor('Mariana Peña'))
check('corta a 40', limpiarActor('x'.repeat(100)).length === 40)

console.log(`\n${pass} pasaron, ${fail} fallaron`)
process.exit(fail > 0 ? 1 : 0)
