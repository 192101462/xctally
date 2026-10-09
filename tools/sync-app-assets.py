#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
把 prototype/ 里的网页应用同步到两个原生壳的资源目录。

为什么要这一步：网页应用是**唯一一份** UI 与业务逻辑（prototype/），
安卓与鸿蒙的壳只负责"装一个 WebView + 原生能力桥接"。
改完 prototype 后跑一次这个脚本，两个壳就都更新了。

用法：
    python tools/sync-app-assets.py
"""
import os
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "prototype")

TARGETS = [
    ("Android", os.path.join(ROOT, "apps", "android", "app", "src", "main", "assets", "www")),
    ("HarmonyOS", os.path.join(ROOT, "apps", "harmony", "entry", "src", "main", "resources", "rawfile", "www")),
]

# 顺序即加载顺序，platform.js 必须最先
FILES = [
    "index.html",
    "styles.css",
    "platform.js",
    "data.js",
    "collect.js",
    "backup.js",
    "selftest.js",
    "app.js",
]


def main():
    if not os.path.isdir(SRC):
        sys.exit("找不到 prototype/ 目录")

    missing = [f for f in FILES if not os.path.exists(os.path.join(SRC, f))]
    if missing:
        sys.exit("prototype/ 缺少文件：" + ", ".join(missing))

    for label, dst in TARGETS:
        if os.path.isdir(dst):
            shutil.rmtree(dst)
        os.makedirs(dst)
        total = 0
        for f in FILES:
            shutil.copy2(os.path.join(SRC, f), os.path.join(dst, f))
            total += os.path.getsize(os.path.join(dst, f))
        print("OK  %-10s → %s  (%d 个文件, %.0f KB)" % (
            label, os.path.relpath(dst, ROOT), len(FILES), total / 1024))

    print("\n提示：改完 prototype/ 里的网页应用后，重新跑一次本脚本即可。")


if __name__ == "__main__":
    main()
