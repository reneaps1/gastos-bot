const { GoogleGenerativeAI } = require('@google/generative-ai')

const GEMINI_API_KEY = process.env.GEMINI_API_KEY
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
let genModel = null
let currentModel = null

function getModel() {
  if (!GEMINI_API_KEY) return null
  if (!genModel || currentModel !== GEMINI_MODEL) {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)
    genModel = genAI.getGenerativeModel({ model: GEMINI_MODEL })
    currentModel = GEMINI_MODEL
  }
  return genModel
}

const CATEGORIAS = ['Hogar', 'Salud', 'Familia', 'Transporte', 'Suscripciones', 'Deudas', 'Personal', 'Ingresos', 'Ahorro']
const FORMAS_PAGO = ['Efectivo', 'Debito', 'Credito', 'Spei', 'Vales']

const CATEGORIA_EJEMPLOS = {
  Hogar: 'Renta, Luz, Agua, Gas, Internet, Celular, Mantenimiento casa',
  Salud: 'Medicamentos, Terapia, Pediatra, Gine, Tradea, Consultas, Dentista, Vitaminas',
  Familia: 'Super, Panales, Ninera, Guarderia, Croquetas, Formula, Comida, Tortillas, Restaurante',
  Transporte: 'Gasolina, Gas auto, Casetas, Control vehicular, Uber, Taxi',
  Suscripciones: 'Netflix, Spotify, Disney+, YouTube, ChatGPT, Claude, Internet',
  Deudas: 'Prestamos, Coppel, Tanda, Kueski, Pago truck, Abono deuda',
  Personal: 'Diversion, Yoga, GYM, Audifonos, Educacion, Ropa, Corte pelo, Cursos',
  Ingresos: 'Salario, Vales, Bono, Prima, Anticipo, Freelance',
  Ahorro: 'Fondo emergencia, Meta vacaciones, Ahorro pareja, Inversion',
}

const CLASIFICACION_POR_CATEGORIA = {
  Hogar: 'Fijo',
  Salud: 'Fijo',
  Familia: 'Variable',
  Transporte: 'Variable',
  Suscripciones: 'Fijo',
  Deudas: 'Fijo',
  Personal: 'Variable',
}

function buildCategoriasInfo() {
  return CATEGORIAS.map(c => `  - ${c} (${CATEGORIA_EJEMPLOS[c] || ''})`).join('\n')
}

let cachedContext = null
let cachedContextTime = 0

