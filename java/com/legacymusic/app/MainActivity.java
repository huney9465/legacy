package com.legacymusic.app;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.browser.customtabs.CustomTabsIntent;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.webkit.WebViewAssetLoader;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.security.MessageDigest;
import java.util.ArrayDeque;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * MainActivity.kt  (rewritten in Java)
 *
 * v23.8-fix. What changed and why:
 *
 *  1) THE SONG NO LONGER DIES WHEN THE APP IS CLOSED  (Bug 1)
 *     The audio lives inside this WebView's <audio> element. The old onDestroy() called
 *     PlaybackService.update(ctx,"","",false) -> stopService() and then web.destroy(), so every
 *     time the Activity went away (Recents swipe, "close app", process trim) the WebView - and
 *     with it the song - was destroyed. Now the WebView is kept in a static holder, is NOT
 *     destroyed while music is playing, and is simply re-attached to the next Activity. The
 *     service is never told to stop from here.
 *
 *  2) NO MORE BLACK / WHITE SCREEN  (Bug 4)
 *     onRenderProcessGone() is handled: the dead WebView is thrown away, a fresh one is built and
 *     the app is reloaded. The player restores the last song from localStorage and (because we now
 *     save the "was playing" flag) starts it again instead of showing a dead/black surface.
 *
 *  3) NO MORE BACKGROUND LAG  (Bug 2A)
 *     setRendererPriorityPolicy(RENDERER_PRIORITY_IMPORTANT, waived=true) - the old value (2 =
 *     RENDERER_PRIORITY_BOUND, not waived) let Android lower the renderer priority and freeze the
 *     JS timer thread while the app was in the background, which is exactly the "stutter/lag".
 *
 *  4) The lock-screen card now has a real native MediaSession behind it (see PlaybackService) and
 *     the 4th argument of LMNative.nowPlaying() (position / duration / artwork JSON) is actually
 *     forwarded to the service instead of being dropped.
 *
 *  5) The Activity no longer registers its own ACTION_CMD receiver (the service does), so a
 *     notification / lock-screen button can never be delivered twice (double "next").
 */
public final class MainActivity extends AppCompatActivity {

    private static final String TAG = "LMMain";
    private static final String HOME = "https://appassets.androidplatform.net/index.html";
    private static final String SERVER = "https://musicbot.legacycloud.fun";

    /** token format accepted from the legacymusic://auth?token=... deep link */
    private static final Pattern TOKEN_RE = Pattern.compile("^[A-Za-z0-9_.\\-]{20,2000}$");

    /* ─────────────── process-wide state (survives Activity re-creation) ─────────────── */

    private static final Handler UI = new Handler(Looper.getMainLooper());
    /** The one and only WebView. Kept alive while music plays so the <audio> element keeps going. */
    private static WebView sWeb;
    private static WebViewAssetLoader sLoader;
    private static boolean sLoaded;
    private static String sToken;
    /** commands that arrived before the page was ready (e.g. lock-screen "next" right after a reload) */
    private static final ArrayDeque<String> sCmdQ = new ArrayDeque<String>();
    private static MainActivity sAct;
    private static Context sApp;

    /* ─────────────── per-Activity state ─────────────── */

    private FileChooser chooser;
    private String[] pendingUpdate;          // {url, sha256}
    private UpdateDone updateDone;

    /* ─────────────── lifecycle ─────────────── */

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        sAct = this;
        sApp = getApplicationContext();

        boolean fresh = (sWeb == null);
        if (fresh) {
            buildWeb();
            if (savedInstanceState != null) {
                try { sWeb.restoreState(savedInstanceState); } catch (Exception e) { Log.w(TAG, "restoreState", e); }
            }
        }

        /* the file chooser must always point at the *current* Activity */
        chooser = new FileChooser(this);
        sWeb.setWebChromeClient(chooser);

        attach();

