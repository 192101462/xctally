#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""云端发布脚本（GitHub Actions 里调用，本地也可用）
==========================================================
两个子命令：

  bump <version>      versionCode = version.json 现值 +1，写进 build.gradle.kts
  publish             读 build.gradle.kts 的最终版本 → 调 gitee API 建 Release、
                      传 APK → 更新 version.json → 提交并推回 gitee main

环境变量：
  GITEE_TOKEN   gitee 私人令牌（在 GitHub 仓库 Secrets 里配，见 docs/ci-setup.md）
  CI_GIT_USER   可选，回推 version.json 时的 git user.name（默认 xctally-ci）
  CI_GIT_EMAIL  可选，git user.email（默认 ci@xctally.local）
"""
import base64
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
BUILD_GRADLE = os.path.join(ROOT, "apps", "android", "app", "build.gradle.kts")
VERSION_JSON = os.path.join(ROOT, "apps", "android", "version.json")

OWNER, REPO = "qiyu_server", "xctally"
cfg_file = os.path.join(ROOT, "tools", "release.config.json")
if os.path.exists(cfg_file):
    _c = json.load(open(cfg_file, encoding="utf-8"))
    OWNER = _c.get("owner", OWNER)
    REPO = _c.get("repo", REPO)
GITEE_ORIGIN = "https://gitee.com/%s/%s.git" % (OWNER, REPO)
API = "https://gitee.com/api/v5/repos/%s/%s" % (OWNER, REPO)


def die(msg):
    print("[FAIL] " + msg)
    sys.exit(1)


def read_version_code():
    m = re.search(r"versionCode = (\d+)", open(BUILD_GRADLE, encoding="utf-8").read())
    return int(m.group(1)) if m else die("versionCode not found in build.gradle.kts")


def api(url, token, data=None, multipart=None):
    if data is None:
        data = {}
    bound = "----" + uuid.uuid4().hex
    parts = []
    fields = dict(data)
    fields["access_token"] = token
    for k, v in fields.items():
        parts.append(('--%s\r\nContent-Disposition: form-data; name="%s"\r\n\r\n%s\r\n'
                      % (bound, k, v)).encode())
    if multipart:
        fn, blob = multipart
        parts.append(('--%s\r\nContent-Disposition: form-data; name="file"; '
                      'filename="%s"\r\nContent-Type: application/octet-stream\r\n\r\n'
                      % (bound, fn)).encode() + blob + b"\r\n")
    # 每个分片自带结尾 CRLF，直接拼接即可。
    # 【千万别再用 b"\r\n".join()】：那会在分片之间多出一个 CRLF，
    # 被服务器并进二进制内容 —— APK 末尾多出 \r\n 后严格解析器直接拒装
    # （卓易通报"解析包时出现问题"就是这个坑）。
    body = b"".join(parts) + ("--%s--\r\n" % bound).encode()
    req = urllib.request.Request(
        url, data=body,
        headers={"Content-Type": "multipart/form-data; boundary=" + bound})
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        try:
            detail = e.read().decode()[:500]
        except Exception:
            detail = ""
        die("gitee api %s -> HTTP %s %s" % (url, e.code, detail))


def git(*args, check=True, **kw):
    r = subprocess.run(["git"] + list(args), cwd=ROOT, capture_output=True,
                       text=True, **kw)
    if check and r.returncode != 0:
        die("git %s failed: %s %s" % (" ".join(args), r.stdout, r.stderr))
    return r


def cmd_bump(version):
    if not re.match(r"^\d+(\.\d+)*$", version):
        die("bad version: " + version)
    old = 0
    if os.path.exists(VERSION_JSON):
        try:
            old = json.load(open(VERSION_JSON, encoding="utf-8")).get("versionCode", 0)
        except Exception:
            old = 0
    new_code = int(old) + 1
    src = open(BUILD_GRADLE, encoding="utf-8").read()
    src = re.sub(r"versionCode = \d+", "versionCode = %d" % new_code, src)
    src = re.sub(r'versionName = "[^"]*"', 'versionName = "%s"' % version, src)
    open(BUILD_GRADLE, "w", encoding="utf-8", newline="\n").write(src)
    print("bumped: versionCode=%d versionName=%s" % (new_code, version))


def api_get(url, token):
    sep = "&" if "?" in url else "?"
    req = urllib.request.Request(url + sep + "access_token=" + token,
                                 headers={"User-Agent": "xctally-ci"})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        die("gitee api %s -> HTTP %s" % (url, e.code))


def find_or_create_release(token, tag, notes):
    """幂等：同名 Release 已存在就复用（上次跑到一半失败的场景重跑不用先删）"""
    rels = api_get(API + "/releases?per_page=100", token)
    for r in rels if isinstance(rels, list) else []:
        if r.get("tag_name") == tag:
            print("      reusing existing release id=" + str(r.get("id")))
            return r
    return api(API + "/releases", token,
               data={"tag_name": tag, "name": tag, "body": notes,
                     "target_commitish": "main"})


def upload_attachment(token, rel_id, fn, path):
    """5MB APK 从海外 runner 传 gitee 偶发极慢：Python 的 SSL 单次写会超时，
    换 curl（自带重试/断流控制）再包一层整体重试"""
    url = API + "/releases/%s/attach_files" % rel_id
    last_err = ""
    for attempt in range(1, 4):
        r = subprocess.run(
            ["curl", "-sS", "--retry", "3", "--retry-all-errors",
             "--connect-timeout", "30", "--max-time", "900",
             "-w", "\\n%{http_code}",
             "-F", "access_token=" + token,
             "-F", "file=@" + path + ";filename=" + fn,
             url],
            capture_output=True, text=True)
        out = (r.stdout or "").strip()
        http = out.rsplit("\n", 1)[-1] if "\n" in out else ""
        body = out.rsplit("\n", 1)[0] if "\n" in out else out
        if r.returncode == 0 and http == "200":
            try:
                return json.loads(body)
            except Exception:
                pass
        last_err = "rc=%s http=%s %s %s" % (r.returncode, http, body[:120], (r.stderr or "")[:120])
        print("      upload attempt %d failed: %s" % (attempt, last_err))
    die("upload failed after 3 attempts: " + last_err)


def cmd_publish(version, apk_path, notes):
    token = os.environ.get("GITEE_TOKEN", "").strip()
    if not token:
        die("GITEE_TOKEN env missing")
    if not os.path.exists(apk_path):
        die("apk not found: " + apk_path)
    tag = "v" + version
    code = read_version_code()
    fn = "xctally-%s.apk" % version

    print("[1/3] gitee release %s (versionCode %d)" % (tag, code))
    rel = find_or_create_release(token, tag, notes)
    print("      release id=" + str(rel.get("id")))

    print("[2/3] uploading " + fn)
    att = upload_attachment(token, rel["id"], fn, apk_path)
    print("      attach: " + json.dumps(att, ensure_ascii=False)[:200])
    apk_url = "https://gitee.com/%s/%s/releases/download/%s/%s" % (OWNER, REPO, tag, fn)

    print("[3/3] version.json -> gitee main")
    vj = {"versionCode": code, "versionName": version, "apkUrl": apk_url, "notes": notes}
    open(VERSION_JSON, "w", encoding="utf-8", newline="\n").write(
        json.dumps(vj, ensure_ascii=False, indent=2) + "\n")
    git("config", "user.name", os.environ.get("CI_GIT_USER", "xctally-ci"))
    git("config", "user.email", os.environ.get("CI_GIT_EMAIL", "ci@xctally.local"))
    git("add", "apps/android/version.json", "apps/android/app/build.gradle.kts")
    git("commit", "-m", "release %s (versionCode %d) [ci skip]" % (tag, code))
    authed = GITEE_ORIGIN.replace("https://", "https://oauth2:%s@" % token)
    git("remote", "add", "gitee", authed, check=False)
    # 回推 main：正常推送失败（main 已前進）就先合再推，绝不 force
    r = git("push", "gitee", "HEAD:main", check=False)
    if r.returncode != 0:
        print("      push rejected, rebasing onto gitee/main ...")
        git("fetch", "gitee", "main")
        git("rebase", "gitee/main")
        git("push", "gitee", "HEAD:main")
    print("\nDONE. apk url:\n" + apk_url)


def main():
    args = sys.argv[1:]
    if len(args) < 1:
        print(__doc__)
        sys.exit(1)
    if args[0] == "bump" and len(args) == 2:
        cmd_bump(args[1])
    elif args[0] == "publish":
        version = notes = ""
        apk = None
        i = 1
        while i < len(args):
            if args[i] == "--version":
                version = args[i + 1]; i += 2
            elif args[i] == "--apk":
                apk = args[i + 1]; i += 2
            elif args[i] == "--notes":
                notes = args[i + 1]; i += 2
            else:
                i += 1
        if not version or not apk:
            die("publish needs --version and --apk")
        cmd_publish(version, apk, notes or "")
    else:
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
