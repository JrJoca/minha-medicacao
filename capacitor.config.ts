import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "br.com.joaquimkurama.minhamedicacao",
  appName: "Minha medicação",
  webDir: "dist/client",
  plugins: {
    LocalNotifications: {
      smallIcon: "ic_stat_medication",
      iconColor: "#2563EB",
    },
  },
};

export default config;
