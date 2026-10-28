# -*- coding: utf-8 -*-
"""收藏 → 随笔 全局统一改名（UI 文案 + 代码标识 + 存储键迁移 + 备份格式兼容）"""
import io, os, sys

ROOT = os.path.join(os.path.dirname(__file__), '..', 'prototype')

def apply(fname, pairs):
    p = os.path.join(ROOT, fname)
    with io.open(p, 'r', encoding='utf-8') as f:
        s = f.read()
    for old, new, n in pairs:
        got = s.count(old)
        if got == 0 and new in s:
            continue   # 已应用过（重跑容错）
        assert got == n, '%s: expected %d x %r, found %d' % (fname, n, old[:60], got)
        s = s.replace(old, new)
    with io.open(p, 'w', encoding='utf-8', newline='') as f:
        f.write(s)
    print('OK', fname, len(pairs), 'pairs')

# ---------------- app.js ----------------
apply('app.js', [
    ("    collect: '<svg", "    note: '<svg", 1),
    ("tabs: { home: true, items: true, collect: false, energy: false },",
     "tabs: { home: true, items: true, note: false, energy: false },", 1),
    ("sort: { items: 'date', collect: 'recent', energy: 'amount' },",
     "sort: { items: 'date', note: 'recent', energy: 'amount' },", 1),
    # ui() 读旧设置兼容
    ("    try { c = JSON.parse(localStorage.getItem(UI_KEY) || '{}') || {}; } catch (err) { c = {}; }\n    return Object.assign({}, c, {",
     "    try { c = JSON.parse(localStorage.getItem(UI_KEY) || '{}') || {}; } catch (err) { c = {}; }\n"
     "    // 旧版设置里随笔标签/排序的键叫 collect，统一搬进 note\n"
     "    if (c.tabs && c.tabs.collect != null && c.tabs.note == null) c.tabs.note = c.tabs.collect;\n"
     "    if (c.sort && c.sort.collect != null && c.sort.note == null) c.sort.note = c.sort.collect;\n"
     "    return Object.assign({}, c, {", 1),
    ("const COLLECT_SORTS = [", "const NOTE_SORTS = [", 1),
    ("sortGroup('收藏列表', 'collect', COLLECT_SORTS, s.collect)",
     "sortGroup('随笔列表', 'note', NOTE_SORTS, s.note)", 1),
    ("{ id: 'collect', label: '收藏', icon: I.collect },",
     "{ id: 'note', label: '随笔', icon: I.note },", 1),
    ("(localStorage.getItem('xctally.collect.v1') || '').length;",
     "(localStorage.getItem('xctally.note.v1') || localStorage.getItem('xctally.collect.v1') || '').length;", 1),
    ('data-action="goto-collect"', 'data-action="goto-note"', 1),
    ("action === 'goto-collect'", "action === 'goto-note'", 1),
    ("state.tab = 'collect';", "state.tab = 'note';", 3),
    # 路由：旧 #collect 链接兼容
    ("} else if (['home', 'items', 'collect', 'energy', 'me'].indexOf(h) >= 0) {",
     "} else if (h === 'collect') {          // 旧版叫收藏，老链接直接当随笔页\n"
     "      state.tab = 'note';\n"
     "      state.detailId = null;\n"
     "    } else if (['home', 'items', 'note', 'energy', 'me'].indexOf(h) >= 0) {", 1),
    ("const t = ['home', 'items', 'collect', 'energy', 'me'].indexOf(tab) >= 0 ? tab : 'home';",
     "const t0 = tab === 'collect' ? 'note' : tab;\n"
     "    const t = ['home', 'items', 'note', 'energy', 'me'].indexOf(t0) >= 0 ? t0 : 'home';", 1),
    ("} else if (state.tab === 'collect' && QYV) {",
     "} else if (state.tab === 'note' && QYV) {", 1),
    ("const collectDetail = !!(window.QYV && QYV.hasDetail());",
     "const noteDetail = !!(window.QYV && QYV.hasDetail());", 1),
    ("!collectDetail", "!noteDetail", 1),
    ("// 收藏模块自己处理 c- 开头的动作", "// 随笔模块自己处理 c- 开头的动作", 1),
    ("// 首页的加号跟着界面走：收藏标签可见时选择记哪种", "// 首页的加号跟着界面走：随笔标签可见时选择记哪种", 1),
    ("tabVisible('collect')", "tabVisible('note')", 1),
    ("<span>新增收藏随笔</span>", "<span>新增随笔</span>", 1),
    ("toast('收藏模块不可用');", "toast('随笔模块不可用');", 1),
    ("} else if (action === 'set-tab-collect' || action === 'set-tab-energy') {",
     "} else if (action === 'set-tab-note' || action === 'set-tab-energy') {", 1),
    ("const key = action === 'set-tab-collect' ? 'collect' : 'energy';",
     "const key = action === 'set-tab-note' ? 'note' : 'energy';", 1),
    ("// 记住是从哪页点进随笔的（首页），返回时回那页而不是收藏列表",
     "// 记住是从哪页点进随笔的（首页），返回时回那页而不是随笔列表", 1),
    ("---------------- 给收藏模块的桥接接口 ----------------",
     "---------------- 给随笔模块的桥接接口 ----------------", 1),
    ("fallback = 没有来路时的默认，物品/收藏各传各的",
     "fallback = 没有来路时的默认，物品/随笔各传各的", 1),
    ("localStorage.removeItem('xctally.collect.v1');",
     "localStorage.removeItem('xctally.note.v1');\n          localStorage.removeItem('xctally.collect.v1');   // 旧版键顺手清掉", 1),
    ("const hidden = ['collect', 'energy'].filter", "const hidden = ['note', 'energy'].filter", 1),
    ("switchRow('set-tab-collect', '收藏', t.collect !== false)",
     "switchRow('set-tab-note', '随笔', t.note !== false)", 1),
    ("PAGE_TITLES = { home: '今天', items: '物品', collect: '收藏', energy: '能源', me: '我的' };",
     "PAGE_TITLES = { home: '今天', items: '物品', note: '随笔', energy: '能源', me: '我的' };", 1),
    ("#collect?bare&cform", "#note?bare&cform", 1),
])