async function getSystemContext(prisma) {
  const now = Date.now()
  if (cachedContext && now - cachedContextTime < 120000) {
    return cachedContext
  }
  try {
    const [lastTxs, categoriasDb, quincenas] = await Promise.all([
      prisma.transaccion.findMany({
        orderBy: { fecha: 'desc' },
        take: 15,
        include: { categoria: true, user: true, metodoPago: true, quincena: true },
      }),
      prisma.categoria.findMany({ where: { activo: true }, orderBy: { nombre: 'asc' } }),
      prisma.quincena.findMany({ orderBy: { fechaInicio: 'desc' }, take: 5 }),
    ])

    const quincenaActiva = quincenas[0] || null
    let quincenaId = null
    if (quincenaActiva) {
      const today = new Date()
      const hoy = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
      for (const q of quincenas) {
        if (hoy >= q.fechaInicio.toISOString().slice(0, 10) && hoy <= q.fechaFin.toISOString().slice(0, 10)) {
          quincenaId = q.id
          quincenaActiva = q
          break
        }
      }
    }

    let resumen = { ingresos: 0, gastos: 0, ahorro: 0, saldo: 0 }
    let presupuestos = []
    let gastosPendientes = []
    let deudasActivas = []

    if (quincenaId) {
      const [ing, gas, aho] = await Promise.all([
        prisma.transaccion.aggregate({ where: { quincenaId, tipo: 'Ingreso' }, _sum: { monto: true } }),
        prisma.transaccion.aggregate({ where: { quincenaId, tipo: 'Gasto' }, _sum: { monto: true } }),
        prisma.transaccion.aggregate({ where: { quincenaId, tipo: 'Ahorro' }, _sum: { monto: true } }),
      ])
      resumen.ingresos = Number(ing._sum.monto ?? 0)
      resumen.gastos = Number(gas._sum.monto ?? 0)
      resumen.ahorro = Number(aho._sum.monto ?? 0)
      resumen.saldo = resumen.ingresos - resumen.gastos - resumen.ahorro

      const [presupData, pendientes] = await Promise.all([
        prisma.presupuesto.findMany({
          where: { quincenaId },
          include: { categoria: true },
          orderBy: { monto: 'desc' },
        }),
        prisma.transaccion.findMany({
          where: { quincenaId, estatus: 'Pendiente', tipo: 'Gasto' },
          orderBy: { fecha: 'asc' },
          take: 10,
          include: { categoria: true },
        }),
      ])
      presupuestos = presupData
      gastosPendientes = pendientes
    }

    const deudas = await prisma.deuda.findMany({
      where: { activo: true },
      orderBy: { acreedor: 'asc' },
    })
    deudasActivas = deudas

    const categoriasResumen = categoriasDb.map(c => ({
      nombre: c.nombre,
      tipo: c.tipo,
      ejemplos: c.ejemplos || CATEGORIA_EJEMPLOS[c.nombre] || '',
    }))

    const ultimos = lastTxs.map(tx => ({
      fecha: tx.fecha.toISOString().slice(0, 10),
      tipo: tx.tipo,
      monto: Number(tx.monto),
      descripcion: tx.descripcion,
      categoria: tx.categoria.nombre,
      formaPago: tx.metodoPago?.nombre || 'Efectivo',
      usuario: tx.user?.nombre || 'Rene',
      quincena: tx.quincena.codigo,
      estatus: tx.estatus,
    }))

    cachedContext = {
      quincenaActiva: quincenaActiva ? { codigo: quincenaActiva.codigo, inicio: quincenaActiva.fechaInicio.toISOString().slice(0, 10), fin: quincenaActiva.fechaFin.toISOString().slice(0, 10) } : null,
      resumen,
      ultimos,
      categorias: categoriasResumen,
      presupuestos: presupuestos.map(p => ({ descripcion: p.descripcion, categoria: p.categoria?.nombre || 'Sin categoria', monto: Number(p.monto), tipo: p.tipo })),
      gastosPendientes: gastosPendientes.map(p => ({ descripcion: p.descripcion, categoria: p.categoria?.nombre || '', monto: Number(p.monto), fecha: p.fecha.toISOString().slice(0, 10) })),
      deudasActivas: deudasActivas.map(d => ({ acreedor: d.acreedor, deudaOriginal: Number(d.deudaOriginal), abonoMensual: d.abonoMensual ? Number(d.abonoMensual) : null })),
    }
    cachedContextTime = now
    return cachedContext
  } catch (e) {
    console.error('GEMINI_GET_CONTEXT_ERROR:', e.message)
    return cachedContext || null
  }
}

function buildSystemPrompt(context) {
  const parts = []
  if (context?.quincenaActiva) {
    parts.push(`Quincena activa: ${context.quincenaActiva.codigo} (${context.quincenaActiva.inicio} al ${context.quincenaActiva.fin})`)
  }
  if (context?.resumen) {
    parts.push(`Resumen: Ingresos $${context.resumen.ingresos}, Gastos $${context.resumen.gastos}, Saldo $${context.resumen.saldo}`)
  }
  if (context?.gastosPendientes?.length) {
    const pend = context.gastosPendientes.map(p => `  - ${p.descripcion} (${p.categoria}): $${p.monto}`).join('\n')
    parts.push(`Gastos pendientes por pagar esta quincena:\n${pend}`)
  }
  if (context?.presupuestos?.length) {
    const pres = context.presupuestos.filter(p => p.tipo === 'Gasto').map(p => `  - ${p.descripcion} (${p.categoria}): $${p.monto}`).join('\n')
    if (pres) parts.push(`Presupuesto de la quincena:\n${pres}`)
  }
  if (context?.ultimos?.length) {
    const movs = context.ultimos.slice(0, 10).map(tx => `  ${tx.fecha} | ${tx.tipo} | $${tx.monto} | ${tx.descripcion} | ${tx.categoria} | ${tx.usuario}`).join('\n')
    parts.push(`Ultimos movimientos:\n${movs}`)
  }
  return parts.join('\n\n')
}

