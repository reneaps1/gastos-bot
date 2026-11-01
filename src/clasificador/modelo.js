// Clasificador de texto para la categoria de un gasto: Naive Bayes multinomial
// sobre palabras y fragmentos de palabra (n-gramas de caracteres).
//
// POR QUE ESTE MODELO Y NO UNA RED NEURONAL: los datos son unos cientos de
// descripciones de dos o tres palabras ("gas spark", "croquetas", "ninera").
// Con eso una red memoriza en vez de generalizar. Naive Bayes:
//   - aprende bien con pocos ejemplos,
//   - se actualiza con UN ejemplo nuevo en O(rasgos), sin reentrenar todo
//     (es lo que permite "aprender" en el momento en que el usuario confirma),
//   - es explicable (cuenta palabras) y cabe en memoria de sobra en el plan
//     gratis de Render, sin dependencias nativas.
//
// Los n-gramas de caracteres son los que toleran errores de dedo y variantes:
// "ninera" / "niñera", "gy m" / "gym", "guarderia" / "guardería" comparten casi
// todos sus fragmentos aunque no sean la misma palabra.
//
// Este archivo es PURO: no toca la base ni la red. El servicio que lo entrena
// desde Postgres y lo alimenta con la retroalimentacion vive en ./index.js.

// Palabras que aparecen en cualquier categoria y solo meten ruido.
const STOPWORDS = new Set([
  'de', 'del', 'la', 'el', 'los', 'las', 'en', 'un', 'una', 'y', 'a', 'al',
  'para', 'por', 'con', 'mi', 'mis', 'que', 'lo', 'se', 'su', 'sus',
  'pesos', 'peso', 'mxn', 'gaste', 'gasto', 'pague', 'pago', 'compre', 'compra',
  'hoy', 'ayer', 'antier',
])

const PESO_PALABRA = 2
const PESO_NGRAMA = 1
const ALPHA = 0.5 // suavizado de Laplace (aditivo)
// Naive Bayes trata cada rasgo como evidencia independiente, pero los
// n-gramas de una misma palabra estan correlacionados: "croquetas" aporta ~15
// rasgos que dicen lo mismo, y el modelo sale "100 % seguro" de casi todo. Se
// escala la evidencia para que valga como mucho EVIDENCIA_MAX rasgos
// independientes. No cambia cual categoria gana; solo hace que la confianza
// que se le muestra al usuario (y el umbral) signifiquen algo.
const EVIDENCIA_MAX = 6

// Minusculas, sin acentos, sin numeros ni simbolos. La ñ se conserva como n:
// en el chat se escribe de las dos formas y deben ser el mismo rasgo.
function normalizar(texto) {
  return String(texto ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokens(texto) {
  return normalizar(texto)
    .split(' ')
    .filter(t => t.length >= 2 && !STOPWORDS.has(t))
}

// Rasgos con su peso. Las palabras pesan mas que los fragmentos: si la palabra
// exacta ya se vio, esa evidencia es mas fuerte que un parecido parcial.
function rasgos(texto) {
  const out = new Map()
  const sumar = (k, w) => out.set(k, (out.get(k) || 0) + w)
  for (const t of tokens(texto)) {
    sumar(`w:${t}`, PESO_PALABRA)
    const marcado = `_${t}_`
    for (const n of [3, 4]) {
      for (let i = 0; i + n <= marcado.length; i++) sumar(`c:${marcado.slice(i, i + n)}`, PESO_NGRAMA)
    }
  }
  return out
}

class Modelo {
  constructor() {
    this.docsPorClase = new Map()    // etiqueta -> ejemplos (ponderados)
    this.totalPorClase = new Map()   // etiqueta -> suma de pesos de rasgos
    this.conteos = new Map()         // etiqueta -> Map(rasgo -> peso)
    this.vocabulario = new Set()
    this.totalDocs = 0
  }

  get ejemplos() {
    return this.totalDocs
  }

  // Suma un ejemplo etiquetado. `peso` > 1 cuenta el ejemplo varias veces: se
  // usa para que una correccion explicita del usuario pese mas que un dato
  // historico.
  aprender(texto, etiqueta, peso = 1) {
    const rs = rasgos(texto)
    if (rs.size === 0 || etiqueta == null || !(peso > 0)) return false
    const clave = String(etiqueta)
    if (!this.conteos.has(clave)) {
      this.conteos.set(clave, new Map())
      this.docsPorClase.set(clave, 0)
      this.totalPorClase.set(clave, 0)
    }
    const c = this.conteos.get(clave)
    for (const [r, w] of rs) {
      c.set(r, (c.get(r) || 0) + w * peso)
      this.totalPorClase.set(clave, this.totalPorClase.get(clave) + w * peso)
      this.vocabulario.add(r)
    }
    this.docsPorClase.set(clave, this.docsPorClase.get(clave) + peso)
    this.totalDocs += peso
    return true
  }

  // Probabilidad de cada etiqueta, de mayor a menor. `permitidas` restringe
  // las clases (p. ej. solo categorias activas de tipo Gasto).
  //
  // `cobertura` es la fraccion del peso de los rasgos del texto que el modelo
  // ya habia visto alguna vez. Naive Bayes reparte la probabilidad aunque no
  // sepa nada ("xyzw" sale 40 % en la clase mas grande); la cobertura es lo
  // que distingue "estoy seguro" de "no tengo idea".
  predecir(texto, permitidas = null) {
    const rs = rasgos(texto)
    let clases = [...this.conteos.keys()]
    if (permitidas) {
      const ok = new Set([...permitidas].map(String))
      clases = clases.filter(k => ok.has(k))
    }
    if (rs.size === 0 || clases.length === 0) return { ranking: [], cobertura: 0 }

    let pesoTotal = 0
    let pesoVisto = 0
    for (const [r, w] of rs) {
      pesoTotal += w
      if (this.vocabulario.has(r)) pesoVisto += w
    }

    const V = this.vocabulario.size + 1
    const docsPermitidos = clases.reduce((s, k) => s + this.docsPorClase.get(k), 0)
    // Los rasgos que el modelo nunca vio se ignoran: no son evidencia de
    // nada, y si contaran favorecerian a las categorias con menos datos (su
    // denominador es menor). Un texto 100 % desconocido queda solo con la
    // probabilidad previa, y la cobertura 0 dice que no hay que creerle.
    const escala = pesoVisto ? Math.min(1, EVIDENCIA_MAX / pesoVisto) : 0
    const logs = clases.map(k => {
      const c = this.conteos.get(k)
      const total = this.totalPorClase.get(k)
      let verosimilitud = 0
      for (const [r, w] of rs) {
        if (!this.vocabulario.has(r)) continue
        verosimilitud += w * Math.log(((c.get(r) || 0) + ALPHA) / (total + ALPHA * V))
      }
      const prior = Math.log((this.docsPorClase.get(k) + 1) / (docsPermitidos + clases.length))
      return { etiqueta: k, lp: prior + escala * verosimilitud }
    })

    const max = Math.max(...logs.map(x => x.lp))
    const exps = logs.map(x => ({ etiqueta: x.etiqueta, e: Math.exp(x.lp - max) }))
    const suma = exps.reduce((s, x) => s + x.e, 0)
    const ranking = exps
      .map(x => ({ etiqueta: x.etiqueta, probabilidad: x.e / suma }))
      .sort((a, b) => b.probabilidad - a.probabilidad || a.etiqueta.localeCompare(b.etiqueta))

    return { ranking, cobertura: pesoTotal ? pesoVisto / pesoTotal : 0 }
  }
}

module.exports = { Modelo, normalizar, tokens, rasgos }
