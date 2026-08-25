// Exporta un elemento del DOM como imagen PNG o PDF de una sola pagina, del
// lado del navegador. html2canvas y jspdf se importan dinamicamente para no
// inflar el bundle inicial -- igual que exceljs en reporte-excel.ts.

async function captureElement(el: HTMLElement) {
  const { default: html2canvas } = await import('html2canvas')
  return html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true })
}

export async function downloadElementAsImage(el: HTMLElement, filename: string) {
  const canvas = await captureElement(el)
  const link = document.createElement('a')
  link.href = canvas.toDataURL('image/png')
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

export async function downloadElementAsPdf(el: HTMLElement, filename: string) {
  const [canvas, { jsPDF }] = await Promise.all([captureElement(el), import('jspdf')])
  // El canvas se capturo a scale:2 -- se divide entre 2 para volver a px CSS
  // y usar esas dimensiones como tamano de pagina, de forma que el PDF sea
  // exactamente del tamano del contenido (una sola pagina, sin margenes en blanco).
  const widthPx = canvas.width / 2
  const heightPx = canvas.height / 2
  const pdf = new jsPDF({
    orientation: widthPx > heightPx ? 'landscape' : 'portrait',
    unit: 'px',
    format: [widthPx, heightPx],
  })
  // JPEG en vez de PNG solo aqui -- un reporte de una pagina en PNG sin
  // comprimir pesa varios MB (incomoda para compartir); el fondo es blanco
  // solido asi que la compresion con perdida no se nota.
  pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, widthPx, heightPx)
  pdf.save(filename)
}
