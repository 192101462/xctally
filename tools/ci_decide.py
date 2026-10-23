#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""发版决策（GitHub Actions 里调用）：读 RELEASE.md / 手动输入 / version.json，
决定这次要不要发布，结果写进 GITHUB_OUTPUT（由调用方重定向）。

规则：
  - 手动触发（workflow_dispatch）：填了版本号就发（哪怕和已发同号＝有意重发）；
    留空则只构建不发布（冒烟测试）。
  - push 触发：RELEASE.md 的版本号比 version.json 里已发布的高才发；
    相同或更低（改忘改版本号）就整条流水线跳过，省构建时间。
"""
import io
import json
import os
import re
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


def vkey(ver):
    """'1.4.2' -> [1, 4, 2]；解析不了返回 None"""
    try:
        return [int(x) for x in ver.split(".")]
    except Exception:
        return None


ev = os.environ.get("EV_NAME", "")
in_ver = (os.environ.get("IN_VER") or "").strip()
in_notes = os.environ.get("IN_NOTES") or ""

ver, notes, src = "", "", ""
if ev == "workflow_dispatch":
    ver, notes, src = in_ver, in_notes, "手动输入"
else:
    try:
        txt = io.open("RELEASE.md", encoding="utf-8").read()
    except Exception:
        txt = ""
    m = re.search(r"^version:\s*([0-9][0-9.]*)\s*$", txt, re.M)
    if m:
        ver = m.group(1)
        notes = "\n".join(
            l.strip()[1:].strip() for l in txt.splitlines() if l.strip().startswith("-")
        )
        src = "RELEASE.md"

released = ""
try:
    released = json.load(io.open("apps/android/version.json", encoding="utf-8")).get(
        "versionName", "")
except Exception:
    pass

publish = build = "no"
if not ver:
    # 手动触发留空版本号：只构建（冒烟测试）；push 没写版本号：无事可做
    if ev == "workflow_dispatch":
        build = "yes"
        reason = "手动触发未填版本号，只构建不发布"
    else:
        reason = "RELEASE.md 里没有版本号，跳过"
elif ev == "workflow_dispatch":
    publish = build = "yes"
    reason = "手动触发，发布 %s" % ver
elif ver == released:
    reason = "%s 已发布过，跳过（要发新版请把 RELEASE.md 的版本号改大）" % ver
elif vkey(ver) is None or (vkey(released) and vkey(ver) <= vkey(released)):
    reason = "版本号 %s 不比已发布的 %s 新，跳过" % (ver, released)
else:
    publish = build = "yes"
    reason = "发布 %s（来源 %s，已发布 %s）" % (ver, src, released or "无")

print("version=%s" % ver)
print("publish=%s" % publish)
print("build=%s" % build)
print("reason=%s" % reason)
print("notes<<NOTES_EOF")
print(notes)
print("NOTES_EOF")
print("::notice::%s" % reason, file=sys.stderr)
