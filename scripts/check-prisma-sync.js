// Verifica que el schema de Prisma y las carpetas de migraciones esten
// sincronizados entre la raiz (la que usa el bot) y dashboard/ (la que usa el
// dashboard).
//
// POR QUE EXISTE
//
// Hay dos Prisma en este repo y ambos corren `prisma migrate deploy` contra
// la MISMA base de datos (gastos-db). Cada uno con su propia historia. Cuando
// las historias divergen, la divergencia no duele en el repo: duele en
// produccion, en silencio.
//
// Ya paso una vez: el dashboard no tenia la migracion `init` que el bot si
// aplicaba. Prisma no se queja (una migracion aplicada que falta en el
// filesystem solo produce un aviso), asi que el dashboard seguia levantando
// mientras su cliente Prisma describia una base que no era la real. El
// DIAGNOSTICO.md del 2026-08-25 lo dejo escrito: "es cuestion de tiempo antes
// de que esto rompa algo en produccion de forma silenciosa".
//
// Este script convierte ese "es cuestion de tiempo" en un fallo de CI el mismo
// dia en que alguien agrega una migracion en un solo lado.
//
// QUE COMPARA
//
//   1. prisma/schema.prisma            ==  dashboard/prisma/schema.prisma
//   2. los nombres de las carpetas de migraciones de los dos lados
//   3. el contenido de cada migration.sql
//
// El check corre en cada PR (ver .github/workflows/ci.yml).
//
// NOTA: comparar los archivos, no "lo que Prisma entiende". Dos archivos
// distintos producen dos generadores distintos, y eso es justo lo que hay que
// evitar.

const fs = require('fs')
const path = require('path')

const RAIZ = path.join(__dirname, '..')
const MIGRATIONS_RAIZ = path.join(RAIZ, 'prisma', 'migrations')
const MIGRATIONS_DASH = path.join(RAIZ, 'dashboard', 'prisma', 'migrations')
const SCHEMA_RAIZ = path.join(RAIZ, 'prisma', 'schema.prisma')
const SCHEMA_DASH = path.join(RAIZ, 'dashboard', 'prisma', 'schema.prisma')

let pass = 0, fail = 0
function check(label, cond, extra) {
  if (cond) { pass++; console.log(`  OK    ${label}`) }
  else { fail++; console.log(`  FALLA ${label}${extra !== undefined ? '  ->  ' + extra : ''}`) }
}

function leerSiExiste(file) {
  try { return fs.readFileSync(file, 'utf8') } catch { return null }
}

// Las migraciones de Prisma son directorios con un migration.sql adentro. Un
// .sql suelto en la raiz de migrations/ lo ignora Prisma (por eso views.sql
// nunca se aplicaba), asi que no cuenta como migracion pero conviene
// reportarlo.
function listarMigraciones(dir) {
  if (!fs.existsSync(dir)) return { carpetas: new Set(), sueltos: [] }
  const entradas = fs.readdirSync(dir, { withFileTypes: true })
  const carpetas = new Set()
  const sueltos = []
  for (const e of entradas) {
    if (e.isDirectory()) carpetas.add(e.name)
    else if (e.isFile() && e.name.endsWith('.sql')) sueltos.push(e.name)
  }
  return { carpetas, sueltos }
}

console.log('\n=== A: los dos schema.prisma son identicos ===')
const schemaRaiz = leerSiExiste(SCHEMA_RAIZ)
const schemaDash = leerSiExiste(SCHEMA_DASH)
check('prisma/schema.prisma existe', schemaRaiz !== null, SCHEMA_RAIZ)
check('dashboard/prisma/schema.prisma existe', schemaDash !== null, SCHEMA_DASH)
if (schemaRaiz !== null && schemaDash !== null) {
  check('contenido identico byte a byte', schemaRaiz === schemaDash,
    'el bot y el dashboard estan describiendo bases distintas. Copia el archivo del lado que cambia al otro.')
}

console.log('\n=== B: las dos historias de migraciones tienen las mismas carpetas ===')
const raiz = listarMigraciones(MIGRATIONS_RAIZ)
const dash = listarMigraciones(MIGRATIONS_DASH)
check('prisma/migrations existe', fs.existsSync(MIGRATIONS_RAIZ), MIGRATIONS_RAIZ)
check('dashboard/prisma/migrations existe', fs.existsSync(MIGRATIONS_DASH), MIGRATIONS_DASH)
check('mismo numero de migraciones', raiz.carpetas.size === dash.carpetas.size,
  `raiz=${raiz.carpetas.size} dashboard=${dash.carpetas.size}`)

const soloRaiz = [...raiz.carpetas].filter(c => !dash.carpetas.has(c)).sort()
const soloDash = [...dash.carpetas].filter(c => !raiz.carpetas.has(c)).sort()
check('ninguna migracion existe solo en la raiz', soloRaiz.length === 0,
  soloRaiz.length ? `solo en la raiz: ${soloRaiz.join(', ')}` : '')
check('ninguna migracion existe solo en el dashboard', soloDash.length === 0,
  soloDash.length ? `solo en el dashboard: ${soloDash.join(', ')}` : '')

console.log('\n=== C: cada migration.sql es identico en los dos lados ===')
let contenidosDistintos = []
for (const carpeta of [...raiz.carpetas].sort()) {
  if (!dash.carpetas.has(carpeta)) continue
  const a = leerSiExiste(path.join(MIGRATIONS_RAIZ, carpeta, 'migration.sql'))
  const b = leerSiExiste(path.join(MIGRATIONS_DASH, carpeta, 'migration.sql'))
  if (a === null || b === null) {
    contenidosDistintos.push(`${carpeta} (falta migration.sql en ${a === null ? 'la raiz' : 'el dashboard'})`)
  } else if (a !== b) {
    contenidosDistintos.push(`${carpeta} (contenido distinto)`)
  }
}
check('todos los migration.sql coinciden', contenidosDistintos.length === 0,
  contenidosDistintos.join(' | '))

console.log('\n=== D: no hay .sql sueltos en la raiz de migrations/ ===')
// Prisma solo mira carpetas. Un archivo suelto no se aplica nunca: asi es
// como views.sql estuvo "pendiente" desde junio.
check('ningun .sql suelto en prisma/migrations', raiz.sueltos.length === 0,
  raiz.sueltos.length ? `sueltos: ${raiz.sueltos.join(', ')}` : '')
check('ningun .sql suelto en dashboard/prisma/migrations', dash.sueltos.length === 0,
  dash.sueltos.length ? `sueltos: ${dash.sueltos.join(', ')}` : '')

console.log(`\n${pass} pasaron, ${fail} fallaron`)
if (fail > 0) {
  console.log('\nLas dos historias de Prisma divergieron. Cada servicio corre')
  console.log('`prisma migrate deploy` contra la MISMA base con su propia historia,')
  console.log('así que una divergencia rompe en produccion y no en el repo.')
  console.log('Copia el schema y las migraciones al otro lado y vuelve a correr.')
}
process.exit(fail > 0 ? 1 : 0)
