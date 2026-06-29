/**
 * Aquavoy Service Worker — web-push + notificationclick handlers.
 *
 * This file is served as a static asset from /sw.js (public/sw.js).
 * It is NOT bundled by Next.js — it must remain plain JS so the browser
 * can register it directly via navigator.serviceWorker.register('/sw.js').
 *
 * ADR-008: MVP notification channel. Receives push events from the server
 * (sent via web-push in src/lib/notify/webpush.ts) and surfaces them as
 * OS notifications on the installed PWA.
 */

self.addEventListener("push", (e) => {
  const d = e.data ? e.data.json() : {};
  e.waitUntil(
    self.registration.showNotification(d.title ?? "Aquavoy", {
      body: d.body ?? "",
      data: { url: d.url ?? "/" },
      icon: "/icon-192.png",
    })
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data?.url ?? "/";
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url === url && "focus" in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});
