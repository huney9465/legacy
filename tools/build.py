#!/usr/bin/env python3
"""Repack ./apk/ into an UNSIGNED apk with the version from ./VERSION.

Patches (all from BASE_VERSION -> VERSION, same length required, e.g. 22.3 -> 22.4):
  - AndroidManifest.xml : versionName + versionCode (major*10000 + minor*100)
  - assets/static/pwa/app.js : header "(vX.Y)" and  const CV = 'X.Y'
  - assets/index.html : app.css?v= / app.js?v=
resources.arsc is stored uncompressed (needed by Android 11+). Signing + zipalign
are done afterwards (see .github/workflows/build.yml).
"""
import os, re, struct, sys, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APK_DIR = os.path.join(ROOT, "apk")
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "build", "unsigned.apk")
read = lambda p: open(os.path.join(ROOT, p)).read().strip()
BASE, NEW = read("tools/BASE_VERSION"), read("VERSION")

def code(v):
    a, b = v.split(".")
    return int(a) * 10000 + int(b) * 100

if not re.fullmatch(r"\d+\.\d+", NEW):
    sys.exit(f"VERSION must look like 22.4, got: {NEW!r}")
if len(NEW) != len(BASE):
    sys.exit(f"VERSION {NEW} must have the same length as the base {BASE} (e.g. 22.4, 22.9, 23.0)")

def patch_manifest(d):
    if NEW == BASE:
        return d
    a = BASE.encode("utf-16le")
    assert d.count(a) == 1, "versionName not found once in manifest"
    d = d.replace(a, NEW.encode("utf-16le"))
    old, new = struct.pack("<I", code(BASE)), struct.pack("<I", code(NEW))
    assert d.count(old) == 1, "versionCode not found once in manifest"
    return d.replace(old, new)

def patch_js(t):
    t = t.replace(f"(v{BASE})", f"(v{NEW})", 1)
    assert f"const CV = '{BASE}';" in t, "const CV not found in app.js"
    return t.replace(f"const CV = '{BASE}';", f"const CV = '{NEW}';")

def patch_html(t):
    return t.replace(f"?v={BASE}", f"?v={NEW}")

os.makedirs(os.path.dirname(OUT), exist_ok=True)
if os.path.exists(OUT):
    os.remove(OUT)
names = []
for dp, _, fs in os.walk(APK_DIR):
    for f in fs:
        names.append(os.path.relpath(os.path.join(dp, f), APK_DIR).replace(os.sep, "/"))
names = [n for n in names if n != "packed.zip"]
names.sort(key=lambda n: (n != "AndroidManifest.xml", n))
# apk/packed.zip = res/, kotlin/, META-INF/ ... packed only so the GitHub web upload has < 100 files (nothing removed)
packed = {}
pz = os.path.join(APK_DIR, "packed.zip")
if os.path.exists(pz):
    with zipfile.ZipFile(pz) as zz:
        for i in zz.infolist():
            if not i.filename.endswith("/"):
                packed[i.filename] = zz.read(i.filename)
assert not (set(packed) & set(names)), "duplicate file in apk/ and apk/packed.zip"
with zipfile.ZipFile(OUT, "w") as z:
    for n in names:
        d = open(os.path.join(APK_DIR, n), "rb").read()
        if n == "AndroidManifest.xml":
            d = patch_manifest(d)
        elif n == "assets/static/pwa/app.js":
            d = patch_js(d.decode()).encode()
        elif n == "assets/index.html":
            d = patch_html(d.decode()).encode()
        zi = zipfile.ZipInfo(n, (2026, 1, 1, 0, 0, 0))
        zi.compress_type = zipfile.ZIP_STORED if n == "resources.arsc" else zipfile.ZIP_DEFLATED
        zi.external_attr = 0o644 << 16
        z.writestr(zi, d)
    for n, d in sorted(packed.items()):
        zi = zipfile.ZipInfo(n, (2026, 1, 1, 0, 0, 0))
        zi.compress_type = zipfile.ZIP_DEFLATED
        zi.external_attr = 0o644 << 16
        z.writestr(zi, d)
print(f"built {OUT}: version {NEW} (code {code(NEW)}), {len(names) + len(packed)} files")