# ---------------- collect.js（改名前先改内容）----------------
apply('collect.js', [
    ("/* xctally · 收藏模块（统一条目 + 插件 + 图文混排正文）",
     "/* xctally · 随笔模块（统一条目 + 插件 + 图文混排正文）", 1),
    (" *   1. 收藏只有一种条目，不再分\"日记/零食/影视/游玩\"",
     " *   1. 随笔只有一种条目，不再分\"日记/零食/影视/游玩\"", 1),
    (" *   4. 数据独立存储（xctally.collect.v1），备份时由 backup.js 统一打包",
     " *   4. 数据独立存储（xctally.note.v1；旧版键 xctally.collect.v1 首次读到自动搬家），备份时由 backup.js 统一打包", 1),
    ("  const KEY = 'xctally.collect.v1';",
     "  const KEY = 'xctally.note.v1';\n"
     "  const LEGACY_KEY = 'xctally.collect.v1';   // 旧版叫\"收藏\"时的键，读到就搬进新键", 1),
    ("      const raw = localStorage.getItem(KEY);\n      if (raw) d = JSON.parse(raw);",
     "      let raw = localStorage.getItem(KEY);\n"
     "      if (!raw && localStorage.getItem(LEGACY_KEY)) {\n"
     "        raw = localStorage.getItem(LEGACY_KEY);\n"
     "        if (raw) localStorage.setItem(KEY, raw);   // 一次性搬家，之后只读写新键\n"
     "      }\n"
     "      if (raw) d = JSON.parse(raw);", 1),
    ("const k = (window.QYUI && QYUI.ui) ? QYUI.ui().sort.collect : 'recent'",
     "const k = (window.QYUI && QYUI.ui) ? QYUI.ui().sort.note : 'recent'", 1),
    ("UI().pageHead('收藏',", "UI().pageHead('随笔',", 1),
    ("UI().iconBtn('c-add', '新增收藏')", "UI().iconBtn('c-add', '新增随笔')", 1),
    ("UI().detailBackLabel('收藏') : '收藏'", "UI().detailBackLabel('随笔') : '随笔'", 1),
    ("UI().toast('已收藏「' + title + '」');", "UI().toast('已保存「' + title + '」');", 1),
    ("(app.tab === 'collect' || !app.tab)", "(app.tab === 'note' || !app.tab)", 1),
    ("          kind: 'collect',", "          kind: 'note',", 1),
    ("// 哪来的回哪去：有来源（首页/成本列表）交给 backFromDetail，没有就回收藏列表",
     "// 哪来的回哪去：有来源（首页/成本列表）交给 backFromDetail，没有就回随笔列表", 1),
    ("// 首页加号 / AI 用：直接打开\"新增随笔\"表单（等于点收藏页的 + ）",
     "// 首页加号 / AI 用：直接打开\"新增随笔\"表单（等于点随笔页的 + ）", 1),
    ("db.cats.push({ name: cat, emoji: '📁' });   // AI 提到的收藏分类不存在就顺手建",
     "db.cats.push({ name: cat, emoji: '📁' });   // AI 提到的随笔分类不存在就顺手建", 1),
    ("// 分类管理（设置 → 分类管理 → 收藏分类）：只管名字",
     "// 分类管理（设置 → 分类管理 → 随笔分类）：只管名字", 1),
    ("// 回收站恢复用：整条放回收藏库", "// 回收站恢复用：整条放回随笔库", 1),
])

