#!/usr/bin/env python3
"""Compile ./java/*.java and inject them into the unsigned APK made by tools/build.py.

Why: this repo has no Kotlin/Java source - classes.dex is already compiled. The 5 fixed classes
(MainActivity, PlaybackService, Announcer, FileChooser, MediaButtonRx) live in ./java and are
compiled here against the app's OWN classes, then:
  * the new classes become classes.dex  (Android loads classes.dex first, so they win)
  * the old classes.dex becomes classes2.dex (everything else keeps working)
  * AndroidManifest.xml gets  stopWithTask=false  on the service + the MediaButtonRx receiver
    (only the manifest is taken from the apktool rebuild; resources.arsc stays the original -
     the resource IDs were checked to be identical)

usage: python3 tools/inject_java.py build/unsigned.apk [out.apk]      (default: in place)
Needs: java + javac 17, python3, internet (downloads android.jar, dex2jar, apktool once).
"""
import glob, os, re, shutil, subprocess, sys, urllib.request, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APK_IN = os.path.abspath(sys.argv[1])
APK_OUT = os.path.abspath(sys.argv[2]) if len(sys.argv) > 2 else APK_IN
WORK = os.path.join(ROOT, "build", "inject")
TOOLS = os.path.join(ROOT, "build", "tools")
JAVA_SRC = sorted(glob.glob(os.path.join(ROOT, "java", "**", "*.java"), recursive=True))

URLS = {
    "android.jar": "https://github.com/Sable/android-platforms/raw/master/android-34/android.jar",
    "dex2jar.zip": "https://github.com/pxb1988/dex2jar/releases/download/v2.4/dex-tools-v2.4.zip",
    "apktool.jar": "https://github.com/iBotPeaches/Apktool/releases/download/v2.9.3/apktool_2.9.3.jar",
}


def run(cmd, **kw):
    print("+", " ".join(cmd) if isinstance(cmd, list) else cmd, flush=True)
    r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, **kw)
    out = "\n".join(l for l in r.stdout.splitlines() if "JAVA_TOOL_OPTIONS" not in l)
    if r.returncode != 0:
        print(out)
        sys.exit(f"FAILED ({r.returncode}): {cmd}")
    return out


def fetch(name):
    p = os.path.join(TOOLS, name)
    if os.path.exists(p) and os.path.getsize(p) > 1_000_000:
        return p
    os.makedirs(TOOLS, exist_ok=True)
    for i in range(3):
        try:
            print("downloading", URLS[name], flush=True)
            urllib.request.urlretrieve(URLS[name], p)
            if os.path.getsize(p) > 1_000_000:
                return p
        except Exception as e:
            print("retry:", e)
    sys.exit(f"could not download {name}")


if not JAVA_SRC:
    sys.exit("no .java files in ./java - nothing to inject")
shutil.rmtree(WORK, ignore_errors=True)
os.makedirs(WORK)

android_jar = fetch("android.jar")
apktool = fetch("apktool.jar")
d2j_zip = fetch("dex2jar.zip")
d2j_dir = os.path.join(TOOLS, "dex-tools-v2.4")
if not os.path.isdir(d2j_dir):
    with zipfile.ZipFile(d2j_zip) as z:
        z.extractall(TOOLS)
    d2j_dir = glob.glob(os.path.join(TOOLS, "dex-tools*"))[0]

# 1. the app's own classes (for compiling against): classes.dex -> jar, class version 50 -> 52
with zipfile.ZipFile(APK_IN) as z:
    names = z.namelist()
    open(os.path.join(WORK, "orig.dex"), "wb").write(z.read("classes.dex"))
if any(re.fullmatch(r"classes\d+\.dex", n) for n in names):
    sys.exit("the APK already has classes2.dex - this script expects a single classes.dex")
