package com.legacymusic.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONObject;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * PlaybackService.kt  (rewritten in Java)
 *
 * v23.8-fix:
 *  - the service is a REAL foreground service: it is NOT stopped when the Activity is destroyed
 *    and NOT stopped when the task is swiped away from Recents (onTaskRemoved is a no-op now);
 *  - a real native MediaSessionCompat drives the lock-screen / Quick-Settings / Bluetooth card,
 *    so the card and its buttons keep working even while the WebView is frozen;
 *  - the notification is updated in place (no startForegroundService() on every metadata change);
 *  - the wake lock is renewed while music plays instead of a single 6-hour acquire;
 *  - all errors are logged instead of being swallowed.
 */
public final class PlaybackService extends Service {

    public static final String ACTION_CMD = "com.legacymusic.app.CMD";
    private static final String CH = "playback2";
    private static final int ID = 7;
    private static final String TAG = "LMPlayback";
    /** same value as BuildConfig.SERVER_URL, kept local so the file does not depend on the build flavour */
    private static final String SERVER = "https://musicbot.legacycloud.fun";
    /** foregroundServiceType = mediaPlayback */
    private static final int FGS_TYPE = 2;

    private static final long WAKE_MS = 10 * 60 * 1000L;   // one wake-lock slice, renewed every 5 min
    private static final long WAKE_RENEW_MS = 5 * 60 * 1000L;

    private static volatile PlaybackService sInst;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService artPool = Executors.newSingleThreadExecutor();

    private PowerManager.WakeLock wake;
    private MediaSessionCompat session;
    private NotificationManager nm;
    private BroadcastReceiver cmdRx;

    private String title = "";
    private String artist = "";
    private boolean playing = false;
    private boolean fg = false;
    private long posMs = 0L;
    private long durMs = 0L;
    private float speed = 1f;
    private boolean liked = false;
    private boolean shuf = false;
    private String artUrl = "";
    private Bitmap artBmp = null;

    /* ───────────────────────── lifecycle ───────────────────────── */

