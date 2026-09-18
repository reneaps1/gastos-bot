// Fijo/Variable por categoria, en un solo lugar.
//
// POR QUE EXISTE: este mapa estaba copiado en tres archivos (src/parser.js,
// src/index.js dentro de parseMessageFromMedia, y src/gemini.js) y las copias
// YA habian divergido -- la de gemini.js perdio las claves Ingresos y Ahorro.
// Nadie lo noto porque las tres leen el mapa con un `||` que tapa el hueco.
//
// El catalogo oficial de 9 categorias es cerrado (ver DEVELOPMENT_POLICY.md,
// "Catalogo Oficial de Categorias"): no existe "Otros". Aun asi cada llamador
// conserva su propio fallback, porque historicamente no coinciden y este
// modulo se extrajo para unificar el dato, no para cambiar comportamiento:
//   - parser.js  -> `|| 'Variable'` (pero antes descarta Ingreso/Ahorro por tipo)
//   - index.js   -> `|| null`
//   - gemini.js  -> `|| null`
// Si algun dia se unifica tambien el fallback, que sea un cambio a proposito y
// con su test, no un efecto colateral de mover constantes de archivo.
const CLASIFICACION_POR_CATEGORIA = {
  Hogar: 'Fijo',
  Salud: 'Fijo',
  Familia: 'Variable',
  Transporte: 'Variable',
  Suscripciones: 'Fijo',
  Deudas: 'Fijo',
  Personal: 'Variable',
  Ingresos: null,
  Ahorro: null,
}

module.exports = { CLASIFICACION_POR_CATEGORIA }
