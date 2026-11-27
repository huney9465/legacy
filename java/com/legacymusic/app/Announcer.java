package com.legacymusic.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

/**
 * Announcer.java
 *
 * Bug 6 fix. The old version used
 *     notificationManager.notify((int) System.currentTimeMillis(), ...)
 * so every announcement got a NEW notification id. The tray filled up with dozens of copies of the
 * same message and none of them replaced the previous one.
 *
 * Now the id is derived from the content: the same announcement replaces itself, a different one
 * gets its own slot. The channel is created only once (it used to be re-created on every call),
 * and errors are logged instead of being swallowed by an empty catch.
 *
 * Also works on API 24/25 now (the old code only posted on API 26+).
 */
public final class Announcer {

    private static final String TAG = "LMAnnouncer";
    private static final String CH = "announce";

    private Announcer() { }

    public static void post(Context ctx, String title, String text) {
        if (ctx == null) return;
        String t = (title == null || title.trim().length() == 0) ? "Legacy Music" : title.trim();
        String b = text == null ? "" : text;
        try {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;

            Notification.Builder nb;
            if (Build.VERSION.SDK_INT >= 26) {
                if (nm.getNotificationChannel(CH) == null) {
                    NotificationChannel ch = new NotificationChannel(
                            CH, "Announcements", NotificationManager.IMPORTANCE_HIGH);
                    ch.setShowBadge(true);
                    nm.createNotificationChannel(ch);
                }
                nb = new Notification.Builder(ctx, CH);
            } else {
                nb = new Notification.Builder(ctx);
                nb.setPriority(Notification.PRIORITY_HIGH);
            }

            nb.setSmallIcon(R.drawable.ic_stat_music)
              .setContentTitle(t)
              .setContentText(b)
              .setAutoCancel(true)
              .setOnlyAlertOnce(false)
              .setStyle(new Notification.BigTextStyle().bigText(b));

            Intent open = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
            if (open != null) {
                int f = PendingIntent.FLAG_UPDATE_CURRENT;
                if (Build.VERSION.SDK_INT >= 23) f |= PendingIntent.FLAG_IMMUTABLE;
                nb.setContentIntent(PendingIntent.getActivity(ctx, 0, open, f));
            }

            /* stable per announcement -> no more tray spam */
            int id = ("lm-announce|" + t + "|" + b).hashCode();
            nm.notify(id, nb.build());
        } catch (Exception e) {
            Log.w(TAG, "could not post announcement", e);
        }
    }
}