async function classify(text, context) {
  const m = getModel()
  if (!m) return null
  try {
    const sysPrompt = context ? buildSystemPrompt(context) : ''
    const prompt = `Eres un clasificador de mensajes para GastosBot, un bot de finanzas familiares en Mexico.
Analiza el mensaje y clasificalo en uno de tres tipos.

${sysPrompt ? `CONTEXTO DEL SISTEMA:\n${sysPrompt}\n` : ''}

CATEGORIAS OFICIALES con ejemplos de consumo mexicano:
${buildCategoriasInfo()}

FORMAS DE PAGO: ${FORMAS_PAGO.join(', ')}

REGLAS DE CLASIFICACION:
- "comida", "super", "restaurante", "tacos", "pizza", "formula", "panales", "croquetas", "guarderia", "ninera" van en Familia
- "renta", "luz", "agua", "gas", "internet", "celular" van en Hogar
- "gasolina", "gas", "uber", "taxi", "caseta" van en Transporte
- "medicina", "tradea", "gine", "terapia", "pediatra", "doctor", "dentista" van en Salud
- "netflix", "spotify", "disney", "youtube", "chatgpt", "claude" van en Suscripciones
- "coppel", "kueski", "tanda", "prestamo", "abono", "pago truck" van en Deudas
- "diversion", "gym", "yoga", "ropa", "corte pelo", "audifonos", "educacion", "maestria", "cursos" van en Personal
- "salario", "nomina", "vales", "bono", "prima", "anticipo", "freelance" son Ingresos
- "ahorro", "fondo", "inversion", "meta" son Ahorro

TIPOS DE MENSAJE:

REGISTRO: el usuario quiere registrar un gasto, ingreso o ahorro. Incluye un monto numerico o una cantidad implicita.
  Ejemplos:
  - "gaste 150 en uber" → expense, monto:150, descripcion:"uber", categoria:Transporte, formaPago:Efectivo, tipo:Gasto
  - "compre pizza 200 con tarjeta" → expense, monto:200, descripcion:"pizza", categoria:Familia, formaPago:Credito, tipo:Gasto
  - "me cobraron la renta 8000" → expense, monto:8000, descripcion:"renta", categoria:Hogar, tipo:Gasto
  - "pague la guarderia 2500" → expense, monto:2500, descripcion:"guarderia", categoria:Familia, tipo:Gasto
  - "recibi mi bono de 4000" → expense, monto:4000, descripcion:"bono", categoria:Ingresos, tipo:Ingreso
  - "ingreso 5000 nomina" → expense, monto:5000, descripcion:"nomina", categoria:Ingresos, tipo:Ingreso
  - "ahorro 1000" → expense, monto:1000, descripcion:"ahorro", categoria:Ahorro, tipo:Ahorro
  - "gaste como 180 en comida para Leo con tarjeta" → expense, monto:180, descripcion:"comida para Leo", categoria:Familia, formaPago:Credito, tipo:Gasto
  - "hoy nos cobraron la renta 8000" → expense, monto:8000, descripcion:"renta", categoria:Hogar, tipo:Gasto
  - "ayer gaste 250 en el super" → expense, monto:250, descripcion:"super", categoria:Familia, tipo:Gasto
  - "me descontaron 1200 del seguro" → expense, monto:1200, descripcion:"seguro", categoria:Salud, tipo:Gasto
  - "transferi 2000 al ahorro" → expense, monto:2000, descripcion:"transferencia ahorro", categoria:Ahorro, tipo:Ahorro
  - "todo junto: 500 super 300 gasolina 200 netflix" → expense, usa el monto total o el primer monto claro
  - Si el monto no es claro o no hay numero, NO clasifiques como REGISTRO

PREGUNTA: el usuario pregunta sobre sus finanzas (cuanto gasto, como va, que falta, balance, etc).
  Ejemplos:
  - "cuanto gaste esta semana", "como voy en el mes", "muestrame mis gastos de transporte"
  - "cuanto gaste hoy", "cuanto gaste ayer", "que gaste en comida"
  - "como va la quincena", "cuanto me queda", "cuanto debo"
  - "que falta pagar", "cual es mi saldo", "estoy pasado en algo"
  - "resumen", "balance", "top gastos", "ultimos movimientos"
  - "cuanto he gastado en super este mes"

CHAT: cualquier otra cosa — saludos, despedidas, gracias, comentarios, preguntas no financieras.
  Ejemplos: "hola", "gracias", "ok", "perfecto", "buenos dias", "hasta luego", "que tal"
  Tambien: mensajes cortos sin numero ni pregunta financiera clara.

Mensaje: "${text}"

Responde SOLO con JSON sin markdown:
- REGISTRO: {"type":"expense","monto":numero,"descripcion":"breve","categoria":"categoria","formaPago":"forma","tipo":"Gasto|Ingreso|Ahorro","estatus":"Pagado|Pendiente"}
- PREGUNTA: {"type":"question"}
- CHAT: {"type":"chat"}`

    const result = await m.generateContent(prompt)
    const raw = result.response.text().trim().replace(/```json\n?|\n?```/g, '').trim()
    const data = JSON.parse(raw)

    if (data.type === 'expense') {
      if (!CATEGORIAS.includes(data.categoria)) data.categoria = 'Personal'
      if (!FORMAS_PAGO.includes(data.formaPago)) data.formaPago = 'Efectivo'
      if (!['Gasto', 'Ingreso', 'Ahorro'].includes(data.tipo)) data.tipo = 'Gasto'
      if (typeof data.monto !== 'number' || data.monto <= 0) data.monto = null
      data.estatus = data.estatus === 'Pendiente' ? 'Pendiente' : 'Pagado'
      data.clasificacion = CLASIFICACION_POR_CATEGORIA[data.categoria] || null
    }

    console.log('GEMINI_CLASSIFY_RESULT:', JSON.stringify({ type: data.type, categoria: data.categoria, monto: data.monto }))
    return data
  } catch (e) {
    console.error('GEMINI_CLASSIFY_ERROR:', e.message)
    return null
  }
}

