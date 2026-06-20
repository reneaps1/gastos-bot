// Genera iconos PNG y splash screens a partir de icon.svg
// Uso: node scripts/generate-assets.js
// Requisito: npm install -D sharp

const fs = require('fs')
const path = require('path')

async function main() {
  let sharp
  try {
    sharp = require('sharp')
  } catch {
    console.log(`
[generate-assets] sharp no esta instalado.
  Para generar los PNGs:
    cd dashboard && npm install -D sharp && node scripts/generate-assets.js

  O manualmente sube public/icon.svg a https://pwa-asset-generator.vercel.app
  y coloca los PNGs generados en public/.
`)
    process.exit(0)
  }

  const svg = fs.readFileSync(path.join(__dirname, '..', 'public', 'icon.svg'))
  const sizes = [192, 512, 1024]

  for (const size of sizes) {
    await sharp(svg)
      .resize(size, size)
      .png()
      .toFile(path.join(__dirname, '..', 'public', `icon-${size}.png`))
    console.log(`  ✓ icon-${size}.png`)
  }

  // Splash screens (1242x2436 = iPhone X ratio)
  const splashSizes = [
    { name: 'splash.png', width: 1242, height: 2436 },
    { name: 'splash-dark.png', width: 1242, height: 2436 },
  ]

  for (const s of splashSizes) {
    const bg = s.name.includes('dark') ? '#0f172a' : '#f8fafc'
    await sharp({
      create: { width: s.width, height: s.height, channels: 3, background: bg },
    })
      .composite([
        {
          input: await sharp(svg).resize(256, 256).toBuffer(),
          top: Math.floor((s.height - 256) / 2),
          left: Math.floor((s.width - 256) / 2),
        },
      ])
      .png()
      .toFile(path.join(__dirname, '..', 'public', s.name))
    console.log(`  ✓ ${s.name}`)
  }

  console.log('\nListo. Todos los assets generados en public/')
}

main().catch(console.error)
