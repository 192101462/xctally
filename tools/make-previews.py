#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
xcnote 预览图生成脚本
---------------------------------------------------------------
用无头 Chrome 渲染 prototype/index.html，并裁成手机比例，
输出到 design/preview-*.png。改完 UI 后重新跑一次即可。

用法：
    python tools/make-previews.py
"""
import os
import subprocess
import sys
import tempfile

from PIL import Image

CHROME_CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "design")
PAGE = "file:///" + os.path.join(ROOT, "prototype", "index.html").replace("\\", "/")

DEVICE_W, DEVICE_H = 390, 844          # .device 的 CSS 尺寸
WIN_W, WIN_H, DSF = 940, 960, 2        # 窗口需 >900px 才会显示"手机外框"布局
MARGIN = 14                            # 裁剪时给阴影留的边距（CSS px）

VIEWS = [
    ("preview-1-home",    "home?bare&light"),
    ("preview-2-items",   "items?bare&light"),
    ("preview-3-detail",  "detail=it_mac?bare&light"),
    ("preview-4-energy",  "energy?bare&light"),
    ("preview-5-me",      "me?bare&light"),
    ("preview-6-add",     "items?bare&light&add"),
    ("preview-7-reading", "energy?bare&light&reading"),
    ("preview-8-home-dark", "home?bare&dark"),
    # 收藏模块（统一条目 + 插件 + 图文混排）
    ("preview-9-collect",    "collect?bare&light"),
    ("preview-10-note",      "cdetail=c_diary1?bare&light"),
    ("preview-11-longimage", "cdetail=c_diary1?bare&light&clong"),
    ("preview-12-note-form", "collect?bare&light&cform"),
    # 备份与恢复
    ("preview-13-restore",   "me?bare&light&bimport"),
    # 页内自检报告（整页输出，不做手机裁剪；自检较慢，给足虚拟时间）
    ("preview-14-selftest",  "selftest", "full"),
]


def find_chrome():
    for path in CHROME_CANDIDATES:
        if os.path.exists(path):
            return path
    sys.exit("找不到 Chrome / Edge，请手动安装其一，或修改脚本里的路径。")


def shoot(chrome, profile, url, png, width, height, dsf, budget=2500):
    cmd = [
        chrome,
        "--headless=new", "--disable-gpu", "--hide-scrollbars",
        "--no-first-run", "--no-default-browser-check",
        "--user-data-dir=" + profile,
        "--virtual-time-budget=%d" % budget,
        "--window-size=%d,%d" % (width, height),
    ]
    if dsf:
        cmd.append("--force-device-scale-factor=%d" % dsf)
    cmd += ["--screenshot=" + png, url]
    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def main():
    chrome = find_chrome()
    profile = tempfile.mkdtemp(prefix="xcnote-shots-")
    if not os.path.isdir(OUT):
        os.makedirs(OUT)

    # 手机单屏图（外面套着 390x844 的外框，裁出来正好是手机比例）
    x0 = (WIN_W - DEVICE_W) // 2 - MARGIN
    y0 = (WIN_H - DEVICE_H) // 2 - MARGIN
    box = (x0 * DSF, y0 * DSF, (x0 + DEVICE_W + MARGIN * 2) * DSF, (y0 + DEVICE_H + MARGIN * 2) * DSF)

    for view in VIEWS:
        name, frag = view[0], view[1]
        mode = view[2] if len(view) > 2 else "phone"
        raw = os.path.join(OUT, "_raw.png")

        if mode == "full":
            # 整页报告：不裁剪，1x 缩放保证小字清晰，给足时间跑完异步自检
            shoot(chrome, profile, PAGE + "#" + frag, raw, 900, 1400, 1, budget=20000)
            if os.path.exists(raw):
                os.replace(raw, os.path.join(OUT, name + ".png"))
                print("OK    %-22s (full page)" % name)
            else:
                print("FAIL  " + name)
            continue

        shoot(chrome, profile, PAGE + "#" + frag, raw, WIN_W, WIN_H, DSF)
        if not os.path.exists(raw):
            print("FAIL  " + name)
            continue
        im = Image.open(raw).convert("RGB")
        im.crop(box).save(os.path.join(OUT, name + ".png"))
        os.remove(raw)
        print("OK    %-22s %dx%d" % (name, box[2] - box[0], box[3] - box[1]))

    # 总览图：保留左侧说明栏（1x 缩放，避免大画布合成瑕疵）
    raw = os.path.join(OUT, "_raw.png")
    shoot(chrome, profile, PAGE + "#home?light", raw, 1020, 1000, 0)
    if os.path.exists(raw):
        os.replace(raw, os.path.join(OUT, "preview-0-overview.png"))
        print("OK    preview-0-overview")


if __name__ == "__main__":
    main()
