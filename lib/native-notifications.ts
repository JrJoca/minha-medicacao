import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import {
  buildNotificationPlan,
  isMedicationNotification,
  isRoutineMedicationNotification,
  reconcileMedicationNotifications,
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
  scheduled: number;
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

/** Cancela imediatamente alarmes pendentes e notificações entregues da rotina. */
export function cancelRoutineNotifications(routineId: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return Promise.resolve();
  if (!routineId) return Promise.reject(new TypeError("Rotina inválida."));
  return serialized(async () => {
    const pending = await pendingMedicationNotifications();
    const obsolete = pending
      .filter(item => isRoutineMedicationNotification(item, routineId))
      .map(item => ({ id: item.id }));
    if (obsolete.length) await LocalNotifications.cancel({ notifications: obsolete });

    const delivered = await LocalNotifications.getDeliveredNotifications();
    const ids = delivered.notifications
      .filter(item => isRoutineMedicationNotification({
        extra: item.extra ?? item.data,
      }, routineId))
      .map(item => item.id);
    if (ids.length) await LocalNotifications.removeDeliveredNotificationsById({ ids });
  });
}

/** Cancela apenas lembretes desta aplicação, inclusive os da versão anterior. */
export function clearRoutineNotifications(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return Promise.resolve();
  return serialized(async () => {
    await clearPending();
    // Na saída de conta, também limpar da bandeja as notificações antigas
    // que ainda exibem o nome da rotina. Não remover mensagens de outros apps.
    const delivered = await LocalNotifications.getDeliveredNotifications();
    const ids = delivered.notifications
      .filter(item => isMedicationNotification({
        extra: item.extra ?? item.data,
      }))
      .map(item => item.id);
    if (ids.length) await LocalNotifications.removeDeliveredNotificationsById({ ids });
  });
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

  return serialized<NotificationSyncReport>(async () => {
    const permission = await LocalNotifications.checkPermissions();
    const status = permission.display === "granted"
      ? permission
      : await LocalNotifications.requestPermissions();

    // Não apagar outras notificações do aplicativo; remover as próprias
    // quando a permissão estiver negada evita disparos com agenda antiga.
    if (status.display !== "granted") {
      await clearPending();
      return { permission: "denied", exact: false, truncated: false, skipped: 0, scheduled: 0 };
    }

    const plan = buildNotificationPlan(routines);
    const pending = await pendingMedicationNotifications();
    const { obsolete, next } = reconcileMedicationNotifications(pending, plan.notifications);

    // Cancelamento ANTES dos novos disparos: não dispara nas datas antigas.
    // Isso remove alarmes de rotinas pausadas/arquivadas e tratamentos encerrados.
    if (obsolete.length) await LocalNotifications.cancel({ notifications: obsolete });

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
      scheduled: plan.notifications.length,
    };
  });
}
