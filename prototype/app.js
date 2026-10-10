/* xctally · 交互层（原型）
 * 纯原生 JS，无构建、无依赖，双击 index.html 即可运行。
 * 数据存 localStorage，刷新不丢。
 */
(function () {
  'use strict';

  const QY = window.QY;
  const $ = function (s, r) { return (r || document).querySelector(s); };
  const esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  let data = QY.load();
  const state = { tab: 'home', detailId: null, category: '全部', query: '' };

  function save() { QY.save(data); }
  function itemById(id) {
    for (let i = 0; i < data.items.length; i++) if (data.items[i].id === id) return data.items[i];
    return null;
  }

  /* ---------------- 界面偏好（标签页显隐 / 三处排序） ----------------
   * 单独一个存储键，和业务数据分开：不进备份，清数据也不会顺手清掉。
   */
  const UI_KEY = 'xctally.ui.v1';
  const UI_DEFAULTS = {
    tabs: { home: true, items: true, collect: true, energy: true },
    sort: { items: 'date', collect: 'recent', energy: 'amount' }
  };
  // 这三个是主要入口（"我的"还是设置的入口），不允许隐藏
  const FORCED_TABS = { home: 1, items: 1, me: 1 };

  function ui() {
    let c = {};
    try { c = JSON.parse(localStorage.getItem(UI_KEY) || '{}') || {}; } catch (err) { c = {}; }
    return {
      tabs: Object.assign({}, UI_DEFAULTS.tabs, c.tabs || {}),
      sort: Object.assign({}, UI_DEFAULTS.sort, c.sort || {})
    };
  }
  function uiSet(patch) {
    const cur = ui();
    const next = {
      tabs: Object.assign({}, cur.tabs, (patch && patch.tabs) || {}),
      sort: Object.assign({}, cur.sort, (patch && patch.sort) || {})
    };
    try { localStorage.setItem(UI_KEY, JSON.stringify(next)); } catch (err) { /* 忽略 */ }
  }
  function tabVisible(id) { return !!FORCED_TABS[id] || ui().tabs[id] !== false; }

  const ITEMS_SORTS = [
    { v: 'date', t: '获得日期（新 → 旧）' },
    { v: 'dateAsc', t: '获得日期（旧 → 新）' },
    { v: 'price', t: '价格（高 → 低）' },
    { v: 'daily', t: '日均成本（高 → 低）' },
    { v: 'expiry', t: '到期日（近 → 远）' },
    { v: 'name', t: '按名称' }
  ];
  const COLLECT_SORTS = [
    { v: 'recent', t: '最近在前' },
    { v: 'oldest', t: '最早在前' },
    { v: 'title', t: '按标题' }
  ];
  const ENERGY_SORTS = [
    { v: 'amount', t: '本月金额（高 → 低）' },
    { v: 'name', t: '按名称' }
  ];

  const TABS = [
    { id: 'home', label: '首页', icon: I.home },
    { id: 'items', label: '物品', icon: I.items },
    { id: 'collect', label: '收藏', icon: I.collect },
    { id: 'energy', label: '能源', icon: I.energy },
    { id: 'me', label: '我的', icon: I.me }
  ];

  /* 清空数据：三次确认。删掉两个存储键即可 —— 重新加载时 load() 会给出空数据集 */
  function clearAllData() {
    const ask = function (msg, title, ok, danger) {
      if (!window.QYDialog || !QYDialog.confirm) {
        toast('确认组件未加载，已取消');
        return Promise.resolve(false);
      }
      return QYDialog.confirm(msg, { title: title, ok: ok, cancel: '取消', danger: danger });
    };
    ask('要清空所有数据吗？物品、事件、随笔、能源读数都会被删除。',
      '清空数据 1/3', '继续').then(function (a) {
      if (!a) return;
      ask('这一步不可恢复，也没有"恢复示例数据"可以退回。',
        '清空数据 2/3', '我确定').then(function (b) {
        if (!b) return;
        ask('最后一次确认：真的要清空吗？建议先导出备份。',
          '清空数据 3/3', '清空', true).then(function (c) {
          if (!c) return;
          try {
            localStorage.removeItem('xctally.prototype.v1');
            localStorage.removeItem('xctally.collect.v1');
          } catch (err) { /* 忽略 */ }
          location.reload();
        });
      });
    });
  }

  /* ---------------- 设置（全屏 · 两级导航 · iOS 风格） ----------------
   * state.setting 是路径：null = 不在设置里；[] = 一级菜单；['ai'] = 二级菜单。
   * 全屏渲染在 #view 里（不是半屏 sheet），并隐藏底部标签栏。
   */

  const GEAR = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"' +
    ' stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="12" cy="12" r="3.1"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6h.09A1.65 1.65 0 0 0 10.6 3.09V3a2 2 0 1 1 4 0v.09A1.65 1.65 0 0 0 16.11 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 20.4 9v.09a1.65 1.65 0 0 0 1.51 1H22a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';

  function setRow(action, title, opts) {
    opts = opts || {};
    return '<div class="set-row" data-action="' + action + '"' +
      (opts.k ? ' data-k="' + opts.k + '"' : '') + '>' +
      '<span class="set-title">' + esc(title) + '</span>' +
      (opts.side ? '<span class="set-value">' + esc(opts.side) + '</span>' : '') +
      (opts.chev ? '<span class="chev">›</span>' : '') +
      '</div>';
  }

  function switchRow(action, title, on) {
    return '<div class="set-row"><span class="set-title">' + esc(title) + '</span>' +
      '<label class="switch"><input type="checkbox" data-action="' + action + '"' +
      (on ? ' checked' : '') + ' /><i></i></label></div>';
  }

  function sortGroup(label, key, opts, cur) {
    return '<div class="set-group-title">' + esc(label) + '</div><div class="group">' +
      opts.map(function (o) {
        return '<div class="set-row" data-action="set-sort" data-g="' + key +
          '" data-v="' + o.v + '">' +
          '<span class="set-title">' + esc(o.t) + '</span>' +
          (cur === o.v ? '<span class="chev" style="color:var(--blue)">✓</span>' : '') +
          '</div>';
      }).join('') + '</div>';
  }

  function setNav(backAction, backLabel, title, sub) {
    return '<div class="navbar"><button class="back" data-action="' + backAction + '">‹ ' +
      esc(backLabel) + '</button></div>' + pageHead(title, sub || '');
  }

  /* 设置 → AI：余额直接显示在标题下方（框外），点一下刷新 */
  function loadAiBalance() {
    const box = document.getElementById('ai-balance-top');
    if (!box) return;
    if (!window.QYA || !QYA.cfg().key) { box.textContent = '未配置 Key'; return; }
    box.textContent = '余额查询中…';
    QYA.balance().then(function (b) {
      box.textContent = '余额 ' + b.currency + ' ' + b.total +
        ' · 赠送 ' + b.granted + ' · 充值 ' + b.toppedUp;
    }).catch(function (err) {
      box.textContent = '余额查询失败：' + ((err && err.message) || '未知错误');
    });
  }

  function settingsView() {
    const path = state.setting || [];
    const aiCfg = window.QYA ? QYA.cfg() : null;
    const u = window.QYA ? QYA.usage() : null;
    const aiReady = !!(window.QYO && QYO.ready());
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    const ballOn = !!(aiCfg && aiCfg.ball && !aiCfg.ball.hidden);
    const memBytes = localBytes();
    const memImg = window.QYV ? QYV.imageBytes() : 0;

    if (!path.length) {
      return setNav('set-close', '我的', '设置', '该开的开，该关的关') +
        '<div class="group" style="margin-top:16px">' +
          setRow('set-go', 'AI', { k: 'ai', side: aiReady ? '已开启' : '未配置', chev: true }) +
          setRow('set-go', '数据管理', { k: 'data', chev: true }) +
          setRow('set-go', '外观', { k: 'look', chev: true }) +
          setRow('set-go', '内存', { k: 'mem', side: humanBytes(memBytes), chev: true }) +
        '</div>';
    }

    const top = path[path.length - 1];
    const titles = { ai: 'AI', data: '数据管理', look: '外观', mem: '内存', tabs: '界面', sort: '排序' };
    const nav = setNav('set-back', '设置', titles[top] || '设置');

    if (top === 'ai') {
      return nav +
        '<div class="ai-balance" id="ai-balance-top" data-action="set-balance-refresh">' +
        ((aiCfg && aiCfg.key) ? '点这里查看余额' : '未配置 Key') + '</div>' +
        '<div class="group">' +
          setRow('i-ai-cfg', 'DeepSeek 配置', { side: (aiCfg && aiCfg.key) ? '已填 Key' : '未填', chev: true }) +
          setRow('i-ai-usage', '用量与额度', { side: (u && u.calls) ? u.calls + ' 次' : '未使用', chev: true }) +
          switchRow('set-ball', '对话助手悬浮球', ballOn) +
        '</div>';
    }
    if (top === 'data') {
      return nav + '<div class="group" style="margin-top:16px">' +
        setRow('b-export', '导出完整备份', { chev: true }) +
        setRow('b-import', '导入数据', { chev: true }) +
        setRow('i-trash', '回收站', { side: '保留 ' + QY.TRASH_DAYS + ' 天', chev: true }) +
        '</div>';
    }
    if (top === 'look') {
      const t0 = ui().tabs;
      const hidden = ['collect', 'energy'].filter(function (k) { return t0[k] === false; }).length;
      return nav + '<div class="group" style="margin-top:16px">' +
        switchRow('set-theme', '深色模式', dark) +
        setRow('set-go', '界面', { k: 'tabs', side: hidden ? '隐藏 ' + hidden + ' 个' : '全部显示', chev: true }) +
        setRow('set-go', '排序', { k: 'sort', chev: true }) +
        '</div>';
    }
    if (top === 'tabs') {
      const t = ui().tabs;
      return nav + '<div class="group" style="margin-top:16px">' +
        setRow('noop', '首页', { side: '必需' }) +
        setRow('noop', '物品', { side: '必需' }) +
        switchRow('set-tab-collect', '收藏', t.collect !== false) +
        switchRow('set-tab-energy', '能源', t.energy !== false) +
        setRow('noop', '我的', { side: '必需' }) +
        '</div>' +
        '<div class="notice" style="margin-top:12px">首页、物品、我的不能隐藏：' +
        '它们是主要入口，「我的」还是设置的入口。</div>';
    }
    if (top === 'sort') {
      const s = ui().sort;
      return nav +
        sortGroup('物品列表', 'items', ITEMS_SORTS, s.items) +
        sortGroup('收藏列表', 'collect', COLLECT_SORTS, s.collect) +
        sortGroup('能源列表', 'energy', ENERGY_SORTS, s.energy);
    }
    if (top === 'mem') {
      return nav + '<div class="group" style="margin-top:16px">' +
        setRow('noop', '本地占用', { side: humanBytes(memBytes) }) +
        setRow('noop', '其中随笔图片', { side: humanBytes(memImg) }) +
        setRow('clear-data', '清空数据', { chev: true }) +
        '</div>' +
        '<div class="notice" style="margin-top:12px">清空会删除物品、随笔、能源读数，' +
        '并需要连续确认三次。</div>';
    }
    return nav;
  }

  window.QYUI = {
    I: I,
    pageHead: pageHead,
    iconBtn: iconBtn,
    tile: tile,
    esc: esc,
    toast: toast,
    openSheet: openSheet,
    closeSheet: closeSheet,
    mount: mount,
    goItem: goItem,
    ui: ui,
    uiSet: uiSet,
    itemById: function (id) { return itemById(id); },
    data: function () { return data; },
    save: save
  };

  /* ---------------- 滚动相关 ----------------
   * 1) 滑列表时底部标签栏与对话悬浮球淡出，停手后淡回；
   *    快慢由【本次滑动的距离】决定：滑得越远，淡出/淡回越快，回来得也越晚。
   * 2) 只有用户主动滑动（触摸/滚轮）才触发动画 ——
   *    切换页面、点"回到顶部"这类程序滚动不该让控件闪一下。
   * 3) 往下滑之后，页面标题在顶部变成小长圆条，点它直接回到最上方。
   * 4) 每个标签页各自记住滚动位置，切回来还在原地；点同一个标签则回到顶部。
   */
  const PAGE_TITLES = { home: '今天', items: '物品', collect: '收藏', energy: '能源', me: '我的' };
  const scrollMemo = {};
  let scrollUiAllowed = false;     // 只有在用户触摸/滚轮之后才允许触发动画
  let gestureStartTop = null;
  let hideP = 0;                   // 0 = 完全显示，1 = 完全隐去（跟手）
  let settleTimer = null;
  let touching = false;
  const HIDE_AT = 300;             // 滑过这么多像素就完全隐去

  document.addEventListener('touchstart', function () { scrollUiAllowed = true; },
    { passive: true, capture: true });
  document.addEventListener('wheel', function () { scrollUiAllowed = true; },
    { passive: true, capture: true });
  document.addEventListener('touchend', function () { touching = false; armSettle(80); },
    { passive: true, capture: true });
  document.addEventListener('touchcancel', function () { touching = false; armSettle(80); },
    { passive: true, capture: true });

  function setHideP(p) {
    hideP = p < 0 ? 0 : (p > 1 ? 1 : p);
    const root = document.documentElement;
    root.style.setProperty('--hide-p', hideP.toFixed(3));
    root.classList.toggle('scrolling', hideP > 0.02);
    root.classList.toggle('hide-bars', hideP > 0.5);
  }

  /* 列表真正停下来之后才淡回。
     惯性滑动期间会不断有 scroll 事件，每次都会推迟这个定时器，所以不会提前恢复。 */
  function armSettle(delay) {
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(function () {
      settleTimer = null;
      if (touching) return;                    // 手指还按着，先不动
      // 淡回时长也跟进度走：隐得越多，回来稍慢一点，层次更像原生
      document.documentElement.style.setProperty('--fade-ms', Math.round(170 + hideP * 150) + 'ms');
      setHideP(0);
    }, delay == null ? 130 : delay);
  }

  (function initTopPill() {
    const el = document.createElement('div');
    el.id = 'to-top';
    el.className = 'to-top';
    el.setAttribute('data-action', 'to-top');
    el.innerHTML = '<span id="to-top-label"></span>';
    document.body.appendChild(el);
  })();

  function viewEl() { return document.getElementById('view'); }

  function resetScrollUi() {
    scrollUiAllowed = false;
    gestureStartTop = null;
    if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
    const root = document.documentElement;
    root.classList.add('no-anim');       // 程序滚动不补间，免得闪一下
    setHideP(0);
    requestAnimationFrame(function () { root.classList.remove('no-anim'); });
  }

  function rememberScroll() {
    const v = viewEl();
    if (v && !state.setting) scrollMemo[state.tab] = v.scrollTop;
  }

  function restoreScroll() {
    const v = viewEl();
    if (!v) return;
    v.scrollTop = state.setting ? 0 : (scrollMemo[state.tab] || 0);
    updateTopPill();
  }

  function updateTopPill() {
    const pill = document.getElementById('to-top');
    if (!pill) return;
    const lbl = document.getElementById('to-top-label');
    if (lbl) lbl.textContent = PAGE_TITLES[state.tab] || '';
    const v = viewEl();
    pill.classList.toggle('show', !!(v && !state.setting && v.scrollTop > 200));
  }

  document.addEventListener('scroll', function (e) {
    const t = e.target;
    if (!t || !t.classList || !t.classList.contains('view')) return;
    updateTopPill();
    if (!scrollUiAllowed) return;                  // 程序滚动：不参与淡入淡出
    if (gestureStartTop == null) gestureStartTop = t.scrollTop;
    setHideP(Math.abs(t.scrollTop - gestureStartTop) / HIDE_AT);   // 滑多少淡多少
    armSettle(140);
  }, true);

  // 先记下原始 hash：mount() 会把它改写成规范形式
  const bootHash = location.hash || '';
  applyHash();
  window.addEventListener('hashchange', function () { applyHash(); mount(); });
  mount();

  // 允许用 URL 直接打开表单 / 详情，方便截图与演示：
  // #items?bare&add | #energy?bare&reading | #collect?bare&cform
  // #cdetail=c_diary1?bare&light | ...&clong（生成长图）
  if (bootHash.indexOf('add') >= 0) {
    if (window.QYI) QYI.openForm(null);
    else openSheet(itemFormHTML());
  }
  if (bootHash.indexOf('reading') >= 0) openSheet(readingFormHTML(data.meters[0] && data.meters[0].id));
  if (bootHash.indexOf('cform') >= 0) {
    const addBtn = document.querySelector('[data-action="c-add"]');
    if (addBtn) addBtn.click();
  }
  if (bootHash.indexOf('clong') >= 0) {
    const imgBtn = document.querySelector('[data-action="c-long"]');
    if (imgBtn) imgBtn.click();
  }
  if (bootHash.indexOf('bimport') >= 0 && window.QYB) QYB.demoImport();
})();