# ---------------- items.js ----------------
apply('items.js', [
    ("  function trashEntries() {\n    const d = data();\n    return (d.trash || []).slice().sort(function (a, b) {\n      return a.deletedAt < b.deletedAt ? 1 : -1;\n    });\n  }",
     "  function trashEntries() {\n    const d = data();\n    // 旧数据的回收站条目 kind 叫 'collect'，读出来统一当 'note'\n"
     "    return (d.trash || []).slice().sort(function (a, b) {\n      return a.deletedAt < b.deletedAt ? 1 : -1;\n"
     "    }).map(function (t) {\n      return t.kind === 'collect' ? Object.assign({}, t, { kind: 'note' }) : t;\n    });\n  }", 1),
    ("const it = t.kind === 'collect' ? t.entry : t.item;\n    const hay = [(it && it.name)",
     "const it = t.kind === 'note' ? t.entry : t.item;\n    const hay = [(it && it.name)", 1),
    ("const isCollect = t.kind === 'collect';", "const isNote = t.kind === 'note';", 1),
    ("(isCollect ? '收藏 · ' + (it.cat || '')", "(isNote ? '随笔 · ' + (it.cat || '')", 1),
    ("return t.kind === 'collect'; }).length;", "return t.kind === 'note'; }).length;", 1),
    ("segBtn('collect', '随笔', nCol)", "segBtn('note', '随笔', nCol)", 1),
    ("if (t.kind === 'collect') {", "if (t.kind === 'note') {", 1),
    ("const label = t.kind === 'collect' ?", "const label = t.kind === 'note' ?", 1),
    ('<div class="row-title">新增收藏分类</div>', '<div class="row-title">新增随笔分类</div>', 1),
    ("(showItems ? '<div class=\"section-head\" style=\"margin:18px 0 8px\"><h2>收藏分类</h2></div>' : '')",
     "(showItems ? '<div class=\"section-head\" style=\"margin:18px 0 8px\"><h2>随笔分类</h2></div>' : '')", 1),
    ("QYDialog.confirm('删除收藏分类「' + name + '」？'",
     "QYDialog.confirm('删除随笔分类「' + name + '」？'", 1),
    ("/* ── 物品长图：与收藏同款的白卡风格。", "/* ── 物品长图：与随笔同款的白卡风格。", 1),
    ("// 与收藏的长图同一套交互：先预览，再点\"保存图片\"下载",
     "// 与随笔的长图同一套交互：先预览，再点\"保存图片\"下载", 1),
    ("/* 分类管理：'items' 只看物品分类 / 'notes' 只看收藏分类 / 'all' 两块平铺。",
     "/* 分类管理：'items' 只看物品分类 / 'notes' 只看随笔分类 / 'all' 两块平铺。", 1),
    ("// 一页平铺：上面物品分类，下面收藏分类（不用再点一次选哪个）",
     "// 一页平铺：上面物品分类，下面随笔分类（不用再点一次选哪个）", 1),
    ("openCatManager('notes');        // \"我的\"页\"随笔分类\"行：只看收藏分类",
     "openCatManager('notes');        // \"我的\"页\"随笔分类\"行：只看随笔分类", 1),
    ("/* 供其它模块复用（收藏、助手等）", "/* 供其它模块复用（随笔、助手等）", 1),
])

