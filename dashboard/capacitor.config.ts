import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.milogastos.app',
  appName: 'Milo Gastos',
  webDir: 'public',

  // En produccion apunta al servidor live.
  // Para desarrollo local, cambia a http://localhost:3000
  server: {
    url: 'https://gastos-dashboard.onrender.com',
    cleartext: false,
  },

  ios: {
    contentInset: 'always',
    preferredContentMode: 'mobile',
    backgroundColor: '#f8fafc',
  },

  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: '#f8fafc',
      showSpinner: false,
    },
  },
};

export default config;
