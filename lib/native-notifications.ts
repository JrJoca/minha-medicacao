import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";

type NotificationRoutine = {
  id: string;
  name: string;
  time: string;
  limit: string;
  paused: boolean;
};

function notificationId(routineId: string, offset: number) {
  let hash = 0;
  for (const character of routineId) {
    hash = (hash * 31 + character.charCodeAt(0)) | 0;
  }
  return (Math.abs(hash) % 900_000_000) * 2 + offset;
}

function clock(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return { hour, minute };
}

export async function syncRoutineNotifications(
  routines: NotificationRoutine[],
) {
  if (!Capacitor.isNativePlatform()) return;

  const permission = await LocalNotifications.checkPermissions();
  const status =
    permission.display === "granted"
      ? permission
      : await LocalNotifications.requestPermissions();
  if (status.display !== "granted") return;

  const pending = await LocalNotifications.getPending();
  if (pending.notifications.length) {
    await LocalNotifications.cancel({
      notifications: pending.notifications.map(({ id }) => ({ id })),
    });
  }

  const active = routines.filter((routine) => !routine.paused);
  if (!active.length) return;

  await LocalNotifications.schedule({
    notifications: active.flatMap((routine) => {
      const reminder = clock(routine.time);
      const deadline = clock(routine.limit);
      return [
        {
          id: notificationId(routine.id, 0),
          title: routine.name,
          body: "Está na hora de realizar sua rotina de medicação.",
          schedule: {
            on: reminder,
            repeats: true,
            allowWhileIdle: true,
          },
          extra: { routineId: routine.id, kind: "reminder" },
        },
        {
          id: notificationId(routine.id, 1),
          title: `Prazo da rotina: ${routine.name}`,
          body: "Este é o horário limite configurado para a rotina.",
          schedule: {
            on: deadline,
            repeats: true,
            allowWhileIdle: true,
          },
          extra: { routineId: routine.id, kind: "deadline" },
        },
      ];
    }),
  });
}