# ---------------- assistant.js ----------------
apply('assistant.js', [
    ("    collect: ['recent', 'oldest', 'title'],", "    note: ['recent', 'oldest', 'title'],", 1),
    ("        const g = SORT_OPTIONS[a.group];",
     "        const g = SORT_OPTIONS[a.group === 'collect' ? 'note' : a.group];", 1),
    ("return '新增收藏随笔「' + (a.title || '未命名') + '」' +",
     "return '新增随笔「' + (a.title || '未命名') + '」' +", 1),
    ("// 新增收藏随笔：标题必填，插件值按 App 约定收口",
     "// 新增随笔：标题必填，插件值按 App 约定收口", 1),
    ("if (a.type === 'set_sort') return '把' + (a.group === 'items' ? '物品' : a.group === 'collect' ? '收藏' : '能源') +",
     "if (a.type === 'set_sort') return '把' + (a.group === 'items' ? '物品' : a.group === 'energy' ? '能源' : '随笔') +", 1),
    ("      if (a.collect != null) parts.push('收藏' + (a.collect ? '显示' : '隐藏'));",
     "      const tabNote = a.note != null ? a.note : a.collect;\n"
     "      if (tabNote != null) parts.push('随笔' + (tabNote ? '显示' : '隐藏'));", 1),
    ("({ home: '首页', items: '物品', collect: '收藏', energy: '能源', me: '我的' }[a.tab] || a.tab)",
     "({ home: '首页', items: '物品', note: '随笔', collect: '随笔', energy: '能源', me: '我的' }[a.tab] || a.tab)", 1),
    ("return t.kind === 'collect' ? (it.title || '随笔') : (it.name || '物品');",
     "return (t.kind === 'note' || t.kind === 'collect') ? (it.title || '随笔') : (it.name || '物品');", 1),
    ("if (t.kind === 'collect') {", "if (t.kind === 'note' || t.kind === 'collect') {", 1),
    ("        if (a.collect == null && a.energy == null) { dropped++; return; }",
     "        const tabNote2 = a.note != null ? a.note : a.collect;\n"
     "        if (tabNote2 == null && a.energy == null) { dropped++; return; }", 1),
    ("        if (a.collect != null) t.collect = !!a.collect;",
     "        if (tabNote2 != null) t.note = !!tabNote2;", 1),
])

# f.kind 过滤 + it 选择（describe 与 apply 里共 4 处同样的两行模式）
with io.open(os.path.join(ROOT, 'assistant.js'), 'r', encoding='utf-8') as f:
    s = f.read()
pairs2 = [
    ("return (t.kind || 'item') === f.kind;", "return (t.kind === 'collect' ? 'note' : (t.kind || 'item')) === f.kind;", 3),
    ("const it = t.kind === 'collect' ? (t.entry || {}) : (t.item || {});",
     "const it = (t.kind === 'note' || t.kind === 'collect') ? (t.entry || {}) : (t.item || {});", 4),
]
for old, new, n in pairs2:
    got = s.count(old)
    assert got == n, 'assistant.js pass2: expected %d x %r, found %d' % (n, old[:50], got)
    s = s.replace(old, new)
with io.open(os.path.join(ROOT, 'assistant.js'), 'w', encoding='utf-8', newline='') as f:
    f.write(s)
print('OK assistant.js pass2')

# ---------------- prompts.js ----------------
apply('prompts.js', [
    ("帮用户管理物品（库存、过期、成本）、能源用量和图文随笔（收藏）。",
     "帮用户管理物品（库存、过期、成本）、能源用量和图文随笔。", 1),
    ("用户自己的收藏分类：{{NOTE_CATS}}", "用户自己的随笔分类：{{NOTE_CATS}}", 1),
    ("collect=recent/oldest/title", "note=recent/oldest/title", 1),
    ('"cat":"收藏分类"', '"cat":"随笔分类"', 1),
    ('"kind":"item|collect（可省）"', '"kind":"item|note（可省）"', 1),
    ('"group":"items|collect|energy"', '"group":"items|note|energy"', 1),
    ('{ "type":"set_tabs",     "collect":true|false, "energy":true|false }',
     '{ "type":"set_tabs",     "note":true|false, "energy":true|false }', 1),
    ('{ "type":"goto",         "tab":"home|items|collect|energy|me" }',
     '{ "type":"goto",         "tab":"home|items|note|energy|me" }', 1),
    ("收藏随笔的 cat 只能用收藏分类清单", "随笔的 cat 只能用随笔分类清单", 1),
    ('用户想"记一篇随笔 / 记录一次经历 / 收藏一段话"这类诉求用 add_note',
     '用户想"记一篇随笔 / 记录一次经历 / 保存一段话"这类诉求用 add_note', 1),
    ('· "物品和收藏各恢复最新删的一条" → 两个动作：filter:{kind:"item",latest:1} 和 filter:{kind:"collect",latest:1}',
     '· "物品和随笔各恢复最新删的一条" → 两个动作：filter:{kind:"item",latest:1} 和 filter:{kind:"note",latest:1}', 1),
    ("const isCollect = t.kind === 'collect';", "const isNote = t.kind === 'note' || t.kind === 'collect';", 1),
    ("(isCollect ? '收藏' : '物品')", "(isNote ? '随笔' : '物品')", 1),
    ("// 收藏分类来自随笔模块（可能没开启，缺省给通用清单）",
     "// 随笔分类来自随笔模块（可能没开启，缺省给通用清单）", 1),
])

