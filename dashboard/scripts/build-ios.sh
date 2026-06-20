#!/bin/bash
# Script de automatizacion para build iOS (macOS/Linux)
# Uso: ./scripts/build-ios.sh [dev|build|sync|archive]

set -e

step() { echo -e "\n>> $1"; }

case "${1:-help}" in
  dev)
    step "Abriendo Xcode para desarrollo..."
    npx cap open ios
    ;;
  build)
    step "Generando build de Next.js..."
    npm run build
    ;;
  sync)
    step "Sincronizando con Capacitor..."
    npx cap sync ios
    ;;
  archive)
    step "Generando archive en Xcode..."
    cd ios/App
    xcodebuild -workspace App.xcworkspace -scheme App -configuration Release archive
    echo -e "\nArchive completado. Abre Xcode Organizer para subir a App Store Connect."
    ;;
  full)
    step "Build de Next.js..."
    npm run build
    step "Sincronizando con Capacitor..."
    npx cap sync ios
    step "Generando archive en Xcode..."
    cd ios/App
    xcodebuild -workspace App.xcworkspace -scheme App -configuration Release archive
    echo -e "\nArchive completado. Abre Xcode Organizer para subir a App Store Connect."
    ;;
  *)
    echo "Uso: ./scripts/build-ios.sh [dev|build|sync|archive|full]"
    echo ""
    echo "  dev      Abre Xcode para desarrollo"
    echo "  build    Genera build de Next.js"
    echo "  sync     Sincroniza con Capacitor"
    echo "  archive  Genera archive para App Store (requiere macOS)"
    echo "  full     Build + sync + archive (requiere macOS)"
    ;;
esac