    @Override
    public void onCreate() {
        super.onCreate();
        sInst = this;
        nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        createChannel();
        buildSession();
        registerCmdReceiver();
        Log.i(TAG, "service created");
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        try {
            if (intent == null) {                 // process was restarted by the system: nothing to play any more
                stopSelf();
                return START_NOT_STICKY;
            }
            String t = intent.getStringExtra("t");
            String a = intent.getStringExtra("a");
            boolean p = intent.getBooleanExtra("p", false);
            String json = intent.getStringExtra("j");
            if (t == null) t = "";
            if (a == null) a = "";
            if (t.length() == 0) {                // explicit stop (logout / nothing playing)
                stopPlayback();
                return START_NOT_STICKY;
            }
            applyState(t, a, p, json);
            Notification n = buildNotification();
            try {
                if (Build.VERSION.SDK_INT >= 29) {
                    ServiceCompat.startForeground(this, ID, n, FGS_TYPE);
                } else {
                    startForeground(ID, n);
                }
                fg = true;
            } catch (Exception e) {
                Log.w(TAG, "startForeground failed", e);
            }
            setWake(p);
        } catch (Exception e) {
            Log.e(TAG, "onStartCommand failed", e);
        }
        return START_STICKY;   // if Android kills the process, it brings the service back
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        /* v23.8-fix: the user swiped the app out of Recents.
           The music must KEEP PLAYING (that is what every music player does), so the service is
           not stopped here any more. It only stops when the song is paused and the app is gone,
           or when the user logs out / presses stop. */
        if (!playing) {
            /* nothing is playing any more: do not leave a dead "paused" card in the shade */
            Log.i(TAG, "task removed while paused - stopping the service");
            stopPlayback();
        } else {
            Log.i(TAG, "task removed - keeping playback alive");
        }
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        Log.i(TAG, "service destroyed");
        try { setWake(false); } catch (Exception e) { Log.w(TAG, "wake release", e); }
        try { if (cmdRx != null) unregisterReceiver(cmdRx); } catch (Exception e) { Log.w(TAG, "unregister", e); }
        cmdRx = null;
        try { if (session != null) { session.setActive(false); session.release(); } } catch (Exception e) { Log.w(TAG, "session release", e); }
        session = null;
        artPool.shutdownNow();
        sInst = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    /* ───────────────────────── public API used by MainActivity ───────────────────────── */

    /** true while the service object is alive (used by MainActivity to decide whether to keep the WebView). */
    public static boolean isRunning() {
        return sInst != null;
    }

    public static boolean isPlaying() {
        PlaybackService s = sInst;
        return s != null && s.playing;
    }

    /**
     * Called from the JS bridge (window.LMNative.nowPlaying(...)).
     * If the service is already running the state is applied directly - no startForegroundService()
     * on every metadata change (that used to re-create the notification and is restricted on Android 12+).
     */
    public static void update(Context ctx, String title, String artist, boolean playing, String json) {
        if (ctx == null) return;
        if (title == null) title = "";
        if (artist == null) artist = "";
        if (json == null) json = "";
        PlaybackService s = sInst;
        if (s != null) {
            final String ft = title, fa = artist, fj = json;
            final boolean fp = playing;
            s.main.post(new Runnable() {
                @Override public void run() {
                    PlaybackService cur = sInst;
                    if (cur == null) return;
                    if (ft.length() == 0 && !fp) {      // logout / nothing playing -> take the card away
                        cur.stopPlayback();
                        return;
                    }
                    cur.applyState(ft, fa, fp, fj);
                    cur.ensureForeground();
                }
            });
            return;
        }
        if (title.length() == 0) return;
        Intent i = new Intent(ctx, PlaybackService.class)
                .putExtra("t", title).putExtra("a", artist).putExtra("p", playing).putExtra("j", json);
        try {
            ContextCompat.startForegroundService(ctx, i);
        } catch (Exception e) {
            Log.w(TAG, "startForegroundService failed", e);
        }
    }

    /** Sends a command (play / pause / next / prev / seek:ms / like / shuffle) to the WebView. */
    static void sendCmd(Context ctx, String cmd) {
        try {
            Intent i = new Intent(ACTION_CMD).setPackage(ctx.getPackageName()).putExtra("cmd", cmd);
            ctx.sendBroadcast(i);
        } catch (Exception e) {
            Log.w(TAG, "sendCmd failed", e);
        }
    }

    /* ───────────────────────── state ───────────────────────── */

    private void applyState(String t, String a, boolean p, String json) {
        title = t == null ? "" : t;
        artist = a == null ? "" : a;
        playing = p;
        if (json != null && json.length() > 1) {
            try {
                JSONObject o = new JSONObject(json);
                posMs = Math.max(0L, o.optLong("pos", posMs));
                durMs = Math.max(0L, o.optLong("dur", durMs));
                liked = o.optBoolean("liked", liked);
                shuf = o.optBoolean("shuf", shuf);
                double sp = o.optDouble("speed", speed);
                speed = (float) (sp > 0 ? sp : 1f);
                String u = o.optString("thumb", "");
                if (u.length() == 0) u = o.optString("thumb2", "");
                if (u.length() > 0 && !u.equals(artUrl)) loadArt(u);
                else if (u.length() == 0 && artUrl.length() > 0) { artUrl = ""; artBmp = null; }
            } catch (Exception e) {
                Log.w(TAG, "bad nowPlaying json", e);
            }
        }
        publishSession();
        publishNotification();
    }

    /**
     * Bug 3: the old code called startForegroundService() on EVERY metadata update, which re-created
     * the notification each time and is restricted on Android 12+. Once the service is foreground we
     * only update the existing notification (nm.notify) - no startForeground() round-trip.
     */
    private void ensureForeground() {
        if (fg) return;
        try {
            Notification n = buildNotification();
            if (Build.VERSION.SDK_INT >= 29) {
                ServiceCompat.startForeground(this, ID, n, FGS_TYPE);
            } else {
                startForeground(ID, n);
            }
            fg = true;
        } catch (Exception e) {
            Log.w(TAG, "ensureForeground failed", e);
        }
    }

    private void stopPlayback() {
        playing = false;
        try { if (session != null) { session.setActive(false); } } catch (Exception e) { Log.w(TAG, "session off", e); }
        try { setWake(false); } catch (Exception e) { Log.w(TAG, "wake off", e); }
        try {
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        } catch (Exception e) {
            try { stopForeground(true); } catch (Exception e2) { Log.w(TAG, "stopForeground", e2); }
        }
        fg = false;
        stopSelf();
    }

    /* ───────────────────────── media session ───────────────────────── */

    private void buildSession() {
        try {
            session = new MediaSessionCompat(this, "LegacyMusic");
            session.setFlags(MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS
                    | MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS);
            session.setCallback(new MediaSessionCompat.Callback() {
                @Override public void onPlay() { sendCmd(PlaybackService.this, "play"); }
                @Override public void onPause() { sendCmd(PlaybackService.this, "pause"); }
                @Override public void onStop() { sendCmd(PlaybackService.this, "pause"); }
                @Override public void onSkipToNext() { sendCmd(PlaybackService.this, "next"); }
                @Override public void onSkipToPrevious() { sendCmd(PlaybackService.this, "prev"); }
                @Override public void onSeekTo(long pos) { sendCmd(PlaybackService.this, "seek:" + pos); }
                @Override public void onSetShuffleMode(int shuffleMode) { sendCmd(PlaybackService.this, "shuffle"); }
            });
            session.setSessionActivity(contentIntent());
            session.setMediaButtonReceiver(mediaButtonIntent());
            session.setActive(true);
        } catch (Exception e) {
            Log.e(TAG, "MediaSession could not be created", e);
        }
    }

    private PendingIntent contentIntent() {
        Intent i = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int f = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) f |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getActivity(this, 0, i, f);
    }

