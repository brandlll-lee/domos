import { Notification } from "electron";
import { z } from "zod";
import { applicationIcon } from "./icons.ts";

export const notificationSchema = z.object({
  sequence: z.number().int().positive(),
  chat: z
    .string()
    .regex(/^(bot\/\d+(?:\/\d+)?|team\/[\w-]+)$/)
    .max(100),
  botId: z.number().int().nonnegative(),
  sessionId: z.number().int().nonnegative(),
  messageId: z.string().min(1).max(256),
  cursor: z
    .string()
    .regex(/^\d+:\d+$/)
    .optional(),
  turnId: z.string().max(256).optional(),
  title: z.string().min(1).max(100),
  body: z.string().min(1).max(500),
});
export type NotificationTarget = z.infer<typeof notificationSchema>;
const notifications = new Map<string, Notification>();

export async function notify(
  instance: string,
  input: NotificationTarget,
  open: () => void,
) {
  if (!Notification.isSupported()) return { shown: false };
  const id = `${instance}:${input.sequence}`;
  if (notifications.has(id)) return { shown: true };
  const notification = new Notification({
    title: `${input.title} · Domos`,
    body: input.body,
    icon: applicationIcon,
    silent: true,
  });
  notification.on("click", open);
  notification.on("close", () => notifications.delete(id));
  notifications.set(id, notification);
  while (notifications.size > 50) {
    const first = notifications.entries().next().value;
    if (!first) break;
    const [oldId, old] = first;
    old.close();
    notifications.delete(oldId);
  }
  return new Promise<{ shown: boolean }>((resolve) => {
    const timer = setTimeout(() => {
      notification.close();
      notifications.delete(id);
      resolve({ shown: false });
    }, 2000);
    notification.once("show", () => {
      clearTimeout(timer);
      resolve({ shown: true });
    });
    notification.once("failed", () => {
      clearTimeout(timer);
      notifications.delete(id);
      resolve({ shown: false });
    });
    notification.show();
  });
}
