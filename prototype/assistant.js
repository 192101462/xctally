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
  let ballEl = null;
  let drag = null;

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
    el.innerHTML = '<span class="ai-ball-icon">💬</span><span class="ai-ball-x" data-ai="close">×</span>';
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
  function bindDrag() {
    document.addEventListener('pointerdown', function (e) {
      const el = e.target.closest && e.target.closest('#ai-ball');
      if (!el) return;
      if (e.target.closest('[data-ai="close"]')) return;
      const r = el.getBoundingClientRect();
      drag = { el: el, dx: e.clientX - r.left, dy: e.clientY - r.top, moved: false, sx: e.clientX, sy: e.clientY };
      el.classList.add('dragging');
    }, { passive: true });

    document.addEventListener('pointermove', function (e) {
      if (!drag) return;
      if (!drag.moved && Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) < 6) return;
      drag.moved = true;
      const size = 56;
      const x = Math.min(Math.max(8, e.clientX - drag.dx), Math.max(8, window.innerWidth - size - 8));
      const y = Math.min(Math.max(8, e.clientY - drag.dy), Math.max(8, window.innerHeight - size - 90));
      drag.el.style.left = x + 'px';
      drag.el.style.top = y + 'px';
    }, { passive: true });

    function end() {
      if (!drag) return;
      const d = drag;
      drag = null;
      d.el.classList.remove('dragging');
      if (d.moved) {
        saveBall({ x: parseFloat(d.el.style.left), y: parseFloat(d.el.style.top) });
      } else {
        openChat();
      }
    }
    document.addEventListener('pointerup', end);
    document.addEventListener('pointercancel', end);

    window.addEventListener('resize', placeBall);
  }

  /* ---------------- 聊天面板 ---------------- */

  function bubble(m) {
    if (m.role === 'user') {
      return '<div class="ai-msg me">' + esc(m.text) + '</div>';
    }
    let html = '<div class="ai-msg bot">' + esc(m.text) + '</div>';
    if (m.actions && m.actions.length) {
      const items = m.actions.map(function (a) { return '<li>' + esc(describe(a)) + '</li>'; }).join('');
      const done = m.applied === true;
      const dropped = m.dropped || 0;
      html += '<div class="ai-actions' + (done ? ' done' : '') + '">' +
        '<div class="ai-actions-head">' + (done ? '✅ 已执行' : '将要执行 ' + m.actions.length + ' 个动作') +
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
    const body = msgs.length
      ? msgs.map(bubble).join('')
      : '<div class="ai-hint">可以这样说：<br>' +
        '「昨天买的牛奶 15.9 两瓶，放冰箱了」<br>' +
        '「这个月在食品上花了多少」<br>' +
        '「哪些东西快过期了」<br>' +
        '「把纯牛奶和全麦面包都归档」</div>';
    return '<div class="sheet ai-sheet"><div class="grabber"></div>' +
      '<div class="ai-head">' +
        '<div><h3>助手</h3><div class="ai-sub">' + esc(usageLine()) + '</div></div>' +
        '<button class="btn plain" data-ai="hide" style="padding:6px 12px;font-size:13px">关闭悬浮球</button>' +
      '</div>' +
      '<div class="ai-log" id="ai-log">' + body + '</div>' +
      '<div class="ai-input">' +
        '<input id="ai-text" class="input" placeholder="说点什么…" autocomplete="off"' +
          (busy ? ' disabled' : '') + ' />' +
        '<button class="btn primary" data-ai="send"' + (busy ? ' disabled' : '') + '>' +
          (busy ? '…' : '发送') + '</button>' +
      '</div></div>';
  }

  function openChat() {
    if (!window.QYA || !QYA.ready()) { UI().toast('先在「我的 → DeepSeek 配置」里填 API Key'); return; }
    pending = null;
    UI().openSheet(renderChat());
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
    if (a.type === 'update_item') {
      const keys = Object.keys(a.fields || {});
      return '修改「' + name + '」：' + (keys.length ? keys.map(function (k) {
        return k + ' → ' + a.fields[k];
      }).join('，') : '（没有具体字段）');
    }
    if (a.type === 'set_archived') return (a.archived ? '归档「' : '取消归档「') + name + '」';
    if (a.type === 'set_pinned') return (a.pinned ? '置顶「' : '取消置顶「') + name + '」';
    if (a.type === 'delete_item') return '删除「' + name + '」（进回收站，30 天内可恢复）';
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

  function send(text) {
    const t = String(text || '').trim();
    if (!t || busy) return;
    busy = true;
    pending = null;
    msgs.push({ role: 'user', text: t });
    rerenderChat();

    const data = UI().data();
    const sys = { role: 'system', content: window.QYP.assistantPrompt(data) };
    const history = msgs.slice(-8).map(function (m) {
      return { role: m.role === 'user' ? 'user' : 'assistant', content: m.text };
    });

    QYA.call([sys].concat(history)).then(function (out) {
      let obj;
      try {
        obj = QYA.parseJson(out);
      } catch (err) {
        obj = { reply: out };
      }
      const actions = Array.isArray(obj.actions) ? obj.actions.slice(0, 10) : [];
      busy = false;
      msgs.push({ role: 'assistant', text: obj.reply || '（没说话）', actions: actions });
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
    if (act === 'send') {
      const input = document.getElementById('ai-text');
      send(input ? input.value : '');
      return;
    }
    if (act === 'apply') {
      const last = msgs[msgs.length - 1];
      if (!last || !last.actions) return;
      const r = applyActions(last.actions);
      last.applied = true;
      last.dropped = r.dropped;
      last.text = (last.text ? last.text + '\n' : '') +
        '已执行 ' + r.applied + ' 个动作' + (r.dropped ? '，丢弃 ' + r.dropped + ' 个' : '') + '。';
      rerenderChat();
      UI().toast('已执行 ' + r.applied + ' 个动作');
      return;
    }
    if (act === 'skip') {
      const last = msgs[msgs.length - 1];
      if (last) { last.actions = null; last.text += '\n（已放弃这些动作）'; }
      rerenderChat();
    }
  }, true);

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    if (!e.target || e.target.id !== 'ai-text') return;
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
