import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import {
  buildNotificationPlan,
  isMedicationNotification,
  type NotificationRoutine,
} from "./notification-schedule";

// Operações de login, logout e retomada podem chegar quase simultaneamente.
// Serializar evita que uma sincronização antiga recrie alarmes após logout.
let syncQueue: Promise<unknown> = Promise.resolve();

function serialized<T>(work: () => Promise<T>): Promise<T> {
  const operation = syncQueue.then(work, work);
  syncQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export type NotificationSyncReport = {
  permission: "granted" | "denied";
  exact: boolean;
  truncated: boolean;
  skipped: number;
};

async function pendingMedicationNotifications() {
  const pending = await LocalNotifications.getPending();
  return pending.notifications.filter(isMedicationNotification);
}

async function clearPending() {
  const pending = await pendingMedicationNotifications();
  if (!pending.length) return;
  await LocalNotifications.cancel({ notifications: pending.map(({ id }) => ({ id })) });
}

/** Cancela apenas lembretes desta aplicação, inclusive os da versão anterior. */
export function clearRoutineNotifications(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return Promise.resolve();
  return serialized(clearPending);
}

/**
 * Agenda disparos nativos com recorrência semanal quando seguro; intervalos
 * de N dias e calendários limitados usam instantes individuais.
 *
 * A agenda individual é renovada quando o usuário abre/retoma a aplicação.
 * Sem permissão de alarmes exatos, o Android pode apresentar atrasos.
 */
export function syncRoutineNotifications(routines: NotificationRoutine[]): Promise<NotificationSyncReport | null> {
  if (!Capacitor.isNativePlatform()) return Promise.resolve(null);

  return serialized(async () => {
    const permission = await LocalNotifications.checkPermissions();
    const status = permission.display === "granted"
      ? permission
      : await LocalNotifications.requestPermissions();

    // Não apagar outras notificações do aplicativo; remover as próprias
    // quando a permissão estiver negada evita disparos com agenda antiga.
    if (status.display !== "granted") {
      await clearPending();
      return { permission: "denied", exact: false, truncated: false, skipped: 0 };
    }

    const plan = buildNotificationPlan(routines);
    const pending = await pendingMedicationNotifications();
    const desired = new Map(plan.notifications.map(notification => [notification.id, notification]));
    const kept = new Set<number>();
    const obsolete: { id: number }[] = [];

    for (const item of pending) {
      const target = desired.get(item.id);
      const extra = item.extra as Record<string, unknown> | null | undefined;
      if (
        target &&
        extra?.app === "minha-medicacao" &&
        extra?.version === 2 &&
        extra?.signature === target.extra.signature &&
        !kept.has(item.id)
      ) {
        kept.add(item.id);
      } else {
        obsolete.push({ id: item.id });
      }
    }

    // Cancelamento ANTES dos novos disparos: não dispara nas datas antigas.
    if (obsolete.length) await LocalNotifications.cancel({ notifications: obsolete });
    const next = plan.notifications.filter(notification => !kept.has(notification.id));

    // Em Android 12+, falta de permissão exata usa alarme inexato de maneira
    // explícita, sem navegar à configuração do sistema em cada retomada.
    let isExactNotification = true;
    if (Capacitor.getPlatform() === "android") {
      try {
        const setting = await LocalNotifications.checkExactNotificationSetting();
        isExactNotification = setting.exact_alarm === "granted";
      } catch {
        isExactNotification = false;
      }
    }
    if (!isExactNotification) {
      console.warn("Alarmes exatos indisponíveis: notificações podem atrasar no Android.");
    }

    for (let start = 0; start < next.length; start += 24) {
      const batch = next.slice(start, start + 24).map(notification => ({
        ...notification,
        isExactNotification,
      }));
      const result = await LocalNotifications.schedule({ notifications: batch });
      if (result.warning) isExactNotification = false;
    }
    if (plan.truncated) {
      console.warn("Agenda de notificações atingiu o limite; abra o aplicativo regularmente para renovar.");
    }
    if (plan.skipped) {
      console.warn("Algumas rotinas não possuem calendário de notificação válido.");
    }
    return {
      permission: "granted",
      exact: isExactNotification,
      truncated: plan.truncated,
      skipped: plan.skipped,
    };
  });
}
