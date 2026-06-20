# Issues Fase 9 - iOS App Store (Capacitor)

## Issue #28: Preparar web app para shell nativo

**Title:** `Fase 9 - Preparar web app para shell nativo`

**Body:**
```
## Objetivo
Agregar los meta tags, manifest y assets que Capacitor y iOS necesitan para funcionar como app nativa.

## Tarea
1. Agregar meta tags iOS en `layout.tsx`:
   - `<meta name="apple-mobile-web-app-capable" content="yes">`
   - `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`
   - `<meta name="apple-mobile-web-app-title" content="Milo Gastos">`
   - `<link rel="apple-touch-icon" href="/icon-192.png">`
2. Crear `public/manifest.json` con name, short_name, icons, display, background_color, theme_color
3. Crear `public/splash.png` (1242x2436) y `public/splash-dark.png`
4. Crear iconos: `public/icon-192.png`, `public/icon-512.png`, `public/icon-1024.png`
5. Verificar que todos los fetch a API usen rutas relativas
6. Probar que la web funciona correctamente en Safari iOS

## Archivos a modificar/crear
- `dashboard/src/app/layout.tsx` (modificar)
- `dashboard/public/manifest.json` (crear)
- `dashboard/public/splash.png` (crear)
- `dashboard/public/splash-dark.png` (crear)
- `dashboard/public/icon-192.png` (crear)
- `dashboard/public/icon-512.png` (crear)
- `dashboard/public/icon-1024.png` (crear)

## Criterio de aceptacion
- Meta tags iOS presentes en el <head>
- manifest.json servido correctamente
- Iconos y splash visibles al inspeccionar
- Web funciona sin errores en Safari iOS
```

**Labels:** `fase-9`, `prioridad-alta`

---

## Issue #29: Integrar Capacitor CLI y configuracion

**Title:** `Fase 9 - Integrar Capacitor CLI y configuracion`

**Body:**
```
## Objetivo
Instalar Capacitor, inicializar la configuracion y agregar la plataforma iOS.

## Prerequisito
Issue #28 completado (web app preparada).

## Tarea
1. Instalar dependencias:
   ```bash
   cd dashboard
   npm install @capacitor/core @capacitor/cli @capacitor/ios
   ```
2. Inicializar Capacitor:
   ```bash
   npx cap init
   ```
   - App ID: com.milogastos.app
   - App Name: Milo Gastos
3. Crear `capacitor.config.ts` con:
   - server.url apuntando a https://gastos-dashboard.onrender.com
   - SplashScreen plugin configurado
   - ios.preferredContentMode: mobile
   - ios.backgroundColor acorde al theme
4. Agregar plataforma iOS:
   ```bash
   npx cap add ios
   ```
5. Verificar que se genera la carpeta `dashboard/ios/`

## Archivos a crear/modificar
- `dashboard/capacitor.config.ts` (crear)
- `dashboard/package.json` (modificar, agregar scripts)
- `dashboard/ios/` (generado)

## Criterio de aceptacion
- `npx cap add ios` genera la carpeta ios/ sin errores
- capacitor.config.ts tiene la configuracion correcta
- Se puede abrir el proyecto en Xcode con `npx cap open ios`
```

**Labels:** `fase-9`, `prioridad-alta`

---

## Issue #30: Configurar proyecto iOS en Xcode

**Title:** `Fase 9 - Configurar proyecto iOS nativo en Xcode`

