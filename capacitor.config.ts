import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "br.com.joaquimkurama.minhamedicacao",
  appName: "Minha medicação",
  webDir: "dist/client",
  // A WebView Android 8 usa esta origem virtual para servir arquivos locais.
  // Neon Auth autoriza EXATAMENTE https://localhost (não todos os domínios).
  server: { hostname: "localhost", androidScheme: "https" },
  plugins: {
    LocalNotifications: {
      smallIcon: "ic_stat_medication",
      iconColor: "#2563EB",
    },
  },
};

export default config;
