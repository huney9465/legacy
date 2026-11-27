package com.legacymusic.app;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.util.Log;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebView;

import java.lang.ref.WeakReference;
import java.util.ArrayList;
import java.util.List;

/**
 * FileChooser.java
 *
 * Bug 6 fixes:
 *  - the old class kept the ValueCallback in a STATIC field. If the Activity was re-created (or the
 *    chooser was opened twice) the old callback was overwritten and leaked, and the WebView could
 *    stay "stuck" waiting for a file forever. It is now an instance field, cleared in every path.
 *  - it only accepted "image/*", so the app could not pick an audio file at all. It now honours the
 *    <input accept="..."> attribute, defaults to images + audio, and allows multiple selection.
 *  - ClipData (multi-select) was ignored - only the first Uri was returned. Now every selected file
 *    is returned.
 *  - the Activity reference is a WeakReference so a kept-alive WebView cannot leak the window.
 */
public final class FileChooser extends WebChromeClient {

    public static final int REQ = 4711;
    private static final String TAG = "LMFileChooser";

    private final WeakReference<MainActivity> act;
    private ValueCallback<Uri[]> cb;

    public FileChooser(MainActivity activity) {
        this.act = new WeakReference<MainActivity>(activity);
    }

    @Override
    public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> callback,
                                     FileChooserParams params) {
        /* never leave an old callback hanging */
        if (cb != null) {
            try { cb.onReceiveValue(null); } catch (Exception ignored) { }
            cb = null;
        }
        cb = callback;

        MainActivity a = act.get();
        if (a == null || a.isFinishing()) {
            cb = null;
            if (callback != null) callback.onReceiveValue(null);
            return false;
        }

        try {
            Intent i = new Intent(Intent.ACTION_GET_CONTENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);

            List<String> types = new ArrayList<String>();
            String[] accept = params == null ? null : params.getAcceptTypes();
            if (accept != null) {
                for (String t : accept) {
                    if (t == null) continue;
                    t = t.trim();
                    if (t.length() == 0) continue;
                    /* ".mp3" style extensions -> let the picker decide */
                    if (t.startsWith(".")) { types.clear(); types.add("*/*"); break; }
                    types.add(t);
                }
            }
            if (types.isEmpty()) {
                types.add("image/*");
                types.add("audio/*");
            }
            if (types.size() == 1) {
                i.setType(types.get(0));
            } else {
                i.setType("*/*");
                i.putExtra(Intent.EXTRA_MIME_TYPES, types.toArray(new String[0]));
            }

            a.startActivityForResult(Intent.createChooser(i, "Select file"), REQ);
            return true;
        } catch (Exception e) {
            Log.w(TAG, "could not open the picker", e);
            cb = null;
            if (callback != null) callback.onReceiveValue(null);
            return false;
        }
    }

    /** Called from MainActivity.onActivityResult(). */
    public void handle(int resultCode, Intent data) {
        ValueCallback<Uri[]> c = cb;
        cb = null;
        if (c == null) return;

        Uri[] out = null;
        try {
            if (resultCode == Activity.RESULT_OK && data != null) {
                ClipData clip = data.getClipData();
                if (clip != null && clip.getItemCount() > 0) {
                    out = new Uri[clip.getItemCount()];
                    for (int n = 0; n < clip.getItemCount(); n++) {
                        out[n] = clip.getItemAt(n).getUri();
                    }
                } else if (data.getData() != null) {
                    out = new Uri[]{data.getData()};
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "could not read the picked file", e);
            out = null;
        }
        try { c.onReceiveValue(out); } catch (Exception e) { Log.w(TAG, "callback", e); }
    }

    /** Drops a pending callback (Activity is going away). */
    public void cancel() {
        ValueCallback<Uri[]> c = cb;
        cb = null;
        if (c != null) {
            try { c.onReceiveValue(null); } catch (Exception ignored) { }
        }
    }
}
