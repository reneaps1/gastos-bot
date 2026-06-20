# Script de automatizacion para build iOS
# Uso: .\scripts\build-ios.ps1
# Requiere: macOS con Xcode para el paso de archive

param(
    [switch]$Dev,
    [switch]$Build,
    [switch]$Sync,
    [switch]$Archive
)

$ErrorActionPreference = "Stop"

function Write-Step($msg) {
    Write-Host "`n>> $msg" -ForegroundColor Cyan
}

if ($Dev) {
    Write-Step "Abriendo Xcode para desarrollo..."
    npx cap open ios
    exit
}

if ($Build) {
    Write-Step "Generando build de Next.js..."
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Error en build de Next.js" -ForegroundColor Red
        exit 1
    }
}

if ($Sync) {
    Write-Step "Sincronizando con Capacitor..."
    npx cap sync ios
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Error en cap sync" -ForegroundColor Red
        exit 1
    }
}

if ($Archive) {
    if ($IsWindows) {
        Write-Host "El archive requiere macOS con Xcode" -ForegroundColor Yellow
        Write-Host "Ejecuta este script en una Mac:" -ForegroundColor Yellow
        Write-Host "  cd ios/App" -ForegroundColor White
        Write-Host "  xcodebuild -workspace App.xcworkspace -scheme App -configuration Release archive" -ForegroundColor White
        exit 1
    }

    Write-Step "Generando archive en Xcode..."
    Set-Location ios/App
    xcodebuild -workspace App.xcworkspace -scheme App -configuration Release archive
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Error en archive" -ForegroundColor Red
        exit 1
    }
    Set-Location ../..
    Write-Host "`nArchive completado. Abre Xcode Organizer para subir a App Store Connect." -ForegroundColor Green
}

if (-not $Dev -and -not $Build -and -not $Sync -and -not $Archive) {
    Write-Host "Uso: .\scripts\build-ios.ps1 [-Dev] [-Build] [-Sync] [-Archive]" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  -Dev      Abre Xcode para desarrollo"
    Write-Host "  -Build    Genera build de Next.js"
    Write-Host "  -Sync     Sincroniza con Capacitor"
    Write-Host "  -Archive  Genera archive para App Store (requiere macOS)"
    Write-Host ""
    Write-Host "Ejemplo completo: .\scripts\build-ios.ps1 -Build -Sync"
}
