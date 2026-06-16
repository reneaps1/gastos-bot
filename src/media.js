const { GoogleGenerativeAI } = require('@google/generative-ai')

const GEMINI_API_KEY = process.env.GEMINI_API_KEY

function getModel() {
  if (!GEMINI_API_KEY) return null
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)
  return genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })
}

async function transcribeAudio(audioBuffer, mimeType) {
  const m = getModel()
  if (!m) return null
  try {
    const base64 = audioBuffer.toString('base64')
    const result = await m.generateContent([
      { inlineData: { mimeType: mimeType || 'audio/ogg', data: base64 } },
      { text: 'Transcribe este audio a texto en espanol. Responde solo con el texto transcrito, sin explicaciones ni markdown.' },
    ])
    const text = result.response.text().trim()
    console.log('MEDIA_AUDIO_TRANSCRIPTION:', text.substring(0, 200))
    return text || null
  } catch (e) {
    console.error('MEDIA_TRANSCRIBE_ERROR:', e.message)
    return null
  }
}

async function analyzeImage(imageBuffer, mimeType) {
  const m = getModel()
  if (!m) return null
  try {
    const base64 = imageBuffer.toString('base64')
    const result = await m.generateContent([
      { inlineData: { mimeType: mimeType || 'image/jpeg', data: base64 } },
      { text: `Analiza esta imagen en el contexto de finanzas personales familiares en Mexico.

Si parece un ticket, factura, comprobante de pago o estado de cuenta, extrae:
- Monto total
- Concepto o descripcion de lo comprado/pagado
- Fecha si es visible
- Tipo: Gasto, Ingreso o Ahorro

Responde en este formato exacto:
TEXTO: "gaste [monto] en [descripcion]" o "ingreso [monto] de [descripcion]" o "ahorro [monto]"
MONTO: [numero]
DESCRIPCION: [concepto]
TIPO: [Gasto|Ingreso|Ahorro]

Si no es un documento financiero (selfie, paisaje, meme, etc), responde:
TIPO_IMAGEN: no_financiero

Responde solo con el formato indicado, sin markdown ni explicaciones adicionales.` },
    ])
    const text = result.response.text().trim()
    console.log('MEDIA_IMAGE_ANALYSIS:', text.substring(0, 300))
    return parseImageResult(text)
  } catch (e) {
    console.error('MEDIA_IMAGE_ANALYSIS_ERROR:', e.message)
    return null
  }
}

function parseImageResult(text) {
  if (!text || text.includes('TIPO_IMAGEN: no_financiero')) {
    return { type: 'no_financiero' }
  }

  const montoMatch = text.match(/MONTO:\s*(\d+(?:\.\d{1,2})?)/)
  const descMatch = text.match(/DESCRIPCION:\s*(.+)/)
  const tipoMatch = text.match(/TIPO:\s*(Gasto|Ingreso|Ahorro)/)
  const textoMatch = text.match(/TEXTO:\s*"(.+)"/)

  if (!montoMatch) return { type: 'no_financiero' }

  return {
    type: 'expense',
    monto: parseFloat(montoMatch[1]),
    descripcion: descMatch ? descMatch[1].trim() : 'Sin descripcion',
    categoria: tipoMatch ? tipoMatch[1] : 'Gasto',
    textoExtraido: textoMatch ? textoMatch[1] : null,
  }
}

module.exports = { transcribeAudio, analyzeImage }