**Body:**
```
## Objetivo
Configurar el proyecto nativo iOS generado por Capacitor: bundle ID, iconos, splash, permisos.

## Prerequisito
Issue #29 completado (Capacitor CLI instalado y plataforma iOS agregada).

## Nota
Este issue requiere macOS con Xcode 16+ instalado.

## Tarea
1. Abrir `dashboard/ios/App/App.xcworkspace` en Xcode
2. Configurar en Xcode:
   - Bundle ID: com.milogastos.app
   - Team: (cuenta de desarrollador Apple)
   - Minimum Deployment: iOS 16.0
   - Device Orientation: Portrait + Landscape
3. Agregar App Icon en Assets.xcassets/AppIcon.appiconset:
   - Usar icon-1024.png como base
   - Generar todas las tallas requeridas por iOS
4. Configurar Launch Screen (splash) en LaunchScreen.storyboard:
   - Color de fondo: #f8fafc (light) / #0f172a (dark)
   - Logo de Milo Gastos centrado
5. Configurar Info.plist:
   - UIStatusBarHidden: NO
   - UIViewControllerBasedStatusBarAppearance: YES
   - NSFaceIDUsageDescription: "Accede a Milo Gastos con tu huella o rostro"

## Archivos a modificar
- `dashboard/ios/App/App.xcworkspace` (Xcode project)
- `dashboard/ios/App/App/Assets.xcassets/AppIcon.appiconset/`
- `dashboard/ios/App/App/Base.lproj/LaunchScreen.storyboard`
- `dashboard/ios/App/App/Info.plist`

## Criterio de aceptacion
- Proyecto compila en Xcode sin errores
- Icono aparece en el simulador
- Splash screen se muestra al iniciar
- Face ID configurado correctamente
```

**Labels:** `fase-9`, `prioridad-alta`, `requiere-macos`

---

## Issue #31: Agregar plugins nativos

**Title:** `Fase 9 - Agregar plugins nativos (Face ID, notificaciones, hapticos)`

**Body:**
```
## Objetivo
Instalar y configurar los plugins nativos de Capacitor para mejorar la experiencia iOS.

## Prerequisito
Issue #29 completado (Capacitor instalado).

## Tarea
1. Instalar plugins:
   ```bash
   cd dashboard
   npm install @capacitor/local-auth @capacitor/push-notifications @capacitor/haptics
   npx cap sync
   ```
2. Para local-auth (Face ID):
   - Verificar que NSFaceIDUsageDescription esta en Info.plist
   - Crear hook en la web app para bloquear acceso si no hay autenticacion
3. Para push-notifications:
   - En Xcode: Capabilities > Push Notifications (ON)
   - Configurar APNs (Apple Push Notification service) en App Store Connect
   - Decidir si usar Firebase Cloud Messaging o APNs directo
4. Para haptics:
   - Agregar feedback tactil en acciones clave (toggle estatus, botones principales)

## Archivos a modificar
- `dashboard/package.json` (plugins en dependencies)
- `dashboard/ios/App/App/Info.plist` (si falta NSFaceIDUsageDescription)

## Criterio de aceptacion
- `npx cap sync` ejecuta sin errores
- Face ID se puede invocar desde la web app
- Notificaciones push configuradas en Xcode
- Haptic feedback funciona en el simulador
```

**Labels:** `fase-9`, `prioridad-media`

---

## Issue #32: Scripts de build y automatizacion

**Title:** `Fase 9 - Scripts de build y automatizacion`

**Body:**
```
## Objetivo
Crear scripts en package.json para facilitar el build y release de la app iOS.

## Prerequisito
Issue #29 completado.

## Tarea
1. Agregar scripts en `dashboard/package.json`:
   ```json
   "cap:dev": "npx cap open ios",
   "cap:sync": "npx cap sync",
   "cap:build": "npm run build && npx cap copy && npx cap sync",
   "cap:release": "npm run build && npx cap copy && npx cap sync && cd ios/App && xcodebuild -workspace App.xcworkspace -scheme App -configuration Release archive"
   ```
2. Opcional: crear `scripts/build-ios.sh` o `scripts/build-ios.ps1` que automatice:
   - Build de Next.js
   - Capacitor sync
   - Archive en Xcode
   - Export para App Store

## Archivos a modificar/crear
- `dashboard/package.json` (modificar)
- `scripts/build-ios.sh` (opcional, crear)
- `scripts/build-ios.ps1` (opcional, crear)

## Criterio de aceptacion
- `npm run cap:sync` funciona sin errores
- `npm run cap:dev` abre Xcode correctamente
- `npm run cap:build` hace build + copy + sync en secuencia
```

**Labels:** `fase-9`, `prioridad-baja`

---

## Issue #33: App Store Connect y subida a Review

**Title:** `Fase 9 - App Store Connect y subida a Review`

