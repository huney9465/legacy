# Legacy Music APK (repack project)

`apk/` = the unpacked app. `apk/packed.zip` holds res/, kotlin/, META-INF (packed only to keep the GitHub web upload under 100 files; nothing removed). Loose files (manifest, classes.dex, resources.arsc, assets/) are editable.
`tools/build.py` repacks it, GitHub Actions zipaligns + signs it (v2+v3).

## Release
1. Edit web files in `apk/assets/` if needed (same length rule below applies only to VERSION).
2. Change `VERSION` (e.g. 22.3 -> 22.4). Must stay like `NN.N` (same length as `tools/BASE_VERSION`).
3. Commit / upload to GitHub -> Actions -> "Build signed Legacy Music APK" -> download artifact `LegacyMusic-apk`.
4. Upload that APK in the website. Also set `APP_VERSION` in pwa.py to the same version.

## Signing key (IMPORTANT)
Add these repository secrets (Settings -> Secrets and variables -> Actions):
- `KEYSTORE_BASE64` : `base64 -w0 your.keystore`
- `KEYSTORE_PASSWORD`, `KEY_ALIAS` (and `KEY_PASSWORD` if different)

Use the SAME keystore as the live release, so phones can update without uninstalling.
If the secret is missing, the workflow makes a new key and uploads it as `NEW-KEYSTORE-SAVE-THIS`.

Note: classes.dex is already compiled - Kotlin/Android source is not part of this repo.