        if (sWeb.getUrl() == null) {
            sLoaded = false;
            sWeb.loadUrl(HOME);
        } else if (sLoaded) {
            /* the page is still alive (music kept playing) - just re-deliver anything pending */
            deliverToken();
            flushCmd();
        }

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                if (sWeb != null && sWeb.canGoBack()) sWeb.goBack();
                else moveTaskToBack(true);      // "close" = go to background, never kill the song
            }
        });

        if (Build.VERSION.SDK_INT >= 33
                && ContextCompat.checkSelfPermission(this, "android.permission.POST_NOTIFICATIONS")
                != PackageManager.PERMISSION_GRANTED) {
            try {
                ActivityCompat.requestPermissions(this,
                        new String[]{"android.permission.POST_NOTIFICATIONS"}, 1);
            } catch (Exception e) { Log.w(TAG, "notification permission", e); }
        }

        handleIntent(getIntent());
    }

    /** Builds a brand-new WebView and stores it in the static holder. */
    private void buildWeb() {
        /* Application context on purpose: this WebView outlives the Activity, and holding an
           Activity context forever would leak the whole window. */
        WebView w = new WebView(getApplicationContext());
        sWeb = w;

        if (sLoader == null) {
            sLoader = new WebViewAssetLoader.Builder()
                    .setDomain(WebViewAssetLoader.DEFAULT_DOMAIN)
                    .addPathHandler("/", new WebViewAssetLoader.AssetsPathHandler(getApplicationContext()))
                    .build();
        }

        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        /* the app is https-only (usesCleartextTraffic=false); keep it that way, but by NAME so the
           intent is obvious (the old code passed the bare number 1 == NEVER_ALLOW). */
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setLoadsImagesAutomatically(true);
        s.setSupportMultipleWindows(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);

        WebView.setWebContentsDebuggingEnabled(false);

        w.setBackgroundColor(0xFF07131B);        // same dark colour the old build used (-16316405)
        w.setOverScrollMode(WebView.OVER_SCROLL_NEVER);
        w.addJavascriptInterface(new Bridge(), "LMNative");
        w.setWebViewClient(new Client());

        /* Bug 2A: IMPORTANT + waived. The renderer is not throttled/frozen in the background any
           more, so the 1 s JS tick, the preload and the media-session sync keep running. */
        if (Build.VERSION.SDK_INT >= 26) {
            try {
                w.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, true);
            } catch (Throwable t) { Log.w(TAG, "renderer priority", t); }
        }
        sLoaded = false;
    }

    /** Puts the (possibly still playing) WebView back on screen. */
    private void attach() {
        if (sWeb == null) return;
        try {
            if (sWeb.getParent() instanceof android.view.ViewGroup) {
                ((android.view.ViewGroup) sWeb.getParent()).removeView(sWeb);
            }
        } catch (Exception e) { Log.w(TAG, "detach old parent", e); }
        setContentView(sWeb);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    @Override
    protected void onResume() {
        super.onResume();
        sAct = this;
        if (sWeb != null) {
            try { sWeb.onResume(); } catch (Exception ignored) { }
            try { sWeb.resumeTimers(); } catch (Exception ignored) { }
        }
        /* the "install unknown apps" screen was open - continue the pending update */
        if (pendingUpdate != null
                && (Build.VERSION.SDK_INT < 26 || getPackageManager().canRequestPackageInstalls())) {
            String[] p = pendingUpdate;
            pendingUpdate = null;
            downloadUpdate(p[0], p[1]);
        }
    }

    @Override
    protected void onPause() {
        /* NOTE: we deliberately do NOT call web.onPause() / pauseTimers(). That is what stops
           JS timers and, on many devices, the audio element as well. */
        super.onPause();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (sWeb != null && sWeb.getUrl() != null) {
            try { sWeb.saveState(outState); } catch (Exception e) { Log.w(TAG, "saveState", e); }
        }
    }

    @Override
    protected void onDestroy() {
        /* Bug 1: NOTHING here may stop the service or the song.
           - the old code called PlaybackService.update(ctx,"","",false) -> stopService()
           - the old code called web.destroy() unconditionally
           Both are gone. */
        if (updateDone != null) {
            try { unregisterReceiver(updateDone); } catch (Exception ignored) { }
            updateDone = null;
        }
        if (sAct == this) sAct = null;

        if (sWeb != null) {
            if (PlaybackService.isPlaying()) {
                /* keep the WebView (and the audio) alive; just take it off the dying window */
                try {
                    if (sWeb.getParent() instanceof android.view.ViewGroup) {
                        ((android.view.ViewGroup) sWeb.getParent()).removeView(sWeb);
                    }
                } catch (Exception e) { Log.w(TAG, "detach", e); }
                Log.i(TAG, "Activity destroyed - WebView kept alive, music continues");
            } else {
                /* nothing is playing: free the memory */
                try {
                    if (sWeb.getParent() instanceof android.view.ViewGroup) {
                        ((android.view.ViewGroup) sWeb.getParent()).removeView(sWeb);
                    }
                    sWeb.destroy();
                } catch (Exception e) { Log.w(TAG, "destroy", e); }
                sWeb = null;
                sLoaded = false;
                sCmdQ.clear();
            }
        }
        super.onDestroy();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FileChooser.REQ && chooser != null) {
            chooser.handle(resultCode, data);
        }
    }

    /* ─────────────── deep link / token ─────────────── */

    private void handleIntent(Intent i) {
        if (i == null) return;
        Uri data = i.getData();
        if (data == null) return;
        if (!"legacymusic".equals(data.getScheme()) || !"auth".equals(data.getHost())) return;
        String token = data.getQueryParameter("token");
        if (token == null || !TOKEN_RE.matcher(token).matches()) return;
        sToken = token;
        deliverToken();
    }

    private void deliverToken() {
        String t = sToken;
        if (t == null || !sLoaded) return;
        sToken = null;
        js("window.lmOnToken && window.lmOnToken(" + JSONObject.quote(t) + ")");
    }

    /* ─────────────── JS bridge (main thread) ─────────────── */

    private void js(final String code) {
        UI.post(new Runnable() {
            @Override public void run() {
                WebView w = sWeb;
                if (w == null) return;
                try { w.evaluateJavascript(code, null); } catch (Exception e) { Log.w(TAG, "js", e); }
            }
        });
    }

    /**
     * Called by PlaybackService when the MediaSession / notification sends a command.
     * Works whether or not an Activity is currently on screen, because the WebView is static.
     */
    public static void deliverCmd(final String cmd) {
        if (cmd == null || cmd.length() == 0) return;
        UI.post(new Runnable() {
            @Override public void run() {
                WebView w = sWeb;
                if (w == null || !sLoaded) {
                    synchronized (sCmdQ) {
                        if (sCmdQ.size() < 32) sCmdQ.add(cmd);
                    }
                    return;
                }
                try {
                    w.evaluateJavascript("window.lmCmd && window.lmCmd(" + JSONObject.quote(cmd) + ")", null);
                } catch (Exception e) { Log.w(TAG, "deliverCmd", e); }
            }
        });
    }

    private static void flushCmd() {
        UI.post(new Runnable() {
            @Override public void run() {
                WebView w = sWeb;
                if (w == null || !sLoaded) return;
                String c;
                while (true) {
                    synchronized (sCmdQ) {
                        c = sCmdQ.poll();
                    }
                    if (c == null) break;
                    try {
                        w.evaluateJavascript("window.lmCmd && window.lmCmd(" + JSONObject.quote(c) + ")", null);
                    } catch (Exception e) { Log.w(TAG, "flushCmd", e); }
                }
            }
        });
    }

    /* ─────────────── external links ─────────────── */

    private void openExternal(String url) {
        try {
            Uri u = Uri.parse(url);
            String sc = u.getScheme();
            if ("https".equals(sc) || "http".equals(sc)) {
                startActivity(new Intent(Intent.ACTION_VIEW, u).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            }
        } catch (Exception e) { Log.w(TAG, "openExternal", e); }
    }

    private void openTab(String url) {
        try {
            new CustomTabsIntent.Builder().build().launchUrl(this, Uri.parse(url));
        } catch (Exception e) {
            openExternal(url);
        }
    }

    /* ─────────────── self-update ─────────────── */

    private void downloadUpdate(String url, String sha256) {
        if (Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
            pendingUpdate = new String[]{url, sha256};
            js("toast && toast('Allow \"Install unknown apps\" for Legacy Music, then come back')");
            try {
                startActivity(new Intent("android.settings.MANAGE_UNKNOWN_APP_SOURCES",
                        Uri.parse("package:" + getPackageName())));
            } catch (Exception e) { Log.w(TAG, "unknown-sources screen", e); }
            return;
        }
        File dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (dir == null) return;
        final File file = new File(dir, "LegacyMusic-update.apk");
        if (file.exists() && !file.delete()) Log.w(TAG, "could not delete old apk");
        try {
            DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            if (dm == null) return;
            long id = dm.enqueue(new DownloadManager.Request(Uri.parse(url))
                    .setTitle("Legacy Music update")
                    .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    .setDestinationUri(Uri.fromFile(file)));
            if (updateDone != null) {
                try { unregisterReceiver(updateDone); } catch (Exception ignored) { }
            }
            updateDone = new UpdateDone(id, file, sha256);
            IntentFilter f = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
            if (Build.VERSION.SDK_INT >= 33) {
                registerReceiver(updateDone, f, Context.RECEIVER_NOT_EXPORTED);
            } else {
                ContextCompat.registerReceiver(this, updateDone, f, ContextCompat.RECEIVER_NOT_EXPORTED);
            }
        } catch (Exception e) {
            Log.w(TAG, "downloadUpdate", e);
        }
    }

    private String sha256Of(File f) {
        FileInputStream in = null;
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            in = new FileInputStream(f);
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) md.update(buf, 0, n);
            byte[] d = md.digest();
            StringBuilder sb = new StringBuilder(d.length * 2);
            for (byte b : d) sb.append(String.format(Locale.US, "%02x", b));
            return sb.toString();
        } catch (Exception e) {
            Log.w(TAG, "sha256Of", e);
            return "";
        } finally {
            try { if (in != null) in.close(); } catch (Exception ignored) { }
        }
    }

    /** Receives DownloadManager.ACTION_DOWNLOAD_COMPLETE for our update file. */
    private final class UpdateDone extends BroadcastReceiver {
        private final long id;
        private final File file;
        private final String sha;

        UpdateDone(long id, File file, String sha) {
            this.id = id;
            this.file = file;
            this.sha = sha;
        }

        @Override public void onReceive(Context context, Intent intent) {
            try {
                if (intent == null) return;
                long got = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L);
                if (got != id) return;
                try { unregisterReceiver(this); } catch (Exception ignored) { }
                updateDone = null;
                if (!file.exists() || file.length() < 100000) {
                    js("toast && toast('Update download failed')");
                    return;
                }
                final String want = sha == null ? "" : sha.trim().toLowerCase(Locale.US);
                new Thread(new Runnable() {
                    @Override public void run() {
                        final String have = sha256Of(file);
                        UI.post(new Runnable() {
                            @Override public void run() {
                                if (want.length() > 0 && !want.equals(have)) {
                                    js("toast && toast('Update file is corrupt - try again')");
                                    return;
                                }
                                try {
                                    Uri apk = androidx.core.content.FileProvider.getUriForFile(
                                            MainActivity.this,
                                            getPackageName() + ".fileprovider", file);
                                    Intent i = new Intent(Intent.ACTION_VIEW)
                                            .setDataAndType(apk, "application/vnd.android.package-archive")
                                            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                                                    | Intent.FLAG_ACTIVITY_NEW_TASK);
                                    startActivity(i);
                                } catch (Exception e) {
                                    Log.w(TAG, "install update", e);
                                }
                            }
                        });
                    }
                }, "lm-sha").start();
            } catch (Exception e) {
                Log.w(TAG, "UpdateDone", e);
            }
        }
    }

    /* ─────────────── WebViewClient ─────────────── */

    private static final class Client extends WebViewClient {

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            try {
                if (sLoader != null && request != null) {
                    return sLoader.shouldInterceptRequest(request.getUrl());
                }
            } catch (Exception e) { Log.w(TAG, "intercept", e); }
            return null;
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            try {
                if (request == null || request.getUrl() == null) return false;
                if (WebViewAssetLoader.DEFAULT_DOMAIN.equals(request.getUrl().getHost())) return false;
                MainActivity a = sAct;
                if (a != null) a.openExternal(request.getUrl().toString());
                return true;
            } catch (Exception e) { return false; }
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            sLoaded = true;
            MainActivity a = sAct;
            if (a != null) a.deliverToken();
            flushCmd();
        }

        /**
         * Bug 4: the WebView renderer crashed (out of memory, GPU reset, Chromium bug).
         * Without this the surface stays black/white forever. We throw the dead WebView away,
         * build a fresh one and reload. The player restores the last song from localStorage
         * (and now also whether it was playing), so the music comes back instead of a dead screen.
         */
        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            boolean crashed = detail != null && detail.didCrash();
            Log.e(TAG, "WebView renderer gone (crashed=" + crashed + ") - rebuilding");
            try {
                if (view != null) {
                    if (view.getParent() instanceof android.view.ViewGroup) {
                        ((android.view.ViewGroup) view.getParent()).removeView(view);
                    }
                    view.destroy();
                }
            } catch (Exception e) { Log.w(TAG, "kill dead webview", e); }

            if (sWeb == view) {
                sWeb = null;
                sLoaded = false;
            }

            MainActivity a = sAct;
            if (a == null || a.isFinishing()) return true;   // nothing on screen: next onCreate rebuilds
            try {
                a.buildWeb();
                a.chooser = new FileChooser(a);
                sWeb.setWebChromeClient(a.chooser);
                a.attach();
                sWeb.loadUrl(HOME);
            } catch (Exception e) {
                Log.e(TAG, "could not rebuild WebView", e);
            }
            return true;   // we handled it - do NOT let the framework kill the app
        }
    }

    /* ─────────────── JS → native bridge ─────────────── */

    /**
     * NOTE: this is a STATIC class on purpose. The WebView outlives the Activity, and an inner
     * (non-static) bridge would keep the destroyed Activity - and its whole window - alive for as
     * long as the music plays. It talks to the current Activity through sAct instead.
     */
    public static final class Bridge {

        @JavascriptInterface
        public String base() {
            return SERVER;
        }

        @JavascriptInterface
        public void announce(String title, String text) {
            Context c = sApp != null ? sApp : (sAct != null ? sAct : null);
            if (c != null) Announcer.post(c, title, text);
        }

        @JavascriptInterface
        public void login(final String url) {
            if (url == null || !url.startsWith(SERVER + "/")) return;
            final MainActivity a = sAct;
            if (a == null) return;
            a.runOnUiThread(new Runnable() {
                @Override public void run() { a.openTab(url); }
            });
        }

        @JavascriptInterface
        public void open(final String url) {
            if (url == null) return;
            final MainActivity a = sAct;
            if (a == null) {
                try {
                    Uri u = Uri.parse(url);
                    String sc = u.getScheme();
                    if (("https".equals(sc) || "http".equals(sc)) && sApp != null) {
                        sApp.startActivity(new Intent(Intent.ACTION_VIEW, u)
                                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                    }
                } catch (Exception e) { Log.w(TAG, "open (no activity)", e); }
                return;
            }
            a.runOnUiThread(new Runnable() {
                @Override public void run() { a.openExternal(url); }
            });
        }

        @JavascriptInterface
        public void update(final String url, final String sha256) {
            if (url == null || !url.startsWith(SERVER + "/download/app.apk")) return;
            final MainActivity a = sAct;
            if (a == null) return;
            a.runOnUiThread(new Runnable() {
                @Override public void run() { a.downloadUpdate(url, sha256 == null ? "" : sha256); }
            });
        }

        /**
         * Bug 3: the old build accepted `thumb` but never used it, and dropped the JSON payload
         * (position / duration / artwork / liked / shuffle / speed) completely, so the native side
         * had no idea where the song really was. Everything is forwarded now.
         */
        @JavascriptInterface
        public void nowPlaying(String title, String artist, boolean playing, String json) {
            Context c = sApp != null ? sApp : (sAct != null ? sAct : null);
            if (c == null) return;
            PlaybackService.update(c,
                    title == null ? "" : title,
                    artist == null ? "" : artist,
                    playing,
                    json == null ? "" : json);
        }
    }
}