run(["bash", os.path.join(d2j_dir, "d2j-dex2jar.sh"), "-f", "-o", os.path.join(WORK, "app.jar"), os.path.join(WORK, "orig.dex")])
with zipfile.ZipFile(os.path.join(WORK, "app.jar")) as src, \
        zipfile.ZipFile(os.path.join(WORK, "app52.jar"), "w", zipfile.ZIP_DEFLATED) as dst:
    for i in src.infolist():
        d = src.read(i.filename)
        if i.filename.endswith(".class") and d[:4] == b"\xca\xfe\xba\xbe":
            d = d[:6] + b"\x00\x34" + d[8:]
        dst.writestr(i.filename, d)

# 2. javac  (-source 7: no lambdas, so the plain dx converter can make the dex)
cls = os.path.join(WORK, "classes")
os.makedirs(cls)
out = run(["javac", "-encoding", "UTF-8", "-nowarn", "-source", "7", "-target", "7",
           "-bootclasspath", android_jar, "-classpath", os.path.join(WORK, "app52.jar"), "-d", cls] + JAVA_SRC)
nclass = len(glob.glob(os.path.join(cls, "**", "*.class"), recursive=True))
print(f"compiled {len(JAVA_SRC)} java files -> {nclass} classes")
run(["jar", "cf", os.path.join(WORK, "new.jar"), "-C", cls, "."])
run(["bash", os.path.join(d2j_dir, "d2j-jar2dex.sh"), "-f", "-o", os.path.join(WORK, "new.dex"), os.path.join(WORK, "new.jar")])
new_dex = open(os.path.join(WORK, "new.dex"), "rb").read()
assert new_dex[:4] == b"dex\n", "new.dex is not a dex file"

# 3. manifest: text edit through apktool, then take ONLY the binary manifest of the rebuild
dec = os.path.join(WORK, "dec")
run(["java", "-jar", apktool, "d", "-s", "-f", "-o", dec, APK_IN])
mp = os.path.join(dec, "AndroidManifest.xml")
t = open(mp, encoding="utf-8").read()
if "stopWithTask" not in t:
    m = re.search(r'<service\b[^>]*android:name="com\.legacymusic\.app\.PlaybackService"[^>]*?/>', t)
    assert m, "PlaybackService <service> not found in manifest"
    t = t[:m.end() - 2] + ' android:stopWithTask="false"' + t[m.end() - 2:]
if "MediaButtonRx" not in t:
    rx = ('\n        <receiver android:enabled="true" android:exported="true" android:name="com.legacymusic.app.MediaButtonRx">'
          '\n            <intent-filter>\n                <action android:name="android.intent.action.MEDIA_BUTTON"/>'
          '\n            </intent-filter>\n        </receiver>')
    m = re.search(r'<service\b[^>]*android:name="com\.legacymusic\.app\.PlaybackService"[^>]*?/>', t)
    t = t[:m.end()] + rx + t[m.end():]
open(mp, "w", encoding="utf-8").write(t)
rebuilt = os.path.join(WORK, "rebuilt.apk")
run(["java", "-jar", apktool, "b", "-f", "-o", rebuilt, dec])
with zipfile.ZipFile(rebuilt) as z:
    new_manifest = z.read("AndroidManifest.xml")

# 4. assemble: manifest swapped, new classes.dex first, old one kept as classes2.dex
tmp = APK_OUT + ".tmp"
with zipfile.ZipFile(APK_IN) as zin, zipfile.ZipFile(tmp, "w") as zout:
    def put(info, data):
        zi = zipfile.ZipInfo(info.filename, (2026, 1, 1, 0, 0, 0))
        zi.compress_type = info.compress_type
        zi.external_attr = info.external_attr
        zout.writestr(zi, data)
    for info in zin.infolist():
        data = zin.read(info.filename)
        if info.filename == "AndroidManifest.xml":
            put(info, new_manifest)
        elif info.filename == "classes.dex":
            put(info, new_dex)
            i2 = zipfile.ZipInfo("classes2.dex"); i2.compress_type = info.compress_type; i2.external_attr = info.external_attr
            put(i2, data)
        else:
            put(info, data)
os.replace(tmp, APK_OUT)
with zipfile.ZipFile(APK_OUT) as z:
    assert z.testzip() is None
    print("OK:", APK_OUT, "->", [n for n in z.namelist() if n.endswith(".dex")], "manifest", len(new_manifest), "bytes")
