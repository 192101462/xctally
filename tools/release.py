#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""xctally 一键发版脚本
==========================================================
写完代码之后，跑一条命令就完成整个发版：

    python tools/release.py 1.1 "这次更新了什么"

它会依次：
  1. versionCode 自动 +1，versionName 写成 1.1（apps/android/app/build.gradle.kts）
  2. 打【签名】的 release APK（需要 apps/android/keystore.properties，见 README 第八节）
  3. 打 git 标签 v1.1
  4. 调 Gitee API 创建 Release 并上传 APK 附件（需要私人令牌，见下）
  5. 把直链和更新说明写进 apps/android/version.json（App 内"检查更新"读的就是它）
  6. 提交并推送全部改动（含标签）

令牌：Gitee → 设置 → 私人令牌 → 生成（只勾 projects 权限），
      存到 tools/.gitee_token（文件里只有令牌一行，已被 .gitignore 忽略），
      或设置环境变量 GITEE_TOKEN。令牌只在本机使用，不要发给任何人。

测试模式（不传 Gitee、不推 git，只在本地构建验证）：
    python tools/release.py 1.1 "test" --skip-upload --skip-push
"""
import json
import os
import re
import subprocess
import sys
import urllib.request
import urllib.error
import uuid

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ANDROID = os.path.join(ROOT, "apps", "android")
GRADLE = os.path.join(ANDROID, "gradlew.bat")
BUILD_GRADLE = os.path.join(ANDROID, "app", "build.gradle.kts")
VERSION_JSON = os.path.join(ANDROID, "version.json")
TOKEN_FILE = os.path.join(ROOT, "tools", ".gitee_token")

# 仓库坐标：默认本仓库；需要改就在 tools/release.config.json 里写 {"owner": "...", "repo": "..."}
OWNER, REPO = "qiyu_server", "xctally"
cfg_file = os.path.join(ROOT, "tools", "release.config.json")
if os.path.exists(cfg_file):
    _c = json.load(open(cfg_file, encoding="utf-8"))
    OWNER = _c.get("owner", OWNER)
    REPO = _c.get("repo", REPO)


def die(msg):
    print("[FAIL] " + msg)
    sys.exit(1)


def sh(cmd, cwd=None):
    """跑命令，失败即停并打印输出（Windows 下用字符串走 shell）"""
    if os.name == "nt":
        cmd = subprocess.list2cmdline(cmd) if isinstance(cmd, list) else cmd
        r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, shell=True)
    else:
        r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stdout[-3000:] if r.stdout else "")
        print(r.stderr[-3000:] if r.stderr else "")
        die("command failed: " + " ".join(cmd) if isinstance(cmd, list) else cmd)
    return r.stdout


def find_java():
    """JAVA_HOME 坏掉时，自动挑本机 .jdks 下的 JDK 17+"""
    env = dict(os.environ)
    jh = env.get("JAVA_HOME", "")
    if os.path.exists(os.path.join(jh, "bin", "java.exe")):
        return env
    jdks = os.path.join(os.path.expanduser("~"), ".jdks")
    cand = []
    if os.path.isdir(jdks):
        for n in os.listdir(jdks):
            if os.path.exists(os.path.join(jdks, n, "bin", "java.exe")):
                cand.append(n)
    cand.sort(reverse=True)          # 版本号大的在前
    for n in cand:
        if n.startswith(("ms-17", "ms-21", "jbr")) or "17" in n or "21" in n:
            env["JAVA_HOME"] = os.path.join(jdks, n)
            print("[info ] JAVA_HOME invalid, using " + env["JAVA_HOME"])
            return env
    if cand:
        env["JAVA_HOME"] = os.path.join(jdks, cand[0])
        print("[info ] JAVA_HOME invalid, using " + env["JAVA_HOME"])
        return env
    return env                       # 让 gradle 自己报错


def read_token():
    if os.environ.get("GITEE_TOKEN"):
        return os.environ["GITEE_TOKEN"].strip()
    if os.path.exists(TOKEN_FILE):
        return open(TOKEN_FILE, encoding="utf-8").read().strip()
    return ""


def api(url, token, data=None, is_json=True, multipart=None):
    """POST/GET gitee api v5；multipart 为 (filename, bytes) 时走表单上传"""
    if data is None:
        data = {}
    if is_json and multipart is None:
        body = json.dumps(data).encode()
        req = urllib.request.Request(url, data=body,
                                     headers={"Content-Type": "application/json"})
    else:
        bound = "----" + uuid.uuid4().hex
        parts = []
        fields = dict(data)
        fields["access_token"] = token
        for k, v in fields.items():
            parts.append(('--%s\r\nContent-Disposition: form-data; name="%s"\r\n\r\n%s'
                          % (bound, k, v)).encode())
        if multipart:
            fn, blob = multipart
            parts.append(('--%s\r\nContent-Disposition: form-data; name="file"; '
                          'filename="%s"\r\nContent-Type: application/octet-stream\r\n\r\n'
                          % (bound, fn)).encode() + blob + b"\r\n")
        body = b"\r\n".join(parts) + b"\r\n--%s--\r\n" % bound.encode()
        req = urllib.request.Request(url, data=body,
                                     headers={"Content-Type": "multipart/form-data; boundary=" + bound})
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        try:
            detail = e.read().decode()[:500]
        except Exception:
            detail = ""
        die("gitee api %s -> HTTP %s %s" % (url, e.code, detail))


def main():
    args = sys.argv[1:]
    if len(args) < 2:
        print(__doc__)
        die("usage: python tools/release.py <version> <notes> [--skip-upload] [--skip-push]")
    ver, notes = args[0], args[1]
    skip_upload = "--skip-upload" in args
    skip_push = "--skip-push" in args
    if not re.match(r"^\d+(\.\d+)*$", ver):
        die("version must look like 1.1 / 1.0.2, got: " + ver)

    ks = os.path.join(ANDROID, "keystore.properties")
    if not os.path.exists(ks):
        die("keystore.properties not found.\nFirst-time setup (once): see apps/android/README.md section 8\n  keytool -genkeypair -v -keystore apps/android/release.jks -alias xctally -keyalg RSA -keysize 2048 -validity 10950\nthen create apps/android/keystore.properties with storeFile/storePassword/keyAlias/keyPassword.")

    token = read_token()
    if not skip_upload and not token:
        die("gitee token missing. Create one at gitee.com -> settings -> private access token (projects scope),\nthen either set env GITEE_TOKEN or save it into tools/.gitee_token (gitignored).")

    # 1) bump version ---------------------------------------------------------
    src = open(BUILD_GRADLE, encoding="utf-8").read()
    m = re.search(r"versionCode = (\d+)", src)
    old_code = int(m.group(1))
    new_code = old_code + 1
    src = re.sub(r"versionCode = \d+", "versionCode = %d" % new_code, src)
    src = re.sub(r'versionName = "[^"]*"', 'versionName = "%s"' % ver, src)
    open(BUILD_GRADLE, "w", encoding="utf-8", newline="\n").write(src)
    print("[1/6] version %d -> %d, versionName -> %s" % (old_code, new_code, ver))

    # 2) build release ---------------------------------------------------------
    print("[2/6] building release apk ...")
    env = find_java()
    gradle_cmd = GRADLE if os.name == "nt" else os.path.join(ANDROID, "gradlew")
    r = subprocess.run([gradle_cmd, "assembleRelease", "--console=plain", "-q"],
                       cwd=ANDROID, capture_output=True, text=True,
                       shell=(os.name == "nt"), env=env)
    if r.returncode != 0:
        print((r.stdout or "")[-3000:])
        print((r.stderr or "")[-3000:])
        die("gradle assembleRelease failed (see output above)")
    apk = os.path.join(ANDROID, "app", "build", "outputs", "apk", "release", "app-release.apk")
    if not os.path.exists(apk):
        die("signed apk missing: " + apk + " (check keystore.properties)")
    size = os.path.getsize(apk)
    print("      apk ok: app-release.apk (%.1f MB)" % (size / 1048576))

    # 3) tag -------------------------------------------------------------------
    tag = "v" + ver
    print("[3/6] git tag " + tag)
    sh(["git", "tag", "-f", tag], cwd=ROOT)

    apk_url = ""
    if not skip_upload:
        # 4) gitee release + attachment -----------------------------------------
        print("[4/6] creating gitee release " + tag + " ...")
        rel = api("https://gitee.com/api/v5/repos/%s/%s/releases" % (OWNER, REPO), token,
                  data={"tag_name": tag, "name": tag, "body": notes,
                        "target_commitish": "main"})
        print("      release id=" + str(rel.get("id")))
        fn = "xctally-%s.apk" % ver
        att = api("https://gitee.com/api/v5/repos/%s/%s/releases/%s/attach_files"
                  % (OWNER, REPO, rel["id"]), token, data={},
                  is_json=False, multipart=(fn, open(apk, "rb").read()))
        print("      attach: " + json.dumps(att, ensure_ascii=False)[:300])
        apk_url = "https://gitee.com/%s/%s/releases/download/%s/%s" % (OWNER, REPO, tag, fn)
    else:
        print("[4/6] skipped (--skip-upload)")

    # 5) version.json -----------------------------------------------------------
    print("[5/6] updating apps/android/version.json")
    vj = {"versionCode": new_code, "versionName": ver, "apkUrl": apk_url, "notes": notes}
    open(VERSION_JSON, "w", encoding="utf-8", newline="\n").write(
        json.dumps(vj, ensure_ascii=False, indent=2) + "\n")

    # 6) commit & push -----------------------------------------------------------
    if skip_push:
        print("[6/6] skipped (--skip-push) — remember to commit manually:")
        print("      git add -A && git commit -m \"release %s\" && git push --tags origin main" % tag)
    else:
        print("[6/6] commit & push")
        sh(["git", "add", "-A"], cwd=ROOT)
        sh(["git", "commit", "-m", "release %s (versionCode %d)" % (tag, new_code)], cwd=ROOT)
        sh(["git", "push", "origin", "main", "--tags"], cwd=ROOT)
        print("      pushed.")

    print("\nDONE. app-release.apk -> gitee release %s\napk url: %s" % (tag, apk_url or "(not uploaded)"))
    print("phones: settings -> check for update")


if __name__ == "__main__":
    main()