async function answer(text, transactions, senderName, context) {
  const m = getModel()
  if (!m) return null
  try {
    const rows = transactions.slice(0, 50).map(t =>
      `${t.fecha}|${t.tipo}|$${t.monto}|${t.descripcion}|${t.categoria}|${t.formaPago}|${t.quincena || ''}`
    ).join('\n')

    const sysPrompt = context ? buildSystemPrompt(context) : ''

    const prompt = `Eres el asistente financiero personal de ${senderName}. Eres GastosBot, util y conciso.

${sysPrompt ? `CONTEXTO ACTUAL DEL SISTEMA:\n${sysPrompt}\n` : ''}

Registros de la base de datos (fecha|tipo|monto|descripcion|categoria|forma de pago|quincena):
${rows}

Hoy: ${new Date().toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}

Pregunta: "${text}"

Responde en espanol mexicano, de forma concisa, util y amigable. Maximo 5 lineas.
Usa los datos reales del contexto para dar numeros exactos.
Si el usuario pregunta "como vamos" o "como va la quincena", di ingresos, gastos y saldo real.
Si pregunta "que falta pagar", menciona los pendientes.
Si pregunta por una categoria especifica, suma los gastos reales de esa categoria.
Si no tienes suficientes datos para responder, dilo honestamente.
Usa formato: $1,234.56 para cantidades.`

    const result = await m.generateContent(prompt)
    const reply = result.response.text().trim()
    console.log('GEMINI_ANSWER_REPLY:', reply.substring(0, 120))
    return reply
  } catch (e) {
    console.error('GEMINI_ANSWER_ERROR:', e.message)
    return null
  }
}

async function chat(text, senderName, context) {
  const m = getModel()
  if (!m) return null
  try {
    const sysPrompt = context ? buildSystemPrompt(context) : ''

    const prompt = `Eres GastosBot, un asistente de finanzas familiares amigable y practico. El usuario es ${senderName}.

${sysPrompt ? `CONTEXTO ACTUAL:\n${sysPrompt}\n` : ''}

Mensaje del usuario: "${text}"

Responde de forma natural, breve y en espanol mexicano (maximo 3 lineas).
Si es un saludo, saluda de vuelta y menciona brevemente como va la quincena con datos reales si los tienes.
Ejemplos de respuestas con contexto:
- "Hola Rene! Estamos en Q29, llevas $12,500 gastados de $45,000 presupuestados. Tu saldo es de $32,500."
- "Buenos dias! Hoy es martes, la quincena cierra el 29 de junio. Vas bien, con $5,200 de margen positivo."
- "Que tal! Te faltan por pagar guarderia ($2,500) y renta ($8,000) esta quincena."
Si no tienes contexto o no necesitas mencionarlo, solo responde de forma natural y ofrece ayuda.
Nunca inventes numeros que no esten en el contexto.`

    const result = await m.generateContent(prompt)
    const reply = result.response.text().trim()
    console.log('GEMINI_CHAT_REPLY:', reply.substring(0, 120))
    return reply
  } catch (e) {
    console.error('GEMINI_CHAT_ERROR:', e.message)
    return null
  }
}

module.exports = { classify, answer, chat, getSystemContext, isEnabled: () => !!GEMINI_API_KEY }