**Body:**
```
## Objetivo
Crear la app en App Store Connect, subir el build y someterlo a revision de Apple.

## Prerequisito
- Cuenta de desarrollador Apple activa ($99/año)
- Issues #28-#32 completados
- macOS con Xcode

## Tarea
1. En App Store Connect:
   - Crear nueva app
   - Bundle ID: com.milogastos.app
   - SKU: MILO_GASTOS_001
   - Nombre: Milo Gastos
   - Subtitulo: Control de gastos familiar
   - Categoria: Finanzas
2. Llenar metadata:
   - Descripcion corta y larga (en espanol)
   - Palabras clave: gastos, presupuesto, finanzas personales, ahorro
   - URL de soporte: https://gastos-dashboard.onrender.com
   - URL de privacidad: (crear pagina de politica de privacidad)
3. Generar capturas de pantalla:
   - 6.5" (iPhone 14 Pro Max): 5-10 screenshots
   - 5.5" (iPhone 8 Plus): 5-10 screenshots
   - Mostrar: Dashboard, Transacciones, Presupuesto, Deudas, Creditos
4. Subir build:
   - En Xcode: Product > Archive > Distribute App > App Store Connect
   - O via CLI con xcodebuild
5. Someter a revision de Apple

## Pagina de privacidad
Crear una pagina simple en `dashboard/src/app/privacy/page.tsx` con:
- Que datos se recopilan
- Como se usan
- Con quien se comparten
- Derechos del usuario

## Criterio de aceptacion
- Build subido exitosamente a App Store Connect
- App enviada a revision de Apple
- (Opcional) App aprobada y publicada en App Store
```

**Labels:** `fase-9`, `prioridad-alta`, `requiere-macos`, `requiere-cuenta-apple`

---

## Issue #34: Politica de privacidad para App Store

**Title:** `Fase 9 - Crear politica de privacidad para App Store`

**Body:**
```
## Objetivo
Crear la pagina de politica de privacidad que Apple exige para publicar en el App Store.

## Prerequisito
Ninguno (puede ejecutarse en paralelo con otros issues de Fase 9).

## Tarea
1. Crear `dashboard/src/app/privacy/page.tsx` con:
   - Que datos se recopilan (transacciones financieras, nombres de usuario)
   - Como se almacenan (PostgreSQL en Render)
   - Con quien se comparten (con ningun tercero)
   - Medidas de seguridad (base de datos con acceso restringido)
   - Derechos del usuario (acceso, correccion, eliminacion de datos)
   - Informacion de contacto
2. Agregar enlace a la politica en el layout o footer de la app
3. La URL debe ser accesible publicamente para Apple

## Archivos a crear
- `dashboard/src/app/privacy/page.tsx`

## Criterio de aceptacion
- Pagina de privacidad accesible en /privacy
- Contenido completo y claro
- Lista para usarse como URL de privacidad en App Store Connect
```

**Labels:** `fase-9`, `prioridad-media`

---

## Resumen de Issues Fase 9

| Issue | Titulo | Prioridad | Estado | Dependencias |
|-------|--------|-----------|--------|--------------|
| #28 | Preparar web app para shell nativo | Alta | completado | Ninguna |
| #29 | Integrar Capacitor CLI y configuracion | Alta | completado | #28 |
| #30 | Configurar proyecto iOS en Xcode | Alta | pendiente | #29, requiere macOS |
| #31 | Agregar plugins nativos | Media | pendiente | #29, requiere macOS |
| #32 | Scripts de build y automatizacion | Baja | completado | #29 |
| #33 | App Store Connect y subida a Review | Alta | pendiente | #30, #31, requiere macOS + cuenta Apple |
| #34 | Politica de privacidad para App Store | Media | completado | Ninguna |

## Orden de ejecucion (restante en macOS)

1. Issue #30 (Configurar Xcode) — requiere macOS con Xcode 16+
2. Issue #31 (Plugins nativos) — requiere #30
3. Issue #33 (App Store Connect y subida) — requiere #30 + #31 + cuenta Apple Developer

**Nota para handoff:** Los issues #28, #29, #32 y #34 fueron completados en Windows. Ver seccion "Handoff para macOS" en AGENTS.md para los pasos exactos a seguir en Mac.
