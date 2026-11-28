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
import android.util.Base64;
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
    /* v23.8-fix3: which SONG the picture above belongs to. The page sends this key with every
       update; when it changes the old cover is thrown away at once, so the card can never show
       the previous (or the next) song's picture while the new one is playing. */
    private String artKey = "";
    private String artData = "";
    /* v23.8-fix2: the JS sends a position update every second. Rebuilding and re-posting the whole
       notification every second is real work on a 1-2 GB phone (layout + bitmap + IPC to SystemUI)
       and it is what made the shade/lock-screen feel laggy. Only the cheap session state is updated
       for a position tick; the notification is rebuilt only when something the user can SEE changes. */
    private String notifKey = "";
    private String metaKey = "";

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
        /* v23.8-fix2 - the user's rule: swiping the app out of Recents must STOP the music.
           (Home button / screen off do NOT come here - the Activity is still alive there, so the
           song keeps playing; only a real "remove the app from the background" ends up here.) */
        Log.i(TAG, "task removed - stopping playback");
        stopPlayback();
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

    /**
     * v23.8-fix2: hard stop, used when the Activity is really finishing (swiped out of Recents).
     * Tells the page to pause first (so the <audio> element stops at once), then takes the
     * foreground card away and ends the service.
     */
    public static void stopNow(Context ctx) {
        PlaybackService s = sInst;
        if (s != null) {
            s.main.post(new Runnable() {
                @Override public void run() {
                    PlaybackService cur = sInst;
                    if (cur != null) cur.stopPlayback();
                }
            });
        }
        if (ctx != null) {
            try {
                ctx.stopService(new Intent(ctx, PlaybackService.class));
            } catch (Exception e) {
                Log.w(TAG, "stopService failed", e);
            }
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
                /* v23.8-fix2 (BUG 3 - white cover): the page now sends the picture itself as a small
                   base64 JPEG ("art"), because it is the only side that has the session cookie and the
                   media token. A data URL is decoded here directly - no network, no 403, no white square. */
                /* v23.8-fix3 (wrong cover in the card): the page sends the key of the song the
                   picture belongs to. The moment the key changes the old bitmap is dropped, so the
                   notification can never keep showing the cover of the song that just ended (or
                   jump to the cover of the next one before its song starts). */
                String ak = o.optString("akey", "");
                if (ak.length() > 0 && !ak.equals(artKey)) {
                    artKey = ak;
                    artBmp = null;
                    artUrl = "";
                    artData = "";
                }
                String data = o.optString("art", "");
                if (data.length() > 64 && data.startsWith("data:image")) {
                    if (!data.equals(artData)) { artData = data; setArtFromData(data); }
                } else if (artBmp == null) {
                    /* no base64 picture yet: try the URL as a fallback (it carries the media token now) */
                    String u = o.optString("thumb", "");
                    if (u.length() == 0) u = o.optString("thumb2", "");
                    if (u.length() > 0 && !u.equals(artUrl)) loadArt(u);
                    else if (u.length() == 0 && artUrl.length() > 0) { artUrl = ""; artBmp = null; }
                }
            } catch (Exception e) {
                Log.w(TAG, "bad nowPlaying json", e);
            }
        }
        publishSession();
        String k = title + "\u0001" + artist + "\u0001" + (playing ? 1 : 0) + "\u0001" + (liked ? 1 : 0)
                + "\u0001" + (shuf ? 1 : 0) + "\u0001" + (artBmp != null ? artUrl : "");
        if (!k.equals(notifKey)) {
            notifKey = k;
            publishNotification();
        }
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
        /* v23.8-fix2: tell the page to stop the <audio> element as well. Without this the service died
           but the WebView kept decoding the stream for a moment (and, when the Activity was still alive,
           the song really kept playing with no card at all). */
        try { sendCmd(this, "pause"); } catch (Exception e) { Log.w(TAG, "pause cmd", e); }
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
            /* v23.8-fix2 (background lag): the metadata carries the cover BITMAP. Re-sending it to
               SystemUI every second (the JS sends a position tick every second) is a parcel + IPC of a
               few hundred KB per second on a small phone - that alone makes the lock-screen card laggy.
               Metadata is now published only when the song / artist / duration / cover really changes;
               a position tick only updates the cheap PlaybackState. */
            String mk = title + "\u0001" + artist + "\u0001" + durMs + "\u0001" + (artBmp != null ? artUrl : "");
            if (!mk.equals(metaKey)) {
                metaKey = mk;
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
            }

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
        /* v23.8-fix3: Android 16 "Live Updates" - the song also appears in the status-bar chip
           (the same pill that shows a call or a hotspot), with the app's music icon and the song
           name. Those two methods only exist on API 36+, and this project is compiled against an
           older android.jar, so they are called through reflection. On older phones nothing
           happens - the normal card is used. */
        promoteOngoing(b, t);
        return b.build();
    }

    /**
     * v23.8-fix3. Asks Android 16 to promote this ongoing notification to a Live Update (status-bar
     * chip). Best effort: if the OS does not support it (or the OEM removed it) the calls simply do
     * nothing and the normal media card is shown.
     */
    private void promoteOngoing(NotificationCompat.Builder b, String shortText) {
        if (Build.VERSION.SDK_INT < 36) return;
        try {
            /* NotificationCompat.Builder keeps the platform builder a couple of fields deep
               (Builder -> NotificationCompatBuilder -> android.app.Notification.Builder). */
            Object pb = b;
            for (int hop = 0; hop < 4; hop++) {
                Object next = null;
                Class<?> c = pb.getClass();
                while (c != null) {
                    try {
                        java.lang.reflect.Field f = c.getDeclaredField("mBuilder");
                        f.setAccessible(true);
                        next = f.get(pb);
                        break;
                    } catch (NoSuchFieldException e) {
                        c = c.getSuperclass();
                    }
                }
                if (next == null) break;
                pb = next;
                if (pb.getClass().getName().equals("android.app.Notification$Builder")) break;
            }
            Class<?> pc = pb.getClass();
            try {
                pc.getMethod("setRequestPromotedOngoing", boolean.class).invoke(pb, Boolean.TRUE);
                Log.i(TAG, "Live Update requested");
            } catch (Throwable ignored) { }
            try {
                if (shortText != null && shortText.length() > 0)
                    pc.getMethod("setShortCriticalText", String.class).invoke(pb, shortText);
            } catch (Throwable ignored) { }
        } catch (Throwable e) {
            Log.w(TAG, "Live Update not available", e);
        }
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

    /* v23.8-fix2 (BUG 3 - white cover): the page hands the cover over as "data:image/jpeg;base64,...."
       It is decoded straight from memory - no HTTP request, so a server that answers 403 to a plain
       download cannot leave the notification without a picture any more. */
    private void setArtFromData(String data) {
        try {
            int comma = data.indexOf(',');
            if (comma < 0 || comma + 1 >= data.length()) return;
            byte[] raw = Base64.decode(data.substring(comma + 1), Base64.DEFAULT);
            if (raw == null || raw.length < 200) return;
            BitmapFactory.Options o = new BitmapFactory.Options();
            o.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(raw, 0, raw.length, o);
            int sample = 1;
            int max = Math.max(o.outWidth, o.outHeight);
            while (max / sample > 512) sample *= 2;
            BitmapFactory.Options o2 = new BitmapFactory.Options();
            o2.inSampleSize = sample;
            Bitmap b = BitmapFactory.decodeByteArray(raw, 0, raw.length, o2);
            if (b == null) return;
            /* v23.8-fix3 (the cover did not fill the box): the card draws the large icon in a SQUARE.
               A 16:9 or 4:3 picture was therefore letter-boxed - it looked "long" with empty bars on
               the sides. The picture is centre-cropped to a square here, so it fills the whole box. */
            b = square(b, ART_PX);
            if (b == null) return;
            artUrl = "data:" + data.length();
            artBmp = b;
        } catch (Exception e) {
            Log.w(TAG, "artwork (data url) failed", e);
        }
    }

    private void loadArt(final String url) {
        artUrl = url;
        final String want = artKey;
        artPool.execute(new Runnable() {
            @Override public void run() {
                Bitmap b = fetch(url);
                if (b == null) return;
                if (!url.equals(artUrl) || !want.equals(artKey)) return;   // a newer song took over
                b = square(b, ART_PX);
                if (b == null) return;
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

    /* v23.8-fix3: centre-crop to a square (the media card always draws a square) and scale it to
       ART_PX. Without this a 480x360 / 16:9 cover was letter-boxed inside the square = the
       "photo does not fill the box" look, and a big 1280x720 cover wasted memory. */
    private static final int ART_PX = 512;

    private static Bitmap square(Bitmap b, int size) {
        if (b == null) return null;
        try {
            int w = b.getWidth(), h = b.getHeight();
            if (w <= 0 || h <= 0) return b;
            int side = Math.min(w, h);
            int x = (w - side) / 2, y = (h - side) / 2;
            Bitmap c = (side == w && side == h) ? b : Bitmap.createBitmap(b, x, y, side, side);
            if (c == null) return b;
            if (side == size) return c;
            Bitmap s = Bitmap.createScaledBitmap(c, size, size, true);
            if (s != null) {
                if (s != c && c != b) c.recycle();
                if (s != b && b != c) b.recycle();
                return s;
            }
            return c;
        } catch (Throwable e) {
            Log.w(TAG, "cover crop failed", e);
            return b;
        }
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
            c.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0 Mobile Safari/537.36");
            c.setRequestProperty("Accept", "image/avif,image/webp,image/jpeg,image/png,*/*");
            c.setRequestProperty("Referer", SERVER + "/");
            int code = c.getResponseCode();
            if (code < 200 || code >= 300) {
                Log.w(TAG, "artwork HTTP " + code + " for " + u);
                return null;
            }
            /* v23.8-fix2: the old code called getInputStream() TWICE (once for the bounds, once for the
               bitmap). On a streamed response the second call throws / returns an empty stream, so the
               bitmap was always null -> the notification showed a white square. The bytes are read once
               into memory and both decodes work on that array. */
            in = c.getInputStream();
            java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream(32768);
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) {
                bo.write(buf, 0, n);
                if (bo.size() > 4 * 1024 * 1024) break;      // a cover is never this big
            }
            byte[] raw = bo.toByteArray();
            if (raw.length < 200) return null;
            BitmapFactory.Options o = new BitmapFactory.Options();
            o.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(raw, 0, raw.length, o);
            int sample = 1;
            int max = Math.max(o.outWidth, o.outHeight);
            while (max / sample > 512) sample *= 2;
            BitmapFactory.Options o2 = new BitmapFactory.Options();
            o2.inSampleSize = sample;
            Bitmap b = BitmapFactory.decodeByteArray(raw, 0, raw.length, o2);
            if (b == null) Log.w(TAG, "artwork is not a decodable image: " + u);
            return b;
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