# ---------------- backup.js ----------------
apply('backup.js', [
    (" *   - 导出：把物品 / 收藏 / 能源打包成一个文件", " *   - 导出：把物品 / 随笔 / 能源打包成一个文件", 1),
    ("      collect: on('collect') ? {", "      notes: on('notes') ? {", 1),
    ("{ key: 'collect', label: '收藏随笔',", "{ key: 'notes', label: '随笔',", 1),
    ("const total = pkg.app.items.length + pkg.collect.entries.length + pkg.app.meters.length;",
     "const total = pkg.app.items.length + pkg.notes.entries.length + pkg.app.meters.length;", 1),
    ("if (sel && sel.collect && pkg.collect.entries.length) bits.push('随笔 ' + pkg.collect.entries.length);",
     "if (sel && sel.notes && pkg.notes.entries.length) bits.push('随笔 ' + pkg.notes.entries.length);", 1),
    ("    const collect = pkg.collect || { entries: pkg.collects || [] };\n    return {\n"
     "      items: diffList(d.items, app.items),\n      events: diffList(d.events, app.events),\n"
     "      meters: diffList(d.meters, app.meters),\n      collect: diffList(snap.entries, collect.entries),",
     "    const notes = pkg.notes || pkg.collect || { entries: pkg.collects || [] };   // 旧备份字段叫 collect\n"
     "    return {\n"
     "      items: diffList(d.items, app.items),\n      events: diffList(d.events, app.events),\n"
     "      meters: diffList(d.meters, app.meters),\n      notes: diffList(snap.entries, notes.entries),", 1),
    ("diff.meters.conflict + diff.collect.conflict;", "diff.meters.conflict + diff.notes.conflict;", 1),
    ("diff.meters.added + diff.collect.added;", "diff.meters.added + diff.notes.added;", 1),
    ("    const collect = pkg.collect || { entries: pkg.collects || [] };",
     "    const notes = pkg.notes || pkg.collect || { entries: pkg.collects || [] };", 1),
    ("row('随笔', diff.collect, collect.entries && collect.entries.length)",
     "row('随笔', diff.notes, notes.entries && notes.entries.length)", 1),
    ("    const collect = pkg.collect || { entries: pkg.collects || [], cats: pkg.collectCats || [] };",
     "    const notes = pkg.notes || pkg.collect || { entries: pkg.collects || [], cats: pkg.collectCats || [] };", 1),
    ("    if (window.QYV && collect.entries) {\n      r = QYV.merge(collect, preferRemote);",
     "    if (window.QYV && notes.entries) {\n      r = QYV.merge(notes, preferRemote);", 1),
    ("    pkg.collect.entries = pkg.collect.entries.concat([", "    pkg.notes.entries = pkg.notes.entries.concat([", 1),
    ("      pkg.collect.entries[0] = c2;", "      pkg.notes.entries[0] = c2;", 1),
    ("if (!sel.items && !sel.collect && !sel.energy && !sel.settings && !sel.ai) {",
     "if (!sel.items && !sel.notes && !sel.energy && !sel.settings && !sel.ai) {", 1),
])

# ---------------- 注释与说明 ----------------
apply('ai.js', [
    (" *   - 备份只导出 xctally.prototype.v1 / xctally.collect.v1，",
     " *   - 备份只导出 xctally.prototype.v1 / xctally.note.v1（旧 xctally.collect.v1），", 1),
])
apply('icons.js', [
    (" * 数据层（data.js / collect.js / 备份文件）里存的仍是 emoji 字符串 ——",
     " * 数据层（data.js / notes.js / 备份文件）里存的仍是 emoji 字符串 ——", 1),
    ("/* 详情操作菜单（收藏：复制 / 长图 / 编辑） */", "/* 详情操作菜单（随笔：复制 / 长图 / 编辑） */", 1),
])
apply('index.html', [
    ('<script src="collect.js"></script>', '<script src="notes.js"></script>', 1),
    ('<li>「收藏」是<b>图文随笔</b>：评分 / 价格 / 定位按需挂载</li>',
     '<li>「随笔」支持<b>图文混排</b>：评分 / 价格 / 定位按需挂载</li>', 1),
])

# ---------------- 文件改名 collect.js → notes.js ----------------
src = os.path.join(ROOT, 'collect.js')
dst = os.path.join(ROOT, 'notes.js')
if os.path.exists(src):
    os.rename(src, dst)
    print('renamed collect.js -> notes.js')
print('ALL DONE')
