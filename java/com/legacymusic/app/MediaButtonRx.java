package com.legacymusic.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;
import android.view.KeyEvent;

/**
 * MediaButtonRx.java  (NEW FILE)
 *
 * Bug 3: the old manifest had no media-button receiver at all. On API 21+ the system normally
 * delivers headset / Bluetooth buttons straight to an ACTIVE MediaSession, but when the session is
 * momentarily inactive (or an OEM routes the key through a broadcast) the press was simply lost.
 *
 * This receiver translates the key into the same command the notification buttons use, so
 * play/pause/next/previous from a headset, a car kit or a Bluetooth speaker always reach the player.
 */
public final class MediaButtonRx extends BroadcastReceiver {

    private static final String TAG = "LMMediaButton";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (context == null || intent == null) return;
        try {
            if (!Intent.ACTION_MEDIA_BUTTON.equals(intent.getAction())) return;
            KeyEvent e = (KeyEvent) intent.getParcelableExtra(Intent.EXTRA_KEY_EVENT);
            if (e == null || e.getAction() != KeyEvent.ACTION_DOWN) return;

            String cmd = null;
            switch (e.getKeyCode()) {
                case KeyEvent.KEYCODE_MEDIA_PLAY:
                    cmd = "play";
                    break;
                case KeyEvent.KEYCODE_MEDIA_PAUSE:
                    cmd = "pause";
                    break;
                case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
                case KeyEvent.KEYCODE_HEADSETHOOK:
                    cmd = "toggle";
                    break;
                case KeyEvent.KEYCODE_MEDIA_NEXT:
                    cmd = "next";
                    break;
                case KeyEvent.KEYCODE_MEDIA_PREVIOUS:
                    cmd = "prev";
                    break;
                case KeyEvent.KEYCODE_MEDIA_STOP:
                    cmd = "pause";
                    break;
                default:
                    break;
            }
            if (cmd == null) return;
            Log.i(TAG, "media button -> " + cmd);
            PlaybackService.sendCmd(context, cmd);
        } catch (Exception ex) {
            Log.w(TAG, "media button failed", ex);
        }
    }
}
