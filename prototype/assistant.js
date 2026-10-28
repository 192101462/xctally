/* 琪遇台账 · 对话助手 + 悬浮球
 * ---------------------------------------------------------------
 * 界面：右下角一个可拖动、可关闭的悬浮球，点开是聊天面板。
 *       位置与开关状态记在本机（存在 xctally.ai.v1 里，所以不会进备份）。
 *
 * 数据安全：模型【不直接改数据】，它只输出动作清单，App 校验后：
 *   - 只读问答 -> 直接显示
 *   - 任何写动作 -> 列成中文清单，用户点「执行」才落地
 *   - id 不存在于当前数据 -> 丢弃该动作并说明（模型会编 id）
 */
(function () {
  'use strict';

  const QY = window.QY;
  const QYA = window.QYA;      // 显式取，不依赖裸全局（见 prompts.js 同样的注释）
  function UI() { return window.QYUI; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  let msgs = [];        // 内存里的对话（不落盘：聊天记录会把 localStorage 撑爆）
  let busy = false;
  let pending = null;   // { reply, actions } 等用户确认
  let pendingImage = null;   // 待发送的图片 dataURL
  let ballEl = null;
  let drag = null;
  let justDragged = false;      // 刚拖完紧接着会有个 click，用它挡掉，避免误开对话

  const CAMERA = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"' +
    ' stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.2a1 1 0 0 0 .83-.45l.94-1.4A1 1 0 0 1 9.3 3.7h5.4a1 1 0 0 1 .83.45l.94 1.4A1 1 0 0 0 17.3 6h1.2A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z"/>' +
    '<circle cx="12" cy="12.6" r="3.6"/></svg>';

  function ballCfg() {
    const c = window.QYA ? QYA.cfg() : {};
    const b = c.ball || {};
    return {
      hidden: b.hidden === true,
      x: typeof b.x === 'number' ? b.x : null,
      y: typeof b.y === 'number' ? b.y : null
    };
  }
  function saveBall(patch) {
    const c = window.QYA ? QYA.cfg() : {};
    const b = Object.assign({}, c.ball || {}, patch);
    if (window.QYA) QYA.update({ ball: b });
  }

  /* ---------------- 悬浮球 ---------------- */

  function buildBall() {
    const el = document.createElement('div');
    el.className = 'ai-ball';
    el.id = 'ai-ball';
    el.innerHTML = '<span class="ai-ball-icon">' +
      (window.QYIcon ? QYIcon.forEmoji('💬', 26) : '💬') + '</span>';
    document.body.appendChild(el);
    return el;
  }

  function placeBall() {
    if (!ballEl) return;
    const b = ballCfg();
    const size = 56;
    const maxX = Math.max(8, window.innerWidth - size - 8);
    const maxY = Math.max(8, window.innerHeight - size - 90);
    const x = b.x == null ? maxX - 6 : Math.min(Math.max(8, b.x), maxX);
    const y = b.y == null ? maxY - 6 : Math.min(Math.max(8, b.y), maxY);
    ballEl.style.left = x + 'px';
    ballEl.style.top = y + 'px';
    ballEl.style.right = 'auto';
    ballEl.style.bottom = 'auto';
  }

  /* 配好了 Key 且用户没关掉，才显示悬浮球 */
  function syncBall() {
    const on = !!(window.QYA && QYA.ready()) && !ballCfg().hidden;
    if (!on) {
      if (ballEl) { ballEl.remove(); ballEl = null; }
      return;
    }
    if (!ballEl) ballEl = buildBall();
    placeBall();
  }

  function showBall() {
    saveBall({ hidden: false });
    syncBall();
    UI().toast('对话悬浮球已打开');
  }
  function hideBall() {
    saveBall({ hidden: true });
    syncBall();
    UI().toast('已关闭悬浮球，可在「我的 → AI 助手」里重新打开');
  }

  /* 拖动：位移超过阈值算拖动，否则算点击（打开面板） */
  const TRASH_SVG = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor"' +
    ' stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/><path d="M10 11v6M14 11v6"/></svg>';

  /* ---------------- 拖到垃圾桶关闭 ----------------
   * 拖动时底部露出垃圾桶：把球拖进去（高亮变红）松手即关闭。
   * 之前要"放进垃圾桶再按住 1.5 秒"，很难精准按住不动，实际没人能顺利关掉。
   * 误触防护靠三条：垃圾桶只在拖动时出现、球心要真正进入热区才高亮、
   * 没高亮时松手只是挪位置；关掉后 toast 告诉你去哪里重新打开。
   */
  let trashEl = null;
  let hintEl = null;

  function showDragUi() {
    if (!trashEl) {
      trashEl = document.createElement('div');
      trashEl.id = 'ball-trash';
      trashEl.className = 'ball-trash';
      trashEl.innerHTML = TRASH_SVG;
      document.body.appendChild(trashEl);
    }
    if (!hintEl) {
      hintEl = document.createElement('div');
      hintEl.id = 'ball-hint';
      hintEl.className = 'ball-hint';
      document.body.appendChild(hintEl);
    }
    trashEl.classList.add('show');
    hintEl.classList.add('show');
    hintEl.textContent = '拖到垃圾桶处松手关闭';
  }

  function hideDragUi() {
    if (trashEl) trashEl.classList.remove('show', 'hot');
    if (hintEl) hintEl.classList.remove('show');
  }

  function overTrash(cx, cy) {
    if (!trashEl || !trashEl.classList.contains('show')) return false;
    const r = trashEl.getBoundingClientRect();
    const pad = 10;
    return cx >= r.left - pad && cx <= r.right + pad && cy >= r.top - pad && cy <= r.bottom + pad;
  }

  /* 松手即关：位置一并重置，下次打开回右下角初始位置 */
  function closeByTrash() {
    hideDragUi();
    saveBall({ x: null, y: null, hidden: true });
    syncBall();
    UI().toast('已关闭悬浮球，可在「我的 → AI 助手」里重新打开');
  }

  function bindDrag() {
    document.addEventListener('pointerdown', function (e) {
      const el = e.target.closest && e.target.closest('#ai-ball');
      if (!el) return;
      if (e.target.closest('[data-ai="close"]')) return;
      const r = el.getBoundingClientRect();
      drag = {
        el: el, dx: e.clientX - r.left, dy: e.clientY - r.top,
        moved: false, sx: e.clientX, sy: e.clientY,
        tx: r.left, ty: r.top, raf: 0
      };
      el.classList.add('dragging');
    }, { passive: true });

    document.addEventListener('pointermove', function (e) {
      if (!drag) return;
      if (!drag.moved && Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) < 8) return;
      if (!drag.moved) { drag.moved = true; showDragUi(); }   // 真正开始拖动才露出垃圾桶
      const size = 56;
      drag.tx = Math.min(Math.max(8, e.clientX - drag.dx), Math.max(8, window.innerWidth - size - 8));
      drag.ty = Math.min(Math.max(8, e.clientY - drag.dy), Math.max(8, window.innerHeight - size - 90));
      // 一帧只写一次样式：pointermove 一秒能来上百次，逐次写会明显发抖
      if (!drag.raf) {
        drag.raf = requestAnimationFrame(function () {
          if (!drag) return;
          drag.raf = 0;
          drag.el.style.left = drag.tx + 'px';
          drag.el.style.top = drag.ty + 'px';
        });
      }
      // 球心进了垃圾桶热区：高亮 + 提示改为"松手关闭"
      const hot = overTrash(drag.tx + size / 2, drag.ty + size / 2);
      if (trashEl) trashEl.classList.toggle('hot', hot);
      if (hintEl && hintEl.classList.contains('show')) {
        hintEl.textContent = hot ? '松手关闭悬浮球' : '拖到垃圾桶处松手关闭';
      }
    }, { passive: true });

    function end() {
      if (!drag) return;
      const d = drag;
      drag = null;
      if (d.raf) cancelAnimationFrame(d.raf);
      d.el.classList.remove('dragging');
      const hot = trashEl && trashEl.classList.contains('hot');
      hideDragUi();
      if (hot) {                    // 在垃圾桶上松手 → 关闭
        closeByTrash();
        return;
      }
      if (d.moved) {
        // 落点用最后的目标值，别读 style（可能还差一帧没写进去）
        d.el.style.left = d.tx + 'px';
        d.el.style.top = d.ty + 'px';
        saveBall({ x: d.tx, y: d.ty });
        // 拖完还会冒一个 click，短时间内挡住它，别让"拖"变成"点"
        justDragged = true;
        setTimeout(function () { justDragged = false; }, 350);
      }
      // 注意：单纯的"点"不在这里处理 —— 交给下面的 click 事件。
      // 之前把 openChat 放在这里，导致手指点一下的轻微抖动被判成拖动，点了没反应。
    }
    document.addEventListener('pointerup', end);
    document.addEventListener('pointercancel', end);

    window.addEventListener('resize', placeBall);

    /* 点击悬浮球 = 打开对话。用原生 click，天然只在"真点了"时触发，
       不会再被手指的轻微抖动干扰。 */
    document.addEventListener('click', function (e) {
      const ball = e.target.closest && e.target.closest('#ai-ball');
      if (!ball) return;
      if (justDragged) return;
      e.preventDefault();
      e.stopPropagation();
      openChat();
    }, true);
  }

  /* ---------------- 聊天面板 ---------------- */

  function bubble(m) {
    if (m.role === 'user') {
      return '<div class="ai-msg me">' +
        (m.image ? '<img class="ai-msg-img" src="' + m.image + '" alt="" />' : '') +
        esc(m.text) + '</div>';
    }
    let html = '<div class="ai-msg bot">' + esc(m.text) + '</div>';
    // 深度思考的思考过程：默认收起，点开看全文
    if (m.reasoning) {
      html += '<details class="ai-think"><summary>✦ 思考过程</summary>' +
        '<div class="ai-think-body">' + esc(m.reasoning) + '</div></details>';
    }
    if (m.actions && m.actions.length) {
      const items = m.actions.map(function (a) { return '<li>' + esc(describe(a)) + '</li>'; }).join('');
      const done = m.applied === true;
      const dropped = m.dropped || 0;
      html += '<div class="ai-actions' + (done ? ' done' : '') + '">' +
        '<div class="ai-actions-head">' +
          (done ? (window.QYIcon ? QYIcon.forEmoji('✅', 14) : '✅') + ' 已执行' : '将要执行 ' + m.actions.length + ' 个动作') +
          (dropped ? '（' + dropped + ' 个被丢弃）' : '') + '</div>' +
        '<ul>' + items + '</ul>' +
        (done ? '' : '<div class="sheet-actions"><button class="btn plain" data-ai="skip">不用了</button>' +
          '<button class="btn primary" data-ai="apply">执行</button></div>') +
      '</div>';
    }
    return html;
  }

  /* 标题下那行小字：用了多少钱 / 多少次 */
  function usageLine() {
    const u = window.QYA ? QYA.usage() : null;
    if (!u || !u.calls) return '还没用过';
    return '已用 ' + (u.priced
      ? '¥' + u.cost.toFixed(3)
      : u.total.toLocaleString() + ' token') + ' · ' + u.calls + ' 次';
  }

  function renderChat() {
    const c = window.QYA ? QYA.cfg() : {};
    const think = c.think === true;
    const body = msgs.length
      ? msgs.map(bubble).join('')
      : '<div class="ai-hint">可以这样说：<br>' +
        '「昨天买的牛奶 15.9 两瓶，放冰箱了」<br>' +
        '「这个月在食品上花了多少」<br>' +
        '「哪些东西快过期了」<br>' +
        '或者直接发一张<b>订单截图 / 小票</b>，我帮你把商品提出来。</div>';
    return '<div class="sheet ai-sheet"><div class="grabber"></div>' +
      '<div class="ai-head">' +
        '<div><h3>助手</h3><div class="ai-sub">' + esc(usageLine()) + '</div></div>' +
        // 深度思考开关：同一个模型开启思考模式（答得更细，也更慢更贵）
        '<button type="button" class="chip think ' + (think ? 'active' : '') +
          '" data-ai="think" aria-label="深度思考">' + (think ? '✦ 深度思考' : '✧ 深度思考') + '</button>' +
      '</div>' +
      '<div class="ai-log" id="ai-log">' + body + '</div>' +
      (busy && think
        ? '<div class="ai-thinking">✦ 深度思考中，思考会花一些时间…</div>'
        : '') +
      (pendingImage
        ? '<div class="ai-attach"><img src="' + pendingImage + '" alt="" />' +
          '<button class="ai-attach-x" data-ai="unpick" aria-label="移除图片">×</button></div>'
        : '') +
      '<div class="ai-input">' +
        '<button class="ai-pic" data-ai="pick" aria-label="发送图片">' + CAMERA + '</button>' +
        '<textarea id="ai-text" class="input" rows="1" placeholder="说点什么，或发张截图…"' +
          ' autocomplete="off"' + (busy ? ' disabled' : '') + '></textarea>' +
        '<button class="btn primary" data-ai="send"' + (busy ? ' disabled' : '') + '>' +
          (busy ? '…' : '发送') + '</button>' +
      '</div></div>';
  }

  function openChat() {
    if (!window.QYA || !QYA.ready()) { UI().toast('先在「我的 → 设置 → AI」里填 DeepSeek API Key'); return; }
    pending = null;
    UI().openSheet(renderChat());      // 开面板时球隐去；关面板后球自己回来
    scrollLog();
    const t = document.getElementById('ai-text');
    if (t) t.focus();
  }

  function rerenderChat() {
    UI().openSheet(renderChat());
    scrollLog();
  }

  function scrollLog() {
    const log = document.getElementById('ai-log');
    if (log) log.scrollTop = log.scrollHeight;
  }

  /* ---------------- 动作 ---------------- */

  function itemById(id) {
    return (UI().data().items || []).filter(function (i) { return i.id === id; })[0] || null;
  }

  /* 提醒时间解析：收 9 / "9" / "9:30"，缺省 9:00 */
  function parseRemindHM(v) {
    if (typeof v === 'string' && v.indexOf(':') >= 0) {
      const p = v.split(':');
      return { h: Math.max(0, Math.min(23, parseInt(p[0], 10) || 0)),
               m: Math.max(0, Math.min(59, parseInt(p[1], 10) || 0)) };
    }
    return { h: Math.max(0, Math.min(23, parseInt(v, 10) || 9)), m: 0 };
  }

  /* 按名字找物品：精确 → 唯一包含；多个/零个都返回 null（宁可不做也别改错） */
  function findByName(name) {
    const n = String(name || '').trim();
    if (!n) return null;
    let m = UI().data().items.filter(function (i) { return i.name === n; });
    if (!m.length) m = UI().data().items.filter(function (i) { return (i.name || '').indexOf(n) >= 0; });
    return m.length === 1 ? m[0] : null;
  }

  /* 按标题找随笔（AI 不拿 entries 全表，靠唯一标题/前缀匹配） */
  function findNote(title) {
    const n = String(title || '').trim();
    if (!n || !window.QYV) return null;
    const snap = QYV.snapshot();
    let m = snap.entries.filter(function (e) { return e.title === n; });
    if (!m.length) m = snap.entries.filter(function (e) { return (e.title || '').indexOf(n) >= 0; });
    return m.length === 1 ? m[0] : null;
  }

  /* 按名称找表具（抄表用） */
  function findMeter(name) {
    const n = String(name || '').trim();
    if (!n) return null;
    const ms = UI().data().meters || [];
    let m = ms.filter(function (x) { return x.name === n; });
    if (!m.length) m = ms.filter(function (x) { return (x.name || '').indexOf(n) >= 0; });
    return m.length === 1 ? m[0] : null;
  }

  /* 时间线手动记一笔允许的类型（与 items.js 的 MANUAL_EVENT_TYPES 保持一致） */
  const EVENT_TYPES_ALLOWED = ['used', 'opened', 'repaired', 'replaced', 'lent', 'returned', 'disposed', 'status'];

  /* 背景 preset 归一：接受编码（p3）、中文名（雾蓝）、混写（p3雾蓝），
     归一不成的返回 null（丢弃）。 */
  function normalizeBgPreset(v) {
    const s = String(v == null ? '' : v).trim();
    if (!s) return null;
    const byCode = ['default', 'p1', 'p2', 'p3', 'p4', 'p5'].filter(function (c) { return s === c; })[0];
    if (byCode) return byCode;
    const names = { 奶油: 'p1', 淡粉: 'p2', 粉: 'p2', 雾蓝: 'p3', 蓝: 'p3', 薄荷: 'p4', 绿: 'p4', 浅紫: 'p5', 紫: 'p5', 默认: 'default' };
    if (names[s]) return names[s];
    const m = s.match(/^(p[1-5])/);
    if (m) return m[1];                       // "p3雾蓝" → p3
    const hit = Object.keys(names).filter(function (k) { return s.indexOf(k) >= 0; })[0];
    return hit ? names[hit] : null;           // "换成雾蓝" → p3
  }

  /* delete_records 影响范围（描述和二确都展示具体条数，用户看得见代价） */
  function countRecords(a) {
    const d = UI().data();
    if (a.scope === 'items') {
      return d.items.filter(function (i) { return i.acquiredAt && i.acquiredAt < a.before; }).length;
    }
    return (d.events || []).filter(function (e) { return e.at && e.at < a.before; }).length;
  }

  /* 排序选项词表（提示词注入 + 动作校验共用）。加新排序时同步这里和设置页。 */
  const SORT_OPTIONS = {
    items: ['date', 'dateAsc', 'price', 'daily', 'expiry', 'name'],
    note: ['recent', 'oldest', 'title'],
    energy: ['amount', 'name']
  };

  function describe(a) {
    if (!a || !a.type) return '（无法识别的动作）';
    const it = a.id ? itemById(a.id) : null;
    const name = it ? it.name : (a.name || a.id || '');
    if (a.type === 'add_item') {
      return '新增物品「' + (a.name || '未命名') + '」' +
        (a.price != null ? '，价格 ' + a.price : '，价格留空') +
        (a.qty ? '，数量 ' + a.qty : '') +
        (a.category ? '，分类 ' + a.category : '') +
        (a.acquiredAt ? '，获得日期 ' + a.acquiredAt : '');
    }
    if (a.type === 'add_note') {
      return '新增随笔「' + (a.title || '未命名') + '」' +
        (a.cat ? '，分类 ' + a.cat : '') +
        (a.rating ? '，★' + a.rating : '') +
        (a.price != null ? '，价格 ' + a.price : '') +
        (a.body ? '，正文 ' + String(a.body).length + ' 字' : '');
    }
    if (a.type === 'update_item') {
      const keys = Object.keys(a.fields || {});
      return '修改「' + name + '」：' + (keys.length ? keys.map(function (k) {
        return k + ' → ' + a.fields[k];
      }).join('，') : '（没有具体字段）');
    }
    if (a.type === 'set_status') {
      const target = it || findByName(a.name);
      return '把「' + (target ? target.name : (a.name || '未找到')) + '」的状态改为 ' + (a.status || '?');
    }
    if (a.type === 'set_archived') return (a.archived ? '归档「' : '取消归档「') + name + '」';
    if (a.type === 'set_pinned') return (a.pinned ? '置顶「' : '取消置顶「') + name + '」';
    if (a.type === 'delete_item') return '删除「' + name + '」（进回收站，30 天内可恢复）';
    if (a.type === 'set_theme') {
      return '切换' + (a.mode === 'dark' ? '深色' : a.mode === 'light' ? '浅色' : '跟随系统') + '模式';
    }
    if (a.type === 'check_update') return '检查应用更新（结果会自动弹出）';
    if (a.type === 'delete_records') {
      const n = countRecords(a);
      return '删除 ' + a.before + ' 之前的' + (a.scope === 'items' ? '物品（进回收站）' : '时间线记录（不可恢复）') +
        '，共 ' + n + ' 条' + (n ? '' : '（没有符合条件的）');
    }
    /* 回收站动作的匹配求解：ids 优先，否则按 filter（kind/query/latest）。
     * 清单顺序 = 删除时间从新到旧（和【回收站】提示里一致）。 */
    if (a.type === 'set_item_reminder') {
      const it = a.id ? (UI().data().items.filter(function (x) { return x.id === a.id; })[0] || null) : findByName(a.name);
      const nm = it ? it.name : (a.name || '未找到');
      if (a.on === false) return '关闭「' + nm + '」的每日提醒';
      const hm = parseRemindHM(a.hour);
      return '开启「' + nm + '」每日提醒：' + hm.h + ':' + (hm.m < 10 ? '0' : '') + hm.m +
        (a.alarm ? '（闹铃）' : '');
    }
    if (a.type === 'clear_item_reminders') {
      if (a.all) return '清除全部每日提醒';
      const it = a.id ? (UI().data().items.filter(function (x) { return x.id === a.id; })[0] || null) : findByName(a.name);
      return '清除「' + (it ? it.name : (a.name || '未找到')) + '」的每日提醒';
    }
    if (a.type === 'trash_restore' || a.type === 'trash_purge') {
      const d = UI().data();
      let list = (d.trash || []).slice().sort(function (x, y) {
        return x.deletedAt < y.deletedAt ? 1 : -1;
      });
      const f = a.filter || {};
      if (Array.isArray(a.ids) && a.ids.length) {
        const want = {};
        a.ids.forEach(function (id) { want[id] = true; });
        list = list.filter(function (t) { return want[t.id]; });
      } else {
        if (f.kind) list = list.filter(function (t) { return (t.kind === 'collect' ? 'note' : (t.kind || 'item')) === f.kind; });
        if (f.query) {
          const q = String(f.query).toLowerCase();
          list = list.filter(function (t) {
            const it = (t.kind === 'note' || t.kind === 'collect') ? (t.entry || {}) : (t.item || {});
            return ((it.name || '') + (it.title || '') + (it.category || '') + (it.cat || ''))
              .toLowerCase().indexOf(q) >= 0;
          });
        }
        if (f.latest) list = list.slice(0, Math.max(1, Number(f.latest) || 1));
      }
      const verb = a.type === 'trash_restore' ? '从回收站恢复' : '从回收站彻底删除';
      if (!list.length) return verb + '（没有匹配的条目）';
      return verb + ' ' + list.length + ' 项：' +
        list.slice(0, 5).map(function (t) {
          const it = (t.kind === 'note' || t.kind === 'collect') ? (t.entry || {}) : (t.item || {});
          return (t.kind === 'note' || t.kind === 'collect') ? (it.title || '随笔') : (it.name || '物品');
        }).join('、') + (list.length > 5 ? ' 等' : '');
    }
    if (a.type === 'restore_item') {
      const t = (UI().data().trash || []).filter(function (x) {
        return x.item && x.item.name && (a.name ? x.item.name.indexOf(a.name) >= 0 : false);
      })[0];
      return '从回收站恢复「' + (t ? t.item.name : (a.name || '未找到')) + '」';
    }
    if (a.type === 'empty_trash') {
      return '清空回收站（' + (UI().data().trash || []).length + ' 项彻底删除，不可恢复）';
    }
    if (a.type === 'add_category') {
      return '新建物品分类「' + a.name + '」' +
        (a.statuses && a.statuses.length ? '，状态词：' + a.statuses.join(' / ') : '');
    }
    if (a.type === 'update_category') {
      return '调整分类「' + a.name + '」的状态词为：' + (a.statuses || []).join(' / ');
    }
    if (a.type === 'delete_category') {
      const used = UI().data().items.filter(function (i) { return i.category === a.name; }).length;
      return '删除分类「' + a.name + '」' + (used ? '，' + used + ' 件物品会归入「其他」' : '');
    }
    if (a.type === 'add_reading') return '抄表：' + a.meter + ' 记 ' + a.value;
    if (a.type === 'add_event') {
      const target = (a.id ? itemById(a.id) : null) || findByName(a.name);
      return '给「' + (target ? target.name : (a.name || '未找到')) + '」记一笔：' +
        (QY.EVENT_TYPES[a.evType] || { label: a.evType }).label +
        (a.amount != null ? ' ¥' + a.amount : '') + (a.note ? '（' + a.note + '）' : '');
    }
    if (a.type === 'update_note') {
      const e = a.id ? null : findNote(a.title);
      return '修改随笔「' + ((e && e.title) || a.title) + '」：' +
        Object.keys(a.fields || {}).join('、');
    }
    if (a.type === 'delete_note') {
      const e2 = findNote(a.title);
      return '删除随笔「' + ((e2 && e2.title) || a.title) + '」';
    }
    if (a.type === 'set_sort') return '把' + (a.group === 'items' ? '物品' : a.group === 'energy' ? '能源' : '随笔') +
      '列表按「' + a.value + '」排序';
    if (a.type === 'set_tabs') {
      const parts = [];
      const tabNote = a.note != null ? a.note : a.collect;
      if (tabNote != null) parts.push('随笔' + (tabNote ? '显示' : '隐藏'));
      if (a.energy != null) parts.push('能源' + (a.energy ? '显示' : '隐藏'));
      return '界面标签：' + parts.join('，');
    }
    if (a.type === 'set_bg') {
      const names = { default: '默认', p1: '奶油', p2: '淡粉', p3: '雾蓝', p4: '薄荷', p5: '浅紫' };
      return '切换浅色背景为「' + (names[a.preset] || a.preset) + '」（深色模式不受影响）';
    }
    if (a.type === 'goto') return '打开' + ({ home: '首页', items: '物品', note: '随笔', collect: '随笔', energy: '能源', me: '我的' }[a.tab] || a.tab) + '页';
    if (a.type === 'export_backup') return '导出完整备份（会弹系统保存面板）';
    if (a.type === 'clear_data') return '清空全部数据（会连问 3 次确认）';
    return a.type;
  }

  function applyActions(actions) {
    const d = UI().data();
    const cats = QY.catList(d).map(function (c) { return c.name; });
    let applied = 0;
    let dropped = 0;

    actions.forEach(function (a) {
      if (!a || !a.type) { dropped++; return; }
      if (a.type === 'add_item') {
        let cat = String(a.category || '').trim();
        if (cats.indexOf(cat) < 0) cat = '其他';
        const item = {
          id: QY.uid('it'), icon: '', name: String(a.name || '').trim() || '未命名',
          category: cat, sub: a.sub || '',
          acquiredAt: a.acquiredAt || QY.iso(QY.today()),
          source: a.source || '', cost: a.price == null ? null : Number(a.price),
          qty: Number(a.qty) || 1, unit: '个', status: '在用',
          location: a.location || '', expiresAt: null, openedAt: null, warrantyUntil: null,
          note: a.note || '', photo: null, pinned: false, archived: false,
          costTrack: QY.catOf(cat, d).costTrack !== false
        };
        d.items.push(item);
        d.events.push({
          id: QY.uid('ev'), itemId: item.id, type: 'acquired',
          at: item.acquiredAt, amount: item.cost, note: item.source
        });
        applied++;
        return;
      }
      if (a.type === 'add_note') {
        // 新增随笔：标题必填，插件值按 App 约定收口
        if (!window.QYV || !QYV.addEntry) { dropped++; return; }
        const title = String(a.title || '').trim();
        if (!title) { dropped++; return; }
        const plugins = [];
        if (a.rating != null && Number(a.rating) > 0) plugins.push({ k: 'rating', v: Number(a.rating) });
        if (a.price != null && a.price !== '') plugins.push({ k: 'price', v: Number(a.price) });
        if (a.mood) plugins.push({ k: 'mood', v: String(a.mood) });
        QYV.addEntry({
          title: title,
          cat: a.cat || '',
          date: a.date || QY.iso(QY.today()),
          tags: a.tags || [],
          plugins: plugins,
          body: a.body || ''
        });
        applied++;
        return;
      }
      /* ---- 不针对具体物品的动作 ---- */
      if (a.type === 'set_theme') {
        const mode = a.mode === 'dark' || a.mode === 'light' || a.mode === 'auto' ? a.mode : null;
        if (!mode) { dropped++; return; }
        UI().uiSet({ theme: mode });
        if (UI().applyTheme) UI().applyTheme();
        applied++;
        return;
      }
      if (a.type === 'set_bg') {
        // 模型有时会照提示词里的标签文字返回"奶油"/"p1奶油"之类，
        // 统一归一成编码再校验，别让改背景永远"被丢弃"
        const norm = normalizeBgPreset(a.preset);
        if (!norm) { dropped++; return; }
        UI().uiSet({ bg: { preset: norm, img: null } });
        if (UI().applyBackground) UI().applyBackground();
        applied++;
        return;
      }
      if (a.type === 'set_sort') {
        const g = SORT_OPTIONS[a.group === 'collect' ? 'note' : a.group];
        if (!g || g.indexOf(a.value) < 0) { dropped++; return; }
        const patch = {};
        patch[a.group] = a.value;
        UI().uiSet({ sort: patch });
        applied++;
        return;
      }
      if (a.type === 'set_tabs') {
        const tabNote2 = a.note != null ? a.note : a.collect;
        if (tabNote2 == null && a.energy == null) { dropped++; return; }
        const t = {};
        if (tabNote2 != null) t.note = !!tabNote2;
        if (a.energy != null) t.energy = !!a.energy;
        UI().uiSet({ tabs: t });
        applied++;
        return;
      }
      if (a.type === 'goto') {
        if (UI().gotoTab) { UI().gotoTab(a.tab); applied++; }
        else dropped++;
        return;
      }
      if (a.type === 'export_backup') {
        if (window.QYB && QYB.doExport) { QYB.doExport(); applied++; }
        else dropped++;
        return;
      }
      if (a.type === 'clear_data') {
        // clearAllData 自带 3 步确认，不需要再叠二确
        if (UI().clearData) { UI().clearData(); applied++; }
        else dropped++;
        return;
      }
      if (a.type === 'restore_item') {
        const name = String(a.name || '').trim();
        const t = name ? (d.trash || []).filter(function (x) {
          return x.item && x.item.name && x.item.name.indexOf(name) >= 0;
        }) : [];
        if (t.length !== 1) { dropped++; return; }
        d.items.push(t[0].item);
        (t[0].events || []).forEach(function (e) { d.events.push(e); });
        d.trash = d.trash.filter(function (x) { return x.id !== t[0].id; });
        UI().toast('已恢复「' + t[0].item.name + '」');
        applied++;
        return;
      }
      if (a.type === 'set_item_reminder') {
        const it = a.id ? (d.items.filter(function (x) { return x.id === a.id; })[0] || null)
          : findByName(a.name);
        if (!it) { dropped++; return; }
        if (a.on === false) {
          delete it.reminder;
          UI().toast('已关闭「' + it.name + '」的每日提醒');
        } else {
          const hm = parseRemindHM(a.hour);
          it.reminder = { on: true, hour: hm.h, minute: hm.m, alarm: a.alarm === true };
          UI().toast('已开启每日提醒：' + hm.h + ':' + (hm.m < 10 ? '0' : '') + hm.m + '「' + it.name + '」' + (it.reminder.alarm ? '（闹铃）' : ''));
        }
        if (window.QYI && QYI.pushReminders) QYI.pushReminders();
        applied++;
        return;
      }
      if (a.type === 'clear_item_reminders') {
        if (a.all) {
          let n = 0;
          d.items.forEach(function (it) { if (it.reminder) { delete it.reminder; n++; } });
          UI().toast(n ? '已清除 ' + n + ' 条每日提醒' : '本来就没有每日提醒');
        } else {
          const it = a.id ? (d.items.filter(function (x) { return x.id === a.id; })[0] || null)
          : findByName(a.name);
          if (!it || !it.reminder) { dropped++; return; }
          delete it.reminder;
          UI().toast('已清除「' + it.name + '」的每日提醒');
        }
        if (window.QYI && QYI.pushReminders) QYI.pushReminders();
        applied++;
        return;
      }
      if (a.type === 'trash_restore') {
        // 与 describe 同一套匹配：ids 优先，否则 filter(kind/query/latest)
        let list = (d.trash || []).slice().sort(function (x, y) {
          return x.deletedAt < y.deletedAt ? 1 : -1;
        });
        const f = a.filter || {};
        if (Array.isArray(a.ids) && a.ids.length) {
          const want = {};
          a.ids.forEach(function (id) { want[id] = true; });
          list = list.filter(function (t) { return want[t.id]; });
        } else {
          if (f.kind) list = list.filter(function (t) { return (t.kind === 'collect' ? 'note' : (t.kind || 'item')) === f.kind; });
          if (f.query) {
            const q = String(f.query).toLowerCase();
            list = list.filter(function (t) {
              const it = (t.kind === 'note' || t.kind === 'collect') ? (t.entry || {}) : (t.item || {});
              return ((it.name || '') + (it.title || '') + (it.category || '') + (it.cat || ''))
                .toLowerCase().indexOf(q) >= 0;
            });
          }
          if (f.latest) list = list.slice(0, Math.max(1, Number(f.latest) || 1));
        }
        if (!list.length) { dropped++; return; }
        let n = 0;
        const gone = {};
        list.forEach(function (t) {
          gone[t.id] = true;
          if (t.kind === 'note' || t.kind === 'collect') {
            if (window.QYV && QYV.restoreEntry && QYV.restoreEntry(t.entry)) n++;
          } else {
            d.items.push(t.item);
            (t.events || []).forEach(function (ev) { d.events.push(ev); });
            n++;
          }
        });
        d.trash = d.trash.filter(function (x) { return !gone[x.id]; });
        UI().toast('已从回收站恢复 ' + n + ' 项');
        applied++;
        return;
      }
      if (a.type === 'trash_purge') {
        // 危险动作：执行前已被红色二确拦过（dangerTypes 里登记）
        let list = (d.trash || []).slice();
        const f = a.filter || {};
        if (Array.isArray(a.ids) && a.ids.length) {
          const want = {};
          a.ids.forEach(function (id) { want[id] = true; });
          list = list.filter(function (t) { return want[t.id]; });
        } else {
          list.sort(function (x, y) { return x.deletedAt < y.deletedAt ? 1 : -1; });
          if (f.kind) list = list.filter(function (t) { return (t.kind === 'collect' ? 'note' : (t.kind || 'item')) === f.kind; });
          if (f.query) {
            const q = String(f.query).toLowerCase();
            list = list.filter(function (t) {
              const it = (t.kind === 'note' || t.kind === 'collect') ? (t.entry || {}) : (t.item || {});
              return ((it.name || '') + (it.title || '') + (it.category || '') + (it.cat || ''))
                .toLowerCase().indexOf(q) >= 0;
            });
          }
          if (f.latest) list = list.slice(0, Math.max(1, Number(f.latest) || 1));
        }
        if (!list.length) { dropped++; return; }
        const gone = {};
        list.forEach(function (t) { gone[t.id] = true; });
        d.trash = d.trash.filter(function (x) { return !gone[x.id]; });
        UI().toast('已彻底删除 ' + list.length + ' 项');
        applied++;
        return;
      }
      if (a.type === 'empty_trash') {
        // 危险动作：执行前已被红色二确拦过（见 apply 处理器）
        const n = (d.trash || []).length;
        d.trash = [];
        UI().toast('回收站已清空（' + n + ' 项）');
        applied++;
        return;
      }
      if (a.type === 'add_category') {
        const nm = String(a.name || '').trim();
        if (!nm || QY.catList(d).some(function (c) { return c.name === nm; })) { dropped++; return; }
        const sts = (Array.isArray(a.statuses) ? a.statuses : []).map(String).filter(Boolean);
        d.itemCats.push({
          name: nm, emoji: '📦',
          g: ['#ECECF1', '#CFCFD8'], costTrack: true,
          statuses: sts.length ? sts : ['未开封', '使用中', '已用完']
        });
        applied++;
        return;
      }
      if (a.type === 'update_category') {
        const c = QY.catList(d).filter(function (x) { return x.name === a.name; })[0];
        const sts = (Array.isArray(a.statuses) ? a.statuses : []).map(String).filter(Boolean);
        if (!c || sts.length < 2) { dropped++; return; }
        c.statuses = sts;
        d.items.forEach(function (i) {
          if (i.category === c.name && sts.indexOf(i.status) < 0) i.status = sts[0];
        });
        applied++;
        return;
      }
      if (a.type === 'delete_category') {
        const nm = String(a.name || '').trim();
        const c = QY.catList(d).filter(function (x) { return x.name === nm; })[0];
        if (!c) { dropped++; return; }
        d.itemCats = QY.catList(d).filter(function (x) { return x.name !== nm; });
        if (!d.itemCats.length) {
          d.itemCats = QY.DEFAULT_CATS.map(function (x) {
            return { name: x.name, emoji: x.emoji, g: x.g.slice(), costTrack: x.costTrack, statuses: (x.statuses || []).slice() };
          });
        }
        d.items.forEach(function (i) { if (i.category === nm) i.category = '其他'; });
        applied++;
        return;
      }
      if (a.type === 'add_reading') {
        const m = findMeter(a.meter);
        const usage = Number(a.value);
        if (!m || !usage || usage <= 0) { dropped++; return; }
        const last = m.history[m.history.length - 1];
        m.current.usage = usage;
        m.current.cost = Number((usage * m.tier.price).toFixed(2));
        m.current.projected = usage;
        m.current.projectedCost = m.current.cost;
        m.current.trend = last && last.cost ? (m.current.cost - last.cost) / last.cost : 0;
        m.tier.used = usage;
        m.history.push({ at: QY.iso(QY.today()), usage: usage, cost: m.current.cost });
        UI().toast(m.name + ' 已抄表');
        applied++;
        return;
      }
      if (a.type === 'add_event') {
        const it2 = (a.id ? itemById(a.id) : null) || findByName(a.name);
        if (!it2 || EVENT_TYPES_ALLOWED.indexOf(a.evType) < 0) { dropped++; return; }
        d.events.push({
          id: QY.uid('ev'), itemId: it2.id, type: a.evType,
          at: /^\d{4}-\d{2}-\d{2}$/.test(a.at || '') ? a.at : QY.iso(QY.today()),
          amount: a.amount != null && a.amount !== '' ? Number(a.amount) : null,
          note: a.note || null
        });
        applied++;
        return;
      }
      if (a.type === 'update_note') {
        if (!window.QYV || !QYV.updateEntry) { dropped++; return; }
        const e = findNote(a.title);
        if (!e) { dropped++; return; }
        if (QYV.updateEntry(e.id, a.fields || {})) applied++; else dropped++;
        return;
      }
      if (a.type === 'delete_note') {
        if (!window.QYV || !QYV.deleteEntry) { dropped++; return; }
        const e = findNote(a.title);
        if (!e) { dropped++; return; }
        if (QYV.deleteEntry(e.id)) { applied++; UI().toast('已删除随笔'); } else dropped++;
        return;
      }
      if (a.type === 'check_update') {
        // 和设置页同一个入口：结果由原生回调 QYUpd.onResult 自动弹出
        if (window.QYAndroid && QYAndroid.checkUpdate) {
          UI().toast('正在检查更新…');
          QYAndroid.checkUpdate();
          applied++;
        } else if (window.QYPlatform && QYPlatform.kind === 'harmony') {
          UI().toast('鸿蒙版请在应用市场更新');
          dropped++;
        } else {
          UI().toast('请在手机 App 里让我检查更新');
          dropped++;
        }
        return;
      }
      if (a.type === 'delete_records') {
        // 危险动作：真正的执行在 doApplyActions 之前已被二次确认拦过一道
        if (!a.before || !/^\d{4}-\d{2}-\d{2}$/.test(a.before)) { dropped++; return; }
        if (a.scope === 'items') {
          d.trash = d.trash || [];
          const cut = d.items.filter(function (i) { return i.acquiredAt && i.acquiredAt < a.before; });
          cut.forEach(function (i) {
            d.trash.push({
              id: QY.uid('tr'), kind: 'item', deletedAt: QY.iso(QY.today()),
              item: i, events: d.events.filter(function (e) { return e.itemId === i.id; })
            });
          });
          const ids = cut.map(function (i) { return i.id; });
          d.items = d.items.filter(function (i) { return ids.indexOf(i.id) < 0; });
          d.events = d.events.filter(function (e) { return ids.indexOf(e.itemId) < 0; });
          UI().toast('已删 ' + cut.length + ' 件物品（回收站 30 天）');
          applied++;
        } else {
          const before = (d.events || []).filter(function (e) { return e.at && e.at < a.before; }).length;
          d.events = (d.events || []).filter(function (e) { return !(e.at && e.at < a.before); });
          UI().toast('已删 ' + before + ' 条时间线记录');
          applied++;
        }
        return;
      }
      if (a.type === 'set_status') {
        // 优先 id，其次唯一匹配的名字；状态词必须是该分类词表里的
        const st = (a.id ? itemById(a.id) : null) || findByName(a.name);
        if (!st || !a.status) { dropped++; return; }
        const vocab = QY.catStatuses(st.category, d);
        if (vocab.indexOf(a.status) < 0) { dropped++; return; }
        if (window.QYI && QYI.applyStatus) QYI.applyStatus(st, a.status);
        else st.status = a.status;
        applied++;
        return;
      }
      const it = a.id ? itemById(a.id) : null;
      if (!it) { dropped++; return; }          // 模型编的 id：丢弃
      if (a.type === 'update_item') {
        Object.keys(a.fields || {}).forEach(function (k) {
          if (k === 'id' || k === 'photo') return;
          it[k] = a.fields[k];
        });
        applied++;
      } else if (a.type === 'set_archived') {
        it.archived = !!a.archived;
        applied++;
      } else if (a.type === 'set_pinned') {
        it.pinned = !!a.pinned;
        applied++;
      } else if (a.type === 'delete_item') {
        d.trash = d.trash || [];
        d.trash.push({
          id: QY.uid('tr'), kind: 'item', deletedAt: QY.iso(QY.today()),
          item: it, events: d.events.filter(function (e) { return e.itemId === it.id; })
        });
        d.items = d.items.filter(function (x) { return x.id !== it.id; });
        d.events = d.events.filter(function (e) { return e.itemId !== it.id; });
        applied++;
      } else {
        dropped++;
      }
    });

    UI().save();
    UI().mount();
    return { applied: applied, dropped: dropped };
  }

  /* ---------------- 发消息 ---------------- */

  /* 选一张图，压缩后挂在输入框上方等发送。
   * 原生壳里来源由系统选图面板提供（相机排在第一项），浏览器走文件选择。 */
  function pickImage() {
    if (!window.QYV || !QYV.pickImage) { UI().toast('图片功能不可用'); return; }
    QYV.pickImage(function (dataUrl) {
      if (!dataUrl) return;
      pendingImage = dataUrl;
      rerenderChat();
    }, { maxSide: 1280, quality: 0.8 });
  }

  async function send(text) {
    const t = String(text || '').trim();
    const img = pendingImage;
    if ((!t && !img) || busy) return;
    busy = true;
    pending = null;
    const meta = {};   // QYA.call 的 out 引用：深度思考时带回 reasoning_content
    msgs.push({ role: 'user', text: t || '(图片)', img: !!img, image: img });
    pendingImage = null;
    rerenderChat();

    const data = UI().data();
    const sys = { role: 'system', content: window.QYP.assistantPrompt(data) };

    // 联网搜索：开启且配了搜索 Key 时，把网页结果附进 system prompt。
    // 失败静默降级（提示一句），不要因为搜索挂了把整个对话卡死。
    const acfg = window.QYA ? QYA.cfg() : null;
    if (acfg && acfg.webSearch && acfg.searchKey && t) {
      try {
        const results = await QYA.webSearch(t);
        if (results && results.length) {
          sys.content += '\n\n## 网页搜索结果（回答时效性问题时优先参考，并注明来源序号）\n' +
            results.map(function (r, i) {
              return '[' + (i + 1) + '] ' + r.name + '\n' + r.url + '\n' + r.snippet;
            }).join('\n\n');
        }
      } catch (err) {
        UI().toast('联网搜索失败，本次未联网回答');
      }
    }

    // 历史只带文字（每轮重发图片很贵），当前这条带图才发 base64
    const history = msgs.slice(-8).map(function (m) {
      if (m.role === 'user' && m.image) {
        return {
          role: 'user',
          content: [
            { type: 'text', text: (m.text || '') + '\n（以上是用户发来的截图）' },
            { type: 'image_url', image_url: { url: m.image } }
          ]
        };
      }
      return { role: m.role === 'user' ? 'user' : 'assistant', content: m.text || '' };
    });

    QYA.call([sys].concat(history), { vision: !!img, out: meta }).then(function (out) {
      let obj;
      try {
        obj = QYA.parseJson(out);
      } catch (err) {
        obj = { reply: out };
      }
      const actions = Array.isArray(obj.actions) ? obj.actions.slice(0, 10) : [];
      busy = false;
      msgs.push({
        role: 'assistant', text: obj.reply || '（没说话）',
        actions: actions,
        reasoning: meta.reasoning || null      // 深度思考的思考过程（可能没有）
      });
      rerenderChat();
    }).catch(function (err) {
      busy = false;
      msgs.push({ role: 'assistant', text: '出错了：' + ((err && err.message) || '未知错误') });
      rerenderChat();
    });
  }

  /* ---------------- 事件 ---------------- */

  document.addEventListener('click', function (e) {
    // 「我的 → AI 助手 → 对话助手」重新打开悬浮球
    const row = e.target.closest && e.target.closest('[data-action="i-ball-show"]');
    if (row) { e.stopPropagation(); showBall(); return; }

    const el = e.target.closest && e.target.closest('[data-ai]');
    if (!el) return;
    const act = el.getAttribute('data-ai');
    e.stopPropagation();

    if (act === 'close') { hideBall(); return; }
    if (act === 'hide') { UI().closeSheet(); hideBall(); return; }
    if (act === 'pick') { pickImage(); return; }
    if (act === 'unpick') { pendingImage = null; rerenderChat(); return; }
    if (act === 'think') {
      const c = window.QYA ? QYA.cfg() : {};
      QYA.update({ think: !(c.think === true) });
      rerenderChat();
      UI().toast(c.think === true ? '已关闭深度思考（更快）' : '已开启深度思考（答得更细，更慢更贵）');
      return;
    }
    if (act === 'send') {
      const input = document.getElementById('ai-text');
      send(input ? input.value : '');
      return;
    }
    if (act === 'apply') {
      const last = msgs[msgs.length - 1];
      if (!last || !last.actions) return;
      const run = function () {
        const r = applyActions(last.actions);
        last.applied = true;
        last.dropped = r.dropped;
        last.text = (last.text ? last.text + '\n' : '') +
          '已执行 ' + r.applied + ' 个动作' + (r.dropped ? '，丢弃 ' + r.dropped + ' 个' : '') + '。';
        rerenderChat();
        UI().toast('已执行 ' + r.applied + ' 个动作');
      };
      // 不可逆/大批量动作：执行按钮算第一确，这里再弹一道红色确认（二确）。
      // clear_data 不在列——它自带三步确认。
      const dangerTypes = ['delete_records', 'empty_trash', 'trash_purge'];
      const danger = last.actions.filter(function (a) {
        if (dangerTypes.indexOf(a.type) < 0) return false;
        if (a.type === 'delete_records') return /^\d{4}-\d{2}-\d{2}$/.test(a.before || '');
        return true;
      });
      if (danger.length && window.QYI && QYI.confirmSheet) {
        QYI.confirmSheet(
          danger.map(describe).join('\n') + '\n\n确定执行？', { danger: true, ok: '仍要删除' }
        ).then(function (yes) { if (yes) run(); });
      } else {
        run();
      }
      return;
    }
    if (act === 'skip') {
      const last = msgs[msgs.length - 1];
      if (last) { last.actions = null; last.text += '\n（已放弃这些动作）'; }
      rerenderChat();
    }
  }, true);

  /* 输入框随内容自动增高（封顶 132px，超出自己滚动） */
  function autoGrow(t) {
    if (!t || t.tagName !== 'TEXTAREA') return;
    t.style.height = 'auto';
    t.style.height = Math.min(t.scrollHeight, 132) + 'px';
  }

  document.addEventListener('input', function (e) {
    if (e.target && e.target.id === 'ai-text') autoGrow(e.target);
  });

  /* 回车行为：
   *   手机（原生壳）回车 = 换行，发送一律点按钮 —— 输入法回车太容易误触发送；
   *   桌面浏览器回车 = 发送，Shift+Enter = 换行。 */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    if (!e.target || e.target.id !== 'ai-text') return;
    if (e.isComposing) return;                              // 输入法的"确认候选"不算回车
    if (window.QYPlatform && QYPlatform.native) return;     // 手机：回车换行
    if (e.shiftKey) return;                                 // 桌面：Shift+Enter 换行
    e.preventDefault();
    send(e.target.value);
  });

  window.QYO = Object.assign(window.QYO || {}, {
    openChat: openChat,
    syncBall: syncBall,
    showBall: showBall,
    hideBall: hideBall,
    _aiTest: {
      describe: describe,
      applyActions: applyActions,
      getMsgs: function () { return msgs; },
      push: function (m) { msgs.push(m); },
      reset: function () { msgs = []; }
    }
  });

  bindDrag();
  // 启动时按配置决定要不要显示悬浮球
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncBall);
  } else {
    syncBall();
  }
})();
