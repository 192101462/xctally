/* xcnote · 备份与恢复（纯本地，不联网）
 * ---------------------------------------------------------------
 * 用途只有一个：**换手机时把记录搬过去**。
 *   - 导出：把物品 / 收藏 / 能源打包成一个文件
 *   - 恢复：先对比再合并，冲突默认保留"你现在的版本"
 *
 * 这里刻意不做上传、不做账号、不做分享 —— xcnote 是单机本地工具。
 * ---------------------------------------------------------------
 */
(function () {
  'use strict';

  const XC = window.XC;
  const FORMAT = 'xcnote.backup';
  const VERSION = 2;

  function UI() { return window.XCUI; }
  function appData() { return UI().data(); }
  function esc(s) { return UI().esc(s); }

  let pending = null;

  /* ---------------- 导出 ---------------- */

  function buildBackup() {
    const d = appData();
    const snap = window.XCV ? XCV.snapshot() : { entries: [], cats: [] };
    return {
      format: FORMAT,
      version: VERSION,
      exportedAt: XC.iso(XC.today()),
      app: {
        items: d.items.slice(),
        events: d.events.slice(),
        meters: d.meters.slice()
      },
      collect: {
        entries: snap.entries.slice(),
        cats: snap.cats.slice()
      }
    };
  }

  function doExport() {
    const pkg = buildBackup();
    const total = pkg.app.items.length + pkg.collect.entries.length + pkg.app.meters.length;
    const name = 'xcnote-backup-' + pkg.exportedAt + '.json';

    if (window.XCPlatform && XCPlatform.native) {
      // 原生壳：写文件 + 唤起系统分享（发给新手机 / 存网盘）
      XCPlatform.saveFile(name, JSON.stringify(pkg, null, 2));
      XCPlatform.shareLastFile();
    } else {
      const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500);
    }

    const d = appData();
    d.lastBackup = pkg.exportedAt;
    UI().save();
    UI().mount();
    UI().toast('备份已导出（物品 ' + pkg.app.items.length + ' · 随笔 ' + pkg.collect.entries.length +
      ' · 表具 ' + pkg.app.meters.length + '，共 ' + total + ' 条）');
  }

  /* ---------------- 恢复 ---------------- */

  function pickFile() {
    const handle = function (text) {
      if (text == null || text === '') return;
      let pkg;
      try { pkg = JSON.parse(text); }
      catch (err) { UI().toast('这个文件不是有效的备份'); return; }
      if (!pkg || (pkg.format !== FORMAT && !pkg.items)) {
        UI().toast('文件格式不对，需要 xcnote 导出的备份');
        return;
      }
      openImportSheet(pkg);
    };

    // 原生壳走系统文件选择器，浏览器走 input[type=file]
    if (window.XCPlatform) {
      XCPlatform.pickFile(handle);
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', function () {
      const file = input.files && input.files[0];
      input.remove();
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function () { handle(String(reader.result)); };
      reader.readAsText(file);
    });
    input.click();
  }

  function diffList(localArr, remoteArr) {
    const index = {};
    localArr.forEach(function (x) { index[x.id] = x; });
    let added = 0, same = 0, conflict = 0;
    (remoteArr || []).forEach(function (r) {
      const l = index[r.id];
      if (!l) { added++; return; }
      if (JSON.stringify(l) === JSON.stringify(r)) same++;
      else conflict++;
    });
    return { added: added, same: same, conflict: conflict };
  }

  function computeDiff(pkg) {
    const d = appData();
    const snap = window.XCV ? XCV.snapshot() : { entries: [] };
    const app = pkg.app || pkg;          // 兼容早期只导出物品的备份
    const collect = pkg.collect || { entries: pkg.collects || [] };
    return {
      items: diffList(d.items, app.items),
      events: diffList(d.events, app.events),
      meters: diffList(d.meters, app.meters),
      collect: diffList(snap.entries, collect.entries)
    };
  }

  function openImportSheet(pkg) {
    pending = { pkg: pkg, diff: computeDiff(pkg) };
    renderSheet();
  }

  function renderSheet() {
    const diff = pending.diff;
    const row = function (label, x, has) {
      if (!has) return '';
      return '<div class="kv"><span class="k">' + label + '</span><span class="v">' +
        '新增 ' + x.added + ' · 相同 ' + x.same + ' · 冲突 ' + x.conflict + '</span></div>';
    };
    const conflicts = diff.items.conflict + diff.events.conflict + diff.meters.conflict + diff.collect.conflict;
    const added = diff.items.added + diff.events.added + diff.meters.added + diff.collect.added;
    const pkg = pending.pkg;
    const app = pkg.app || pkg;
    const collect = pkg.collect || { entries: pkg.collects || [] };

    UI().openSheet('' +
      '<div class="sheet">' +
        '<div class="grabber"></div>' +
        '<h3>从备份恢复</h3>' +
        '<p class="hint">备份导出于 ' + esc(pkg.exportedAt || '未知日期') + '</p>' +

        '<div class="group" style="margin-bottom:14px">' +
          row('物品', diff.items, app.items && app.items.length) +
          row('流水', diff.events, app.events && app.events.length) +
          row('随笔', diff.collect, collect.entries && collect.entries.length) +
          row('能源', diff.meters, app.meters && app.meters.length) +
        '</div>' +

        (conflicts
          ? '<div class="notice">有 <b>' + conflicts + '</b> 条两边不一样。默认<b>保留你现在设备上的版本</b>，不会被覆盖。</div>' +
            '<label class="check-row"><input type="checkbox" id="b-prefer" />' +
            '<span>改用备份里的版本</span></label>'
          : '<div class="notice" style="background:rgba(52,199,89,.12);color:var(--green)">没有冲突，可以直接恢复。</div>') +

        '<div class="mini-foot" style="margin:10px 0 14px 3px">本次将新增 ' + added + ' 条</div>' +

        '<div class="sheet-actions">' +
          '<button class="btn plain" data-action="b-close">取消</button>' +
          '<button class="btn primary" data-action="b-do-import">确认恢复</button>' +
        '</div>' +
      '</div>');
  }

  function mergeList(localArr, remoteArr, preferRemote) {
    const res = { added: 0, same: 0, conflict: 0, updated: 0 };
    const index = {};
    localArr.forEach(function (x) { index[x.id] = x; });
    (remoteArr || []).forEach(function (r) {
      const l = index[r.id];
      if (!l) { localArr.push(r); res.added++; return; }
      if (JSON.stringify(l) === JSON.stringify(r)) { res.same++; return; }
      if (preferRemote) {
        Object.keys(r).forEach(function (k) { l[k] = r[k]; });
        res.updated++;
      } else {
        res.conflict++;
      }
    });
    return res;
  }

  function mergeMeters(localArr, remoteArr, preferRemote) {
    const res = { added: 0, same: 0, conflict: 0, updated: 0 };
    if (!remoteArr) return res;
    const index = {};
    localArr.forEach(function (m) { index[m.id] = m; });
    remoteArr.forEach(function (rm) {
      const lm = index[rm.id];
      if (!lm) { localArr.push(rm); res.added++; return; }
      if (JSON.stringify(lm) === JSON.stringify(rm)) { res.same++; return; }
      // 能源按"读数更全"的一方为准，避免把历史冲掉
      if (preferRemote || (rm.history && lm.history && rm.history.length > lm.history.length)) {
        Object.keys(rm).forEach(function (k) { lm[k] = rm[k]; });
        res.updated++;
      } else {
        res.conflict++;
      }
    });
    return res;
  }

  function doImport() {
    if (!pending) return;
    const el = document.getElementById('b-prefer');
    const preferRemote = el ? el.checked : false;
    const pkg = pending.pkg;
    const app = pkg.app || pkg;
    const collect = pkg.collect || { entries: pkg.collects || [], cats: pkg.collectCats || [] };
    const d = appData();
    let added = 0, conflict = 0;

    let r = mergeList(d.items, app.items, preferRemote);
    added += r.added; conflict += r.conflict;
    r = mergeList(d.events, app.events, preferRemote);
    added += r.added; conflict += r.conflict;
    r = mergeMeters(d.meters, app.meters, preferRemote);
    added += r.added; conflict += r.conflict;

    if (window.XCV && collect.entries) {
      r = XCV.merge(collect, preferRemote);
      added += r.added; conflict += r.conflict;
    }

    d.lastBackup = pkg.exportedAt || d.lastBackup;
    UI().save();
    pending = null;
    UI().closeSheet();
    UI().mount();
    UI().toast('恢复完成：新增 ' + added + ' 条' + (conflict ? '，' + conflict + ' 条冲突已保留当前版本' : ''));
  }

  /* ---------------- 演示：伪造一份"新手机上的备份" ---------------- */

  function demoImport() {
    const d = appData();
    const snap = window.XCV ? XCV.snapshot() : { entries: [], cats: [] };
    const pkg = buildBackup();
    pkg.exportedAt = XC.iso(XC.today());

    // 备份里多两件物品、多一条随笔
    pkg.app.items = pkg.app.items.concat([
      {
        id: 'it_backup1', name: '保温杯', icon: '🥤', category: '日用', sub: '杯具',
        acquiredAt: XC.addDays(-45), source: '网购', cost: 89, qty: 1, unit: '个',
        status: '在用', location: '办公室', expiresAt: null, openedAt: null, warrantyUntil: null, note: ''
      },
      {
        id: 'it_backup2', name: '机械键盘', icon: '⌨️', category: '电子', sub: '外设',
        acquiredAt: XC.addDays(-120), source: '网购', cost: 599, qty: 1, unit: '把',
        status: '在用', location: '书房', expiresAt: null, openedAt: null, warrantyUntil: null, note: ''
      }
    ]);
    pkg.collect.entries = pkg.collect.entries.concat([
      {
        id: 'c_backup1', title: '新手机的第一次记录', cat: '灵感', date: XC.iso(XC.today()),
        tags: ['迁移'], plugins: [{ k: 'mood', v: '兴奋' }],
        bodyHtml: '<p>从备份里恢复出来的内容。</p>'
      }
    ]);
    // 制造一条冲突：备份里把第一件物品的位置改了
    if (d.items[0]) {
      const copy = JSON.parse(JSON.stringify(d.items[0]));
      copy.location = '备份里的旧位置';
      pkg.app.items[0] = copy;
    }
    if (snap.entries.length) {
      const c2 = JSON.parse(JSON.stringify(snap.entries[0]));
      c2.title = snap.entries[0].title + '（旧版本）';
      pkg.collect.entries[0] = c2;
    }
    openImportSheet(pkg);
  }

  /* ---------------- 动作路由 ---------------- */

  function handleAction(action, el) {
    if (action.indexOf('b-') !== 0) return false;
    if (action === 'b-export') doExport();
    else if (action === 'b-import') pickFile();
    else if (action === 'b-do-import') doImport();
    else if (action === 'b-close') { pending = null; UI().closeSheet(); }
    return true;
  }

  window.XCB = {
    handleAction: handleAction,
    buildBackup: buildBackup,
    doExport: doExport,
    pickFile: pickFile,
    demoImport: demoImport
  };
})();