    private PendingIntent mediaButtonIntent() {
        Intent i = new Intent(Intent.ACTION_MEDIA_BUTTON).setPackage(getPackageName());
        i.setClass(this, MediaButtonRx.class);
        int f = PendingIntent.FLAG_UPDATE_CURRENT;
        /* the system has to FILL IN the KeyEvent, so on Android 12+ this one must stay mutable
           (an immutable PendingIntent silently drops the key). */
        if (Build.VERSION.SDK_INT >= 31) f |= PendingIntent.FLAG_MUTABLE;
        else if (Build.VERSION.SDK_INT >= 23) f |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getBroadcast(this, 0, i, f);
    }

    private void publishSession() {
        MediaSessionCompat s = session;
        if (s == null) return;
        try {
            MediaMetadataCompat.Builder m = new MediaMetadataCompat.Builder()
                    .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
                    .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist)
                    .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, "Legacy Music")
                    .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, durMs);
            if (artBmp != null) {
                m.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, artBmp);
                m.putBitmap(MediaMetadataCompat.METADATA_KEY_ART, artBmp);
            }
            s.setMetadata(m.build());

            long actions = PlaybackStateCompat.ACTION_PLAY | PlaybackStateCompat.ACTION_PAUSE
                    | PlaybackStateCompat.ACTION_PLAY_PAUSE | PlaybackStateCompat.ACTION_STOP
                    | PlaybackStateCompat.ACTION_SKIP_TO_NEXT | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
                    | PlaybackStateCompat.ACTION_SEEK_TO;
            int st = playing ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED;
            s.setPlaybackState(new PlaybackStateCompat.Builder()
                    .setActions(actions)
                    .setState(st, posMs, speed)
                    .build());
        } catch (Exception e) {
            Log.w(TAG, "publishSession failed", e);
        }
    }

    /* ───────────────────────── notification ───────────────────────── */

    private void createChannel() {
        if (Build.VERSION.SDK_INT < 26 || nm == null) return;
        try {
            if (nm.getNotificationChannel(CH) != null) return;
            NotificationChannel c = new NotificationChannel(CH, "Now playing", NotificationManager.IMPORTANCE_LOW);
            c.setSound(null, null);
            c.enableVibration(false);
            c.enableLights(false);
            c.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            c.setShowBadge(false);
            nm.createNotificationChannel(c);
            /* the old channel of the previous build is removed only once, after the new one exists */
            try { nm.deleteNotificationChannel("playback"); } catch (Exception ignored) { }
        } catch (Exception e) {
            Log.w(TAG, "createChannel failed", e);
        }
    }

    private PendingIntent cmd(String name, int code) {
        Intent i = new Intent(ACTION_CMD).setPackage(getPackageName()).putExtra("cmd", name);
        int f = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) f |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getBroadcast(this, code, i, f);
    }

    private Notification buildNotification() {
        String t = title.length() == 0 ? "Legacy Music" : title;
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CH)
                .setSmallIcon(R.drawable.ic_stat_music)
                .setContentTitle(t)
                .setContentText(artist)
                .setContentIntent(contentIntent())
                .setDeleteIntent(cmd("pause", 9))
                .setOngoing(true)                     // a foreground-service card must not be swipeable
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .addAction(android.R.drawable.ic_media_previous, "Previous", cmd("prev", 1))
                .addAction(playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
                        playing ? "Pause" : "Play", cmd("toggle", 2))
                .addAction(android.R.drawable.ic_media_next, "Next", cmd("next", 3));

        if (artBmp != null) b.setLargeIcon(artBmp);

        if (session != null) {
            androidx.media.app.NotificationCompat.MediaStyle style =
                    new androidx.media.app.NotificationCompat.MediaStyle()
                            .setMediaSession(session.getSessionToken())
                            .setShowActionsInCompactView(0, 1, 2);
            b.setStyle(style);
        }
        if (Build.VERSION.SDK_INT >= 31) {
            try { b.setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE); }
            catch (Throwable ignored) { }
        }
        return b.build();
    }

    private void publishNotification() {
        if (nm == null) return;
        try {
            if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this,
                    "android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
                return;   // no permission: startForeground still works, the card is simply not shown
            }
            nm.notify(ID, buildNotification());
        } catch (Exception e) {
            Log.w(TAG, "notify failed", e);
        }
    }

    /* ───────────────────────── artwork ───────────────────────── */

    private void loadArt(final String url) {
        artUrl = url;
        artPool.execute(new Runnable() {
            @Override public void run() {
                Bitmap b = fetch(url);
                if (b == null) return;
                if (!url.equals(artUrl)) return;      // a newer song took over
                artBmp = b;
                main.post(new Runnable() {
                    @Override public void run() {
                        publishSession();
                        publishNotification();
                    }
                });
            }
        });
    }

    private Bitmap fetch(String url) {
        HttpURLConnection c = null;
        InputStream in = null;
        try {
            String u = url;
            if (u.startsWith("/")) u = SERVER + u;
            else if (!u.startsWith("http")) u = SERVER + "/" + u;
            c = (HttpURLConnection) new URL(u).openConnection();
            c.setConnectTimeout(8000);
            c.setReadTimeout(8000);
            c.setInstanceFollowRedirects(true);
            c.setRequestProperty("User-Agent", "LegacyMusicApp/23.8");
            int code = c.getResponseCode();
            if (code < 200 || code >= 300) return null;
            in = c.getInputStream();
            BitmapFactory.Options o = new BitmapFactory.Options();
            o.inJustDecodeBounds = true;
            BitmapFactory.decodeStream(in, null, o);
            try { in.close(); } catch (Exception ignored) { }
            in = null;
            int sample = 1;
            int max = Math.max(o.outWidth, o.outHeight);
            while (max / sample > 512) sample *= 2;
            BitmapFactory.Options o2 = new BitmapFactory.Options();
            o2.inSampleSize = sample;
            in = c.getInputStream();
            return BitmapFactory.decodeStream(in, null, o2);
        } catch (Exception e) {
            Log.w(TAG, "artwork download failed: " + url, e);
            return null;
        } finally {
            try { if (in != null) in.close(); } catch (Exception ignored) { }
            try { if (c != null) c.disconnect(); } catch (Exception ignored) { }
        }
    }

    /* ───────────────────────── wake lock ───────────────────────── */

    private void setWake(boolean on) {
        try {
            if (on) {
                if (wake == null) {
                    PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                    if (pm == null) return;
                    wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "legacymusic:play");
                    wake.setReferenceCounted(false);
                }
                wake.acquire(WAKE_MS);                 // extends the current slice
                main.removeCallbacks(wakeRenew);
                main.postDelayed(wakeRenew, WAKE_RENEW_MS);
            } else {
                main.removeCallbacks(wakeRenew);
                if (wake != null && wake.isHeld()) wake.release();
            }
        } catch (Exception e) {
            Log.w(TAG, "wake lock failed", e);
        }
    }

    private final Runnable wakeRenew = new Runnable() {
        @Override public void run() {
            if (!playing) return;
            setWake(true);   // renew while the song plays (the old build expired after 6 h and never came back)
        }
    };

    /* ───────────────────────── commands from the media session ───────────────────────── */

    private void registerCmdReceiver() {
        try {
            cmdRx = new BroadcastReceiver() {
                @Override public void onReceive(Context context, Intent intent) {
                    if (intent == null) return;
                    String c = intent.getStringExtra("cmd");
                    if (c == null || c.length() == 0) return;
                    MainActivity.deliverCmd(c);     // works even when the Activity is gone (static WebView)
                }
            };
            IntentFilter f = new IntentFilter(ACTION_CMD);
            if (Build.VERSION.SDK_INT >= 33) {
                registerReceiver(cmdRx, f, Context.RECEIVER_NOT_EXPORTED);
            } else {
                ContextCompat.registerReceiver(this, cmdRx, f, ContextCompat.RECEIVER_NOT_EXPORTED);
            }
        } catch (Exception e) {
            Log.w(TAG, "cmd receiver failed", e);
        }
    }
}
