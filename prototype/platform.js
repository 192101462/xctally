/* xctally · 平台适配层
 * ---------------------------------------------------------------
 * 同一份网页应用跑在三处：
 *   1. 浏览器         → 直接打开 index.html（开发/预览用）
 *   2. 安卓壳         → WebView + addJavascriptInterface（window.QYAndroid）
 *   3. 鸿蒙壳         → ArkWeb + javaScriptProxy（window.QYHarmony）
 *
 * 这里把"只有原生才能做"的两件事抽象出来：
 *   saveFile   导出备份（安卓/鸿蒙里写文件并可分享，浏览器里走下载）
 *   pickFile   选择备份文件（原生文件选择器 / input[type=file]）
 * 外加 scheduleReminders：把到期清单交给原生去发系统通知。
 *
 * 本文件必须最先加载（在 data.js 之前）。
 * ---------------------------------------------------------------
 */
(function () {
  'use strict';

  const android = window.QYAndroid || null;   // 安卓注入
  const harmony = window.QYHarmony || null;   // 鸿蒙注入
  const native = android || harmony;

  // 原生壳里不应该显示"手机外框 + 左侧说明栏"，用 ?app=1 也能在浏览器里预览这个模式
  const kind = android ? 'android' : (harmony ? 'harmony' : 'web');
  const appMode = !!native || /[?&]app=1(&|$)/.test(location.search);
  const markApp = function () {
    document.documentElement.classList.add('app-mode');
    // 壳的种类也标上：CSS 按 shell-android / shell-harmony 区分各自的安全区处理
    if (native) document.documentElement.classList.add('shell-' + kind);
    if (document.body) document.body.classList.add('app-mode');
  };
  if (appMode) {
    if (document.body) markApp();
    else document.addEventListener('DOMContentLoaded', markApp);
  }

  const pending = {};   // pickFile 的待回调：id → callback
  const pendingImg = {};   // pickImage 的待回调：id → callback

  window.QYPlatform = {
    native: !!native,
    kind: kind,
    appMode: appMode,

    /* 保存文本文件 */
    saveFile: function (name, text) {
      if (native && native.saveFile) {
        try { native.saveFile(name, text); return true; } catch (err) { /* 落到浏览器兜底 */ }
      }
      const blob = new Blob([text], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500);
      return true;
    },

    /* 选择文件，拿到文本后回调 cb(text|null) */
    pickFile: function (cb) {
      if (native && native.pickFile) {
        const id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        pending[id] = cb;
        try { native.pickFile(id); return; } catch (err) { /* 落到浏览器兜底 */ }
      }
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.style.display = 'none';
      document.body.appendChild(input);
      input.addEventListener('change', function () {
        const f = input.files && input.files[0];
        input.remove();
        if (!f) { cb(null); return; }
        const fr = new FileReader();
        fr.onload = function () { cb(String(fr.result)); };
        fr.readAsText(f);
      });
      input.click();
    },

    /* 原生侧选完文件后回传内容（由原生调用） */
    _deliver: function (id, text) {
      const cb = pending[id];
      delete pending[id];
      if (cb) cb(text == null ? null : String(text));
    },

    /* 选图片：source 为 'camera' / 'gallery' / ''（空则让原生决定） */
    pickImage: function (cb, source) {
      if (native && native.pickImage) {
        const id = 'img' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        pendingImg[id] = cb;
        try { native.pickImage(id, source || ''); return; } catch (err) { /* 落到浏览器兜底 */ }
      }
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.style.display = 'none';
      document.body.appendChild(input);
      input.addEventListener('change', function () {
        const f = input.files && input.files[0];
        input.remove();
        if (!f) { cb(null); return; }
        const fr = new FileReader();
        fr.onload = function () { cb(String(fr.result)); };
        fr.readAsDataURL(f);
      });
      input.click();
    },

    /* 原生侧选完图片后回传 dataURL（由原生调用） */
    _deliverImage: function (id, dataUrl) {
      const cb = pendingImg[id];
      delete pendingImg[id];
      if (cb) cb(dataUrl == null ? null : String(dataUrl));
    },

    /* 把待提醒清单交给原生，让系统去发通知 */
    scheduleReminders: function (list) {
      if (native && native.scheduleReminders) {
        try { native.scheduleReminders(JSON.stringify(list || [])); } catch (err) { /* 忽略 */ }
      }
    },

    /* 安卓 Toast / 鸿蒙 promptAction 提示 */
    toast: function (msg) {
      if (native && native.toast) {
        try { native.toast(String(msg)); return true; } catch (err) { /* 忽略 */ }
      }
      return false;
    },

    /* 导出完成后给原生一次"分享"的机会 */
    shareLastFile: function () {
      if (native && native.shareLastFile) {
        try { native.shareLastFile(); } catch (err) { /* 忽略 */ }
      }
    },

    /* 系统栏与 WebView 的重叠量（css px）：兼容层（卓易通等）不让位时才非 0。
     * 拿到后写 --safe-top/--safe-bottom，CSS 据此留白。 */
    insets: function () {
      if (native && native.insets) {
        try {
          const v = JSON.parse(native.insets());
          if (isFinite(v.top) && isFinite(v.bottom)) return { top: v.top, bottom: v.bottom };
        } catch (err) { /* 落到 env() 兜底 */ }
      }
      return null;
    },

    /* 原生侧量到重叠量变化时回调（由原生调用） */
    _applyInsets: function (top, bottom) {
      applyInsets(top, bottom);
    },

    /* 已安装的 App 版本（原生 versionName），没有原生时为空串 */
    appVersion: function () {
      if (native && native.appVersion) {
        try { return String(native.appVersion() || ''); } catch (err) { /* 忽略 */ }
      }
      return '';
    },

    /* 主题变化时让系统栏/窗口底色跟着换，兼容层没铺满的边缘不露白 */
    setSystemBars: function (dark) {
      if (native && native.setSystemBars) {
        try { native.setSystemBars(!!dark); } catch (err) { /* 忽略 */ }
      }
    }
  };

  /* 把重叠量写成 CSS 变量；原生壳里启动拉一次，之后变化由原生推 _applyInsets */
  function applyInsets(top, bottom) {
    const root = document.documentElement;
    if (isFinite(top)) root.style.setProperty('--safe-top', Math.max(0, top) + 'px');
    if (isFinite(bottom)) root.style.setProperty('--safe-bottom', Math.max(0, bottom) + 'px');
  }
  if (native) {
    const boot = function () {
      const v = window.QYPlatform.insets();
      if (v) applyInsets(v.top, v.bottom);
    };
    if (document.body) boot();
    else document.addEventListener('DOMContentLoaded', boot);
  }
})();
