/* 琪遇台账 · 物品模块
 * ---------------------------------------------------------------
 * 这次重写的几件事：
 *   1. 物品可以完整编辑、可以删除；"处置"只是状态流转，能切回去
 *   2. 物品可以带一张图片，列表外层就用图片（没图片则用名称首字，不再用 emoji 图标）
 *   3. 是否计算日均成本：物品上可单独开关，默认跟随分类（食品/药品默认不算）
 *   4. 表单里的分类/来源/单位/状态换成自定义选择器，不再是安卓原生下拉框
 *   5. 去掉详情页那个没用的"记一笔支出"
 * ---------------------------------------------------------------
 */
(function () {
  'use strict';

  const QY = window.QY;
  function UI() { return window.QYUI; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------------- 列表状态 ---------------- */
  const state = { filter: 'active', category: '全部', query: '', detailId: null };
  let editingId = null;
  let formPhoto = null;

  function data() { return UI().data(); }
  function byId(id) { return UI().itemById(id); }

  /* ---------------- 缩略图 ----------------
   * 有图片用图片；没有就用中性底 + 名称首字（用户明确要求外层不要 emoji 图标）
   */
  function thumb(item, small) {
    const cls = 'tile' + (small ? ' sm' : '') + (item.photo ? '' : ' tile-plain');
    const style = item.photo
      ? ' style="background-image:url(' + item.photo + ');background-size:cover;background-position:center"'
      : '';
    const inner = item.photo ? '' : esc(QY.thumbChar(item));
    return '<div class="' + cls + '"' + style + '>' + inner + '</div>';
  }

  function sideOf(item) {
    // 不计入日均成本的（食品/药品等）只显示价格，不显示"每天多少钱"。
    // rate / cost 两个类名给窄屏媒体查询用：宽度不够时优先丢掉"每日"这一项。
    if (QY.tracksCost(item, data())) {
      const p = QY.perDay(item, data());
      return '<div class="row-value rate">' +
        (p != null ? QY.fmtRate(p) + '<span class="per">/天</span>' : '—') + '</div>' +
        '<div class="row-note cost">' + (item.cost != null ? QY.fmtMoney(item.cost) : '价格未知') + '</div>';
    }
    return '<div class="row-value cost">' +
      (item.cost != null ? QY.fmtMoney(item.cost) : '—') + '</div>';
  }

  function rowItem(item) {
    const bits = [item.category];
    if (item.sub) bits.push(item.sub);
    bits.push(QY.fmtDate(item.acquiredAt) + ' 获得');
    if (item.location) bits.push(item.location);
    return '' +
      '<div class="swipe" data-id="' + item.id + '">' +
        '<div class="swipe-body">' +
          '<div class="row" data-action="i-open" data-id="' + item.id + '">' +
            thumb(item) +
            '<div class="row-main">' +
              '<div class="row-title">' + (item.pinned ? '<span class="pin-dot">📌</span>' : '') +
                esc(item.name) + '</div>' +
              '<div class="row-sub">' + esc(bits.join(' · ')) + '</div>' +
            '</div>' +
            '<div class="row-side">' + sideOf(item) + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="swipe-act right">' +
          '<button class="sw-btn pin" data-action="i-pin" data-id="' + item.id + '">' +
            (item.pinned ? '取消置顶' : '置顶') + '</button>' +
          '<button class="sw-btn arch" data-action="i-archive" data-id="' + item.id + '">' +
            (item.archived ? '取消归档' : '归档') + '</button>' +
        '</div>' +
      '</div>';
  }

  /* ---------------- 滑动操作 ----------------
   * 往右划：露出「置顶」；往左划：露出「归档 / 删除」。
   * 都是"先露出、再点确认"，不做划过去就触发——误触的代价太大。
   * touch-action: pan-y 交给浏览器处理竖向滚动，只接管横向。
   */
  const OPEN_RIGHT = 158;   // 置顶 + 归档（删除已只留在详情页）—— 要和 CSS 的 158px 一致
  const COMPACT_AT = 90;    // 滑过这么多就换成紧凑排版（名称在上、价格/每日在下）
  const CONTENT_STOP = 72;  // 文字往左走到这里就停（约等于缩略图 + 间距的宽度）

  // 只允许往左滑（露出右侧操作按钮）；往右滑完全不动
  function shiftOf(wrap, dx) {
    if (dx > 0) return 0;
    return Math.max(dx, -(OPEN_RIGHT + 12));
  }
  /* 文字需要往左走多远才正好停在"行的内容左边界"（原来是缩略图占的位置）。
     实测而不是写死：以前写死 72，文字会落到 12px 处，被卡片圆角切掉。
     只在拖动开始时量一次（此时还没有 transform），之后复用，避免量到已经位移过的位置。 */
  function stopDistance(wrap) {
    if (wrap.__stop != null) return wrap.__stop;
    const rowEl = wrap.querySelector('.row');
    const main = wrap.querySelector('.row-main');
    let d = CONTENT_STOP;
    if (rowEl && main) {
      const padLeft = parseFloat(getComputedStyle(rowEl).paddingLeft) || 18;
      d = Math.round(main.getBoundingClientRect().left - rowEl.getBoundingClientRect().left - padLeft);
    }
    wrap.__stop = Math.max(24, d);
    return wrap.__stop;
  }

  function setShift(wrap, dx) {
    const body = wrap.querySelector('.swipe-body');
    if (body) body.style.transform = 'translateX(' + dx + 'px)';

    // 两步动画（关键是 stop 与"切换紧凑排版"用同一个阈值，否则文字会跳或被按钮盖住）：
    //   第一步 |dx| < stop：缩略图和文字一起左移；
    //   第二步 |dx| >= stop：缩略图隐藏，文字正好落到"行的内容左边界"并停住。
    //   两段的绝对位置是连续的：缩略图消失让出的距离 == 停止补偿的距离。
    const stop = stopDistance(wrap);
    const compact = -dx >= stop;
    const over = Math.max(0, -dx - (compact ? 0 : stop));
    const shift = over ? 'translateX(' + over + 'px)' : '';
    const main = wrap.querySelector('.row-main');
    const side = wrap.querySelector('.row-side');
    if (main) main.style.transform = shift;
    if (side) side.style.transform = shift;

    // 收紧排版后行高会和原来不同，导致整个列表在滑动时上下跳 —— 先钉住原高度
    const row = wrap.querySelector('.row');
    if (row && !row.style.minHeight) {
      row.style.minHeight = Math.round(row.getBoundingClientRect().height) + 'px';
    }

    wrap.classList.toggle('compact', compact);
  }
  function closeSwipe(wrap, instant) {
    wrap.classList.remove('open-right', 'compact');
    const main = wrap.querySelector('.row-main');
    const side = wrap.querySelector('.row-side');
    const row = wrap.querySelector('.row');
    if (main) main.style.transform = '';
    if (side) side.style.transform = '';
    if (row) row.style.minHeight = '';
    wrap.__stop = null;
    const body = wrap.querySelector('.swipe-body');
    if (!body) return;
    if (instant) body.style.transition = 'none';
    body.style.transform = '';
    if (instant) requestAnimationFrame(function () { body.style.transition = ''; });
  }
  function closeAllSwipes(except) {
    const all = document.querySelectorAll('#view .swipe.open-right');
    Array.prototype.forEach.call(all, function (w) { if (w !== except) closeSwipe(w); });
  }

  (function swipeEngine() {
    let active = null;

    document.addEventListener('pointerdown', function (e) {
      if (e.button != null && e.button !== 0) return;
      const wrap = e.target.closest && e.target.closest('#view .swipe');
      if (!wrap) { closeAllSwipes(null); return; }
      // 点的是露出来的按钮，交给 click 处理
      if (e.target.closest('.sw-btn')) return;
      const wasOpen = wrap.classList.contains('open-right');
      active = { wrap: wrap, x: e.clientX, y: e.clientY, dx: 0, dir: '', wasOpen: wasOpen };
      if (wasOpen) {
        active.dir = 'x';
        active.dx = -OPEN_RIGHT;
        setShift(wrap, active.dx);
      }
    }, { passive: true });

    document.addEventListener('pointermove', function (e) {
      if (!active) return;
      const dx = e.clientX - active.x + (active.wasOpen ? active.dx : 0);
      const dy = e.clientY - active.y;
      if (!active.dir) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        active.dir = Math.abs(dx) > Math.abs(dy) * 1.4 ? 'x' : 'y';
        if (active.dir === 'x') {
          active.wrap.classList.add('swiping');
          closeAllSwipes(active.wrap);
        }
      }
      if (active.dir !== 'x') return;
      active.dx = dx;
      setShift(active.wrap, shiftOf(active.wrap, dx));
    }, { passive: true });

    function finish() {
      if (!active) return;
      const a = active;
      active = null;
      a.wrap.classList.remove('swiping');
      if (a.dir !== 'x') return;
      if (a.dx < -44) {
        a.wrap.classList.add('open-right');
        setShift(a.wrap, -OPEN_RIGHT);
      } else {
        closeSwipe(a.wrap);
      }
    }
    document.addEventListener('pointerup', finish);
    document.addEventListener('pointercancel', finish);

    // 滑动露出的三个动作在这里处理，不占用 app.js 的动作表
    document.addEventListener('click', function (e) {
      const btn = e.target.closest && e.target.closest('.sw-btn[data-action]');
      if (!btn) return;
      e.stopPropagation();
      const act = btn.getAttribute('data-action');
      const id = btn.getAttribute('data-id');
      const item = byId(id);
      if (!item) return;
      if (act === 'i-pin') {
        item.pinned = !item.pinned;
        UI().save();
        UI().mount();
        UI().toast(item.pinned ? '已置顶' : '已取消置顶');
      } else if (act === 'i-archive') {
        toggleArchive(item);
      } else if (act === 'i-del') {
        deleteItem(id);
      }
    }, true);
  })();

  /* 归档 = 物品的总开关，与状态无关。列表右滑、详情按钮、详情「归档」行
   * 走的都是这一个函数，并记一条时间线。 */
  function toggleArchive(item) {
    const was = QY.isArchived(item);
    item.archived = !was;
    // 记下归档日子：浪费口径要判断"过期后才归档（=扔了）还是先归档（=收起来放过期）"
    if (item.archived) item.archivedAt = QY.iso(QY.today());
    else delete item.archivedAt;
    data().events.push({
      id: QY.uid('ev'), itemId: item.id,
      type: was ? 'unarchived' : 'archived',
      at: QY.iso(QY.today()), amount: null,
      note: was ? '从归档恢复' : null
    });
    UI().save();
    UI().mount();
    UI().toast(item.archived ? '已归档，可在「归档」里回看' : '已取消归档');
  }

  function filtered() {
    const d = data();
    const q = state.query.trim().toLowerCase();
    return d.items.filter(function (it) {
      if (state.filter === 'active' && QY.isArchived(it)) return false;
      if (state.filter === 'archived' && !QY.isArchived(it)) return false;
      if (state.category !== '全部' && it.category !== state.category) return false;
      if (!q) return true;
      return ((it.name || '') + ' ' + (it.sub || '') + ' ' + (it.location || '') + ' ' + (it.source || ''))
        .toLowerCase().indexOf(q) >= 0;
    }).sort(function (a, b) {
      // 置顶永远最前，其余按设置里的排序
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      const k = (UI().ui && UI().ui()) ? UI().ui().sort.items : 'date';
      if (k === 'dateAsc') return a.acquiredAt < b.acquiredAt ? -1 : 1;
      if (k === 'price') return (b.cost || 0) - (a.cost || 0);
      if (k === 'daily') return (QY.perDay(b, data()) || 0) - (QY.perDay(a, data()) || 0);
      if (k === 'name') return String(a.name || '').localeCompare(String(b.name || ''), 'zh');
      if (k === 'expiry') {
        const la = QY.daysLeft(a);
        const lb = QY.daysLeft(b);
        if (la == null && lb == null) return a.acquiredAt < b.acquiredAt ? 1 : -1;
        if (la == null) return 1;          // 没有到期日的排最后
        if (lb == null) return -1;
        return la - lb;                    // 快到期的在前
      }
      return a.acquiredAt < b.acquiredAt ? 1 : -1;
    });
  }

  function renderListInner() {
    const list = filtered();
    if (!list.length) {
      const msg = state.filter === 'archived' ? '还没有归档的物品' : '没有匹配的物品';
      return '<div class="empty"><div class="emoji">🗃</div><p>' + msg + '</p></div>';
    }
    return list.map(rowItem).join('');
  }

  function renderList() {
    const d = data();
    const s = QY.summaries(d);
    const seg = [
      { k: 'active', t: '在用' },
      { k: 'archived', t: '归档' },
      { k: 'all', t: '全部' }
    ].map(function (x) {
      return '<button class="seg-btn ' + (state.filter === x.k ? 'active' : '') +
        '" data-action="i-filter" data-k="' + x.k + '">' + x.t + '</button>';
    }).join('');

    const chips = QY.catList(d).map(function (c) {
      return '<button class="chip ' + (state.category === c.name ? 'active' : '') +
        '" data-action="i-cat" data-cat="' + esc(c.name) + '">' + esc(c.name) + '</button>';
    }).join('');

    return '' +
      '<div class="page-top">' +
        UI().pageHead('物品', s.count + ' 件在用 · 累计投入 ' + QY.fmtMoney(s.totalSpend),
          UI().iconBtn('i-add', '新增')) +
        // 搜索 + 筛选同一行。窄屏用下拉（点开选），≥560px 才放下完整的
        // 在用/归档/全部分段（CSS 控制显隐，两份都渲染）
        '<div class="items-tools">' +
          '<div class="search">' + UI().I.search +
            '<input id="i-search" placeholder="搜索名称、位置、来源" value="' + esc(state.query) + '" />' +
          '</div>' +
          '<div class="segmented">' + seg + '</div>' +
          '<button type="button" class="seg-dd" data-action="i-filter-dd">' +
            '<span>' + (state.filter === 'archived' ? '归档' : state.filter === 'all' ? '全部' : '在用') + '</span>' +
            '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor"' +
              ' stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>' +
          '</button>' +
        '</div>' +
        // 分类行：「全部」固定在最左；其余分类能放几个放几个，
        // 放不下的进最右侧「⋯」下拉（全放得下就不显示下拉）——见 layoutCats()
        '<div class="cat-row">' +
          '<button class="chip ' + (state.category === '全部' ? 'active' : '') +
            '" data-action="i-cat" data-cat="全部">全部</button>' +
          '<div class="cat-wrap">' + chips + '</div>' +
          '<button type="button" class="cat-more" data-action="i-cat-more" aria-label="更多分类">⋯</button>' +
        '</div>' +
      '</div>' +
      '<div class="group" id="i-list">' + renderListInner() + '</div>';
  }

  /* ---------------- 详情 ---------------- */

  function kv(k, v) {
    return '<div class="kv"><span class="k">' + esc(k) + '</span><span class="v">' + v + '</span></div>';
  }

  function sparkline(item, held) {
    const cost = QY.costOf(item, data());
    if (!cost || cost <= 0) return '';
    const ts = [];
    let t = 1;
    while (t < held) { ts.push(t); t = Math.ceil(t * 1.3); }
    ts.push(held);
    const W = 300, H = 88, P = 6;
    const vals = ts.map(function (x) { return cost / x; });
    const hi = vals[0], lo = vals[vals.length - 1] * 0.7;
    const px = function (i) { return P + (W - 2 * P) * (ts.length === 1 ? 0 : i / (ts.length - 1)); };
    const py = function (v) { return H - P - (H - 2 * P) * ((v - lo) / (hi - lo || 1)); };
    const pts = vals.map(function (v, i) { return px(i).toFixed(1) + ',' + py(v).toFixed(1); }).join(' ');
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:88px;color:var(--blue);margin-top:6px">' +
      '<defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="currentColor" stop-opacity="0.26"/>' +
      '<stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>' +
      '<polygon points="' + pts + ' ' + (W - P) + ',' + (H - P) + ' ' + P + ',' + (H - P) + '" fill="url(#sg)"/>' +
      '<polyline points="' + pts + '" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<circle cx="' + px(vals.length - 1).toFixed(1) + '" cy="' + py(vals[vals.length - 1]).toFixed(1) + '" r="4" fill="currentColor"/>' +
      '</svg>';
  }

  function renderDetail(id) {
    const item = byId(id);
    if (!item) return renderList();
    const held = QY.heldDays(item);
    const per = QY.perDay(item, data());
    const total = QY.costOf(item, data());
    const extra = total - (item.cost || 0);
    const tracked = QY.tracksCost(item, data());
    const dl = QY.daysLeft(item);

    const hero = item.photo
      ? '<div class="hero-cover" data-action="i-zoom" data-id="' + item.id + '" style="background-image:url(' +
        item.photo + ');background-size:cover;background-position:center"></div>' +
        '<div class="hero-hint">点一下看大图</div>'
      : '<div class="hero-cover hero-plain">' + esc(QY.thumbChar(item)) + '</div>';

    const metrics = [
      '<div class="metric"><div class="m-label">持有</div><div class="m-value">' + held + '<small>天</small></div></div>'
    ];
    if (tracked) {
      metrics.push('<div class="metric"><div class="m-label">日均成本</div><div class="m-value">' +
        (per != null ? QY.fmtRate(per) : '—') + '</div></div>');
    }
    metrics.push('<div class="metric"><div class="m-label">累计投入</div><div class="m-value">' + QY.fmtMoney(total) + '</div></div>');

    const rows = [
      kv('获得日期', QY.fmtDate(item.acquiredAt)),
      kv('来源', esc(item.source || '—')),
      kv('价格', item.cost != null ? QY.fmtMoney(item.cost) : '未知'),
      kv('数量', (item.qty || 1) + ' ' + (item.unit || '个') +
        (item.cost != null && (item.qty || 1) > 1 ? ' · 单价 ' + QY.fmtMoney(item.cost / item.qty) : '')),
      kv('分类', esc(item.category) + (item.sub ? ' · ' + esc(item.sub) : '')),
      // 状态 = 分类里的阶段词（未开封 → 使用中 → …），点状态标签本身就能改
      kv('状态', '<span class="pill blue tappable" data-action="i-status" data-id="' + item.id + '">' +
        esc(item.status) + '</span>'),
      kv('日均成本', tracked ? '计入' : '不计入（消耗品）'),
      kv('存放位置', esc(item.location || '—')),
      item.expiresAt ? kv('到期日', QY.fmtDate(item.expiresAt) +
        (dl != null ? ' <span class="pill ' + (dl < 0 ? 'red' : dl <= 7 ? 'orange' : 'green') + '">' +
          (dl < 0 ? '已过期 ' + Math.abs(dl) + ' 天' : '剩 ' + dl + ' 天') + '</span>' : '')) : '',
      item.openedAt ? kv('开封日期', QY.fmtDate(item.openedAt)) : '',
      item.warrantyUntil ? kv('保修至', QY.fmtDate(item.warrantyUntil)) : '',
      item.note ? kv('备注', esc(item.note)) : ''
    ].join('');

    const events = QY.eventsOf(data(), item.id);
    const timeline = events.map(function (e) {
      const t = QY.EVENT_TYPES[e.type] || { label: e.type, emoji: '•' };
      return '<div class="tl-item" data-ev-id="' + e.id + '" data-id="' + item.id + '">' +
        '<div class="tl-dot">' + (window.QYIcon ? QYIcon.forEvent(e.type, 15) : t.emoji) + '</div>' +
        '<div class="tl-body"><div class="tl-title">' + t.label +
          (e.amount ? ' <span class="amount">' + QY.fmtMoney(e.amount) + '</span>' : '') + '</div>' +
        '<div class="tl-sub">' + QY.fmtDate(e.at) + (e.note ? ' · ' + esc(e.note) : '') + '</div></div></div>';
    }).join('');

    const navIco = function (act, icon, label) {
      return '<button type="button" class="nav-ico" data-action="' + act + '" data-id="' + item.id +
        '" title="' + label + '" aria-label="' + label + '">' +
        (window.QYIcon ? QYIcon.svg(icon, 19) : label) + '</button>';
    };
    return '' +
      '<div class="navbar"><button class="back" data-action="i-back">‹ ' +
        esc(UI().detailBackLabel ? UI().detailBackLabel() : '物品') + '</button>' +
        '<span class="nav-acts">' +
          navIco('i-edit', 'pencil', '编辑') +
          navIco('i-tl', 'timeline', '时间线') +
          '<button type="button" class="nav-more" data-action="i-menu" data-id="' + item.id +
            '" aria-label="更多操作">' + (window.QYIcon ? QYIcon.svg('more', 20) : '···') + '</button>' +
        '</span></div>' +
      hero +
      '<div style="padding:18px 4px 0">' +
        '<h1 style="margin:0;font-size:25px;font-weight:700;letter-spacing:-0.025em">' + esc(item.name) +
          (QY.isArchived(item) ? ' <span class="pill gray" style="vertical-align:4px">已归档</span>' : '') + '</h1>' +
        '<p style="margin:6px 0 0;font-size:13px;color:var(--label-2)">' +
          esc(item.category) + (item.sub ? ' · ' + esc(item.sub) : '') +
          (item.location ? ' · ' + esc(item.location) : '') + '</p>' +
      '</div>' +
      '<div class="card" style="margin-top:16px">' +
        '<div class="metrics" style="grid-template-columns:repeat(' + metrics.length + ',1fr)">' + metrics.join('') + '</div>' +
        (tracked ? sparkline(item, held) + '<div class="mini-foot" style="text-align:center;margin-top:6px">' +
          (extra > 0 ? '含维修/更换 ' + QY.fmtMoney(extra) + ' · ' : '') + '用得越久，每天越便宜</div>' : '') +
      '</div>' +
      '<div class="section"><div class="section-head"><h2>详情</h2></div><div class="group">' + rows + '</div></div>' +
      '<div style="height:26px"></div>';
  }

  /* 时间线按钮 → 独立面板：事件列表 + 记一笔（长按修改沿用原手势） */
  function openTimeline(item) {
    const events = QY.eventsOf(data(), item.id);
    const rows = events.map(function (e) {
      const t = QY.EVENT_TYPES[e.type] || { label: e.type, emoji: '•' };
      return '<div class="tl-item" data-ev-id="' + e.id + '" data-id="' + item.id + '">' +
        '<div class="tl-dot">' + (window.QYIcon ? QYIcon.forEvent(e.type, 15) : t.emoji) + '</div>' +
        '<div class="tl-body"><div class="tl-title">' + t.label +
          (e.amount ? ' <span class="amount">' + QY.fmtMoney(e.amount) + '</span>' : '') + '</div>' +
        '<div class="tl-sub">' + QY.fmtDate(e.at) + (e.note ? ' · ' + esc(e.note) : '') + '</div></div></div>';
    }).join('');
    UI().openSheet('' +
      '<div class="sheet"><div class="grabber"></div>' +
        '<h3>' + esc(item.name) + ' · 时间线</h3>' +
        '<p class="hint">长按可修改</p>' +
        '<div class="group timeline">' + (rows ||
          '<div class="empty" style="padding:22px 14px"><p>还没有记录</p></div>') + '</div>' +
        '<div class="sheet-actions" style="margin-top:14px">' +
          '<button class="btn primary" data-action="i-ev-add" data-id="' + item.id + '">＋ 记一笔</button>' +
          '<button class="btn plain" data-action="i-close">关闭</button></div>' +
      '</div>');
  }

  /* ── 每日提醒：item.reminder = { hour, alarm }（没有 = 关） ──
   * 用途是"每天吃药 / 喝牛奶"这类打卡提醒；排程交给原生壳的
   * ItemReminderWorker（网页侧只负责收集清单推过去）。 */
  function pushItemReminders() {
    if (!window.QYPlatform || !QYPlatform.scheduleItemReminders) return;
    const list = data().items.filter(function (it) {
      return it.reminder && it.reminder.on !== false;
    }).map(function (it) {
      return {
        id: it.id, name: it.name,
        hour: it.reminder.hour || 9,
        minute: it.reminder.minute || 0,
        alarm: it.reminder.alarm === true
      };
    });
    try { QYPlatform.scheduleItemReminders(JSON.stringify(list)); } catch (err) { /* 壳不支持就跳过 */ }
  }

  function openReminderSheet(item) {
    const r = item.reminder || { hour: 9, minute: 0, alarm: false };
    const QUICK = ['10:00', '12:00', '16:00', '18:00', '20:00'];
    UI().openSheet('' +
      '<div class="sheet"><div class="grabber"></div>' +
        '<h3>每日提醒</h3>' +
        '<p class="hint">每天 ' + (r.hour == null ? 9 : r.hour) + ':' + ((r.minute || 0) < 10 ? '0' : '') + (r.minute || 0) + ' 提醒「' + esc(item.name) + '」</p>' +
        '<div class="fsec">提醒时间</div>' +
        '<div class="wheel-box" id="r-wheel">' +
          '<div class="wheel-hl"></div>' +
          '<div class="wheel-col" id="r-wheel-h"></div>' +
          '<div class="wheel-col" id="r-wheel-m"></div>' +
        '</div>' +
        '<div class="chip-row" style="margin-top:8px" id="r-quick"></div>' +
        '<label class="frow wide" style="margin-top:14px;background:var(--card);border-radius:var(--r-lg)">' +
          '<span class="fl">闹铃</span>' +
          '<span class="fsw"><input type="checkbox" id="r-alarm"' + (r.alarm ? ' checked' : '') + ' /><i></i></span>' +
        '</label>' +
        '<div class="sheet-actions" style="margin-top:16px">' +
          (item.reminder
            ? '<button class="btn plain" data-action="i-remind-off" data-id="' + item.id + '" style="color:var(--red)">关闭提醒</button>' +
              '<button class="btn primary" data-action="i-remind-save" data-id="' + item.id + '">保存</button>'
            : '<button class="btn primary" data-action="i-remind-save" data-id="' + item.id + '">开启提醒</button>') +
        '</div>' +
      '</div>');
    const box = document.getElementById('r-quick');
    if (box) box.innerHTML = QUICK.map(function (q) {
      return '<button type="button" class="chip small" data-action="i-remind-quick" data-v="' + q + '">' + q + '</button>';
    }).join('');
    buildWheel(document.getElementById('r-wheel-h'),
      Array.apply(null, { length: 24 }).map(function (_, i) { return { v: i, label: String(i) }; }),
      r.hour == null ? 9 : r.hour);
    buildWheel(document.getElementById('r-wheel-m'),
      Array.apply(null, { length: 60 }).map(function (_, i) { return { v: i, label: pad2(i) }; }),
      r.minute || 0);
  }

  /* ── 滚轮选择器（系统闹钟那种）：跟手滑动 + 松手吸附 + 点按跳转 ──
   * 每项 40px，列容器 translateY 定位；中间高亮条固定在容器中央。 */
  const WHEEL_H = 40;
  function buildWheel(col, values, initIdx) {
    if (!col) return;
    col._whValues = values;
    col._whIdx = Math.max(0, Math.min(values.length - 1, initIdx || 0));
    col.style.padding = Math.round((col.parentNode.clientHeight - WHEEL_H) / 2) + 'px 0';
    col.innerHTML = values.map(function (v, i) {
      return '<div class="wheel-it" data-i="' + i + '">' + v.label + '</div>';
    }).join('');
    const apply = function (anim) {
      col.style.transition = anim === false ? 'none' : '';
      col.style.transform = 'translateY(' + (-col._whIdx * WHEEL_H) + 'px)';
      Array.prototype.forEach.call(col.children, function (it, i) {
        it.classList.toggle('cur', i === col._whIdx);
      });
    };
    col._whApply = apply;
    apply(true);

    let startY = 0, baseIdx = 0, moved = false;
    col.addEventListener('touchstart', function (e) {
      startY = e.touches[0].clientY;
      baseIdx = col._whIdx;
      moved = false;
      col.style.transition = 'none';
    }, { passive: true });
    col.addEventListener('touchmove', function (e) {
      const dy = e.touches[0].clientY - startY;
      if (Math.abs(dy) > 3) moved = true;
      let idx = baseIdx - Math.round(dy / WHEEL_H);
      idx = Math.max(0, Math.min(values.length - 1, idx));
      if (idx !== col._whIdx) { col._whIdx = idx; apply(false); }
    }, { passive: true });
    col.addEventListener('touchend', function () {
      col.style.transition = '';
      apply(true);
    }, { passive: true });
    // 点某项直接跳过去
    col.addEventListener('click', function (e) {
      const it = e.target.closest && e.target.closest('.wheel-it');
      if (!it) return;
      col._whIdx = Number(it.getAttribute('data-i')) || 0;
      apply(true);
    });
    // 桌面：鼠标滚轮步进
    col.addEventListener('wheel', function (e) {
      e.preventDefault();
      let idx = col._whIdx + (e.deltaY > 0 ? 1 : -1);
      idx = Math.max(0, Math.min(values.length - 1, idx));
      if (idx !== col._whIdx) { col._whIdx = idx; apply(true); }
    }, { passive: false });
  }
  function wheelVal(col) {
    return col && col._whValues ? col._whValues[col._whIdx].v : 0;
  }

  /* ── ··· 菜单：生成长图 / 提醒我（带开启态）/ 删除 ── */
  function openItemMenu(item) {
    const exist = document.querySelector('.navbar .seg-dd-menu');
    if (exist) { exist.remove(); return true; }
    const ic = function (n) { return window.QYIcon ? QYIcon.svg(n, 16) : ''; };
    const r = item.reminder;
    const menu = document.createElement('div');
    menu.className = 'seg-dd-menu act-menu';
    menu.innerHTML =
      '<button data-action="i-long" data-id="' + item.id + '">' + ic('image') + '生成长图</button>' +
      '<button data-action="i-remind" data-id="' + item.id + '"' + (r ? ' class="on"' : '') + '>' +
        ic('bell') + (r ? '每天 ' + (r.hour || 9) + ':' + pad2(r.minute || 0) + ' 提醒中 ✓' : '提醒我（每天）') + '</button>' +
      '<button data-action="i-archive" data-id="' + item.id + '">' + ic('box') +
        (item.archived ? '取消归档' : '归档') + '</button>' +
      '<button data-action="i-del" data-id="' + item.id + '" class="danger">' + ic('trash') + '删除</button>';
    const nav = document.querySelector('.navbar');
    if (nav) nav.appendChild(menu);
    menu.addEventListener('click', function (ev) {
      if (ev.target.closest && ev.target.closest('[data-action]')) menu.remove();
    });
  }

  /* ── 物品长图：与随笔同款的白卡风格。
   * 头部 = 照片（或分类图标）+ 名称；下面指标三格 + 详情数据（没填的不画）── */
  const ILW = 1080, ILPAD = 56, ILFONT = '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
  function makeItemLongImage(item) {
    const d = data();
    const days = Math.max(1, Math.round((Date.now() - new Date(item.acquiredAt || Date.now())) / 86400000) + 1);
    const perDay = item.cost != null ? item.cost / days : null;

    // 详情行：值非空才进列表
    const rows = [];
    const kv = function (k, v) { if (v !== '' && v != null) rows.push([k, String(v)]); };
    kv('分类', item.category + (item.sub ? ' · ' + item.sub : ''));
    kv('购入', QY.fmtCN(item.acquiredAt) + (item.source ? ' · ' + item.source : ''));
    if ((item.qty || 1) > 1) kv('数量', (item.qty || 1) + ' ' + (item.unit || '个'));
    kv('状态', item.status);
    if (item.openedAt) kv('开封', QY.fmtCN(item.openedAt));
    if (item.expiresAt) kv('到期', QY.fmtCN(item.expiresAt));
    if (item.warrantyUntil) kv('保修至', QY.fmtCN(item.warrantyUntil));
    kv('位置', item.location);
    kv('备注', item.note);

    // 有照片就先加载，画进头部
    const loadImg = item.photo ? new Promise(function (resolve) {
      const im = new Image();
      im.onload = function () { resolve(im); };
      im.onerror = function () { resolve(null); };
      im.src = item.photo;
    }) : Promise.resolve(null);
    loadImg.then(function (photo) { draw(photo); });

    function draw(photo) {
      const probe = document.createElement('canvas').getContext('2d');
      probe.font = '600 34px ' + ILFONT;
      const maxNameW = ILW - ILPAD * 2 - 210;
      // 名称过长截断（不折行，保持头部干净）
      let name = String(item.name || '');
      while (name.length > 2 && probe.measureText(name).width > maxNameW) name = name.slice(0, -2);
      if (name !== item.name) name += '…';

      const lineH = 58, RGAP = 16, headH = 210;
      const infoH = 60 + rows.length * (lineH + RGAP) - RGAP + 24;
      let H = ILPAD * 2 + headH + 24 + 150 + 30 + infoH + 90;
      H = Math.max(H, 780);

      const cv = document.createElement('canvas');
      cv.width = ILW;
      cv.height = H;
      const g = cv.getContext('2d');
      g.fillStyle = '#F2F2F7';
      g.fillRect(0, 0, ILW, H);
      // 整张白卡
      const rr = function (x, y, w, h, r) {
        g.beginPath();
        g.moveTo(x + r, y);
        g.arcTo(x + w, y, x + w, y + h, r);
        g.arcTo(x + w, y + h, x, y + h, r);
        g.arcTo(x, y + h, x, y, r);
        g.arcTo(x, y, x + w, y, r);
        g.closePath();
      };
      rr(ILPAD / 2, ILPAD / 2, ILW - ILPAD, H - ILPAD, 44);
      g.fillStyle = '#FFFFFF';
      g.fill();

      // ── 头部：照片 150×150 圆角 + 名称/分类 ──
      let y = ILPAD + 34;
      const PX = ILPAD + 36, PS = 150;
      if (photo) {
        g.save();
        rr(PX, y, PS, PS, 30);
        g.clip();
        // cover 裁剪
        const sc = Math.max(PS / photo.width, PS / photo.height);
        const dw = photo.width * sc, dh = photo.height * sc;
        g.drawImage(photo, PX + (PS - dw) / 2, y + (PS - dh) / 2, dw, dh);
        g.restore();
      } else {
        rr(PX, y, PS, PS, 30);
        const grad = g.createLinearGradient(PX, y, PX + PS, y + PS);
        grad.addColorStop(0, '#E7ECF5');
        grad.addColorStop(1, '#C9D6E8');
        g.fillStyle = grad;
        g.fill();
        g.fillStyle = 'rgba(28,28,30,0.4)';
        g.font = '600 64px ' + ILFONT;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(String(item.category || '物').charAt(0), PX + PS / 2, y + PS / 2);
        g.textAlign = 'left';
        g.textBaseline = 'alphabetic';
      }
      const TX = PX + PS + 40;
      g.fillStyle = '#1C1C1E';
      g.font = '700 48px ' + ILFONT;
      g.fillText(name, TX, y + 62);
      g.fillStyle = '#8E8E93';
      g.font = '400 30px ' + ILFONT;
      g.fillText(String(item.category || '') + (item.location ? ' · ' + item.location : ''), TX, y + 116);
      g.fillText('已持有 ' + days + ' 天' + (perDay != null ? ' · 日均 ¥' + (Math.round(perDay * 100) / 100) : ''), TX, y + 160);
      y += Math.max(PS, 170) + 36;

      // ── 指标三格 ──
      const cols = [
        ['购入价', item.cost != null ? '¥' + item.cost : '—'],
        ['日均成本', perDay != null ? '¥' + (Math.round(perDay * 100) / 100) + '/天' : '—'],
        ['状态', item.status || '—']
      ];
      const cardW = (ILW - ILPAD * 2 - 72 - 40) / 3;
      cols.forEach(function (c, i) {
        const cx = ILPAD + 36 + (cardW + 20) * i;
        rr(cx, y, cardW, 118, 24);
        g.fillStyle = '#F6F6F8';
        g.fill();
        g.fillStyle = '#8E8E93';
        g.font = '500 26px ' + ILFONT;
        g.fillText(c[0], cx + 28, y + 42);
        g.fillStyle = '#1C1C1E';
        g.font = '650 38px ' + ILFONT;
        g.fillText(String(c[1]).slice(0, 11), cx + 28, y + 90);
      });
      y += 118 + 34;

      // ── 详情数据卡：行 + hairline 分隔 ──
      rr(ILPAD + 36, y, ILW - ILPAD * 2 - 72, infoH, 28);
      g.fillStyle = '#FFFFFF';
      g.fill();
      g.strokeStyle = 'rgba(60,60,67,0.10)';
      g.lineWidth = 2;
      rr(ILPAD + 36, y, ILW - ILPAD * 2 - 72, infoH, 28);
      g.stroke();
      let yy = y + 40;
      rows.forEach(function (rw, idx) {
        g.fillStyle = '#8E8E93';
        g.font = '500 28px ' + ILFONT;
        g.fillText(rw[0], ILPAD + 72, yy + 36);
        g.fillStyle = '#1C1C1E';
        g.font = '600 31px ' + ILFONT;
        g.fillText(rw[1].slice(0, 20), ILPAD + 260, yy + 36);
        if (idx < rows.length - 1) {
          g.strokeStyle = 'rgba(60,60,67,0.08)';
          g.beginPath();
          g.moveTo(ILPAD + 72, yy + lineH + RGAP / 2 - 6);
          g.lineTo(ILW - ILPAD - 72, yy + lineH + RGAP / 2 - 6);
          g.stroke();
        }
        yy += lineH + RGAP;
      });

      // 页脚
      g.fillStyle = '#C7C7CC';
      g.font = '26px ' + ILFONT;
      g.fillText('琪遇台账 · ' + QY.fmtDate(QY.iso(QY.today())), ILPAD + 36, H - ILPAD - 36);

      // 与随笔的长图同一套交互：先预览，再点"保存图片"下载
      const url = cv.toDataURL('image/png');
      const fname = 'xctally-' + String(item.name).replace(/[^\w一-龥]+/g, '') + '.png';
      UI().openSheet('' +
        '<div class="sheet">' +
          '<div class="grabber"></div>' +
          '<h3>长图已生成</h3>' +
          '<p class="hint">1080 × ' + H + ' · ' + esc(item.name) + ' 的详情</p>' +
          '<div style="border-radius:var(--r-md);overflow:hidden;box-shadow:var(--shadow-card);max-height:46vh;overflow-y:auto">' +
            '<img src="' + url + '" style="width:100%;display:block" /></div>' +
          '<div class="sheet-actions">' +
            '<button class="btn plain" data-action="i-close">关闭</button>' +
            '<a class="btn primary" href="' + url + '" download="' + fname + '" style="text-align:center;text-decoration:none;line-height:1.4">保存图片</a>' +
          '</div>' +
        '</div>');
    }
  }

  /* ---------------- 通用选择器（替代原生 select） ----------------
   * 覆盖在当前表单面板之上，所以表单的 DOM 不会被销毁，输入的内容不会丢。
   */
  function pickerOptionsFor(key) {
    const d = data();
    if (key === 'category') return QY.catList(d).map(function (c) { return { v: c.name, t: c.name, e: c.emoji }; });
    if (key === 'source') return QY.SOURCES.map(function (s) { return { v: s, t: s }; });
    if (key === 'unit') return QY.UNITS.map(function (s) { return { v: s, t: s }; });
    if (key === 'status') {
      // 状态词跟着【当前选中的分类】走（食品是"已吃完"、电子是"已损坏"）
      const cat = (document.getElementById('f-category') || {}).value;
      return QY.catStatuses(cat, d).map(function (s) { return { v: s, t: s }; });
    }
    return [];
  }

  function openPicker(key, title) {
    // 挂到 body 上：面板自身可能带 transform，挂在它里面会让 fixed 退化成 absolute
    const sheet = document.body;
    if (!sheet) return;
    const cur = (document.getElementById('f-' + key) || {}).value;
    const opts = pickerOptionsFor(key).map(function (o) {
      return '<div class="picker-opt ' + (o.v === cur ? 'on' : '') + '" data-action="i-pick" data-k="' + key +
        '" data-v="' + esc(o.v) + '">' + (o.e
          ? '<span class="pick-ic">' + (window.QYIcon ? QYIcon.forEmoji(o.e, 18) : esc(o.e)) + '</span>' : '') +
        '<span>' + esc(o.t) + '</span>' + (o.v === cur ? '<span class="tick">✓</span>' : '') + '</div>';
    }).join('');
    const layer = document.createElement('div');
    layer.className = 'picker-layer';
    layer.id = 'picker-layer';
    layer.innerHTML =
      '<div class="picker-head"><b>' + esc(title) + '</b>' +
        '<button class="btn plain" data-action="i-pick-close" style="padding:6px 14px">关闭</button></div>' +
      '<div class="picker-list">' + opts + '</div>';
    sheet.appendChild(layer);
  }

  function closePicker() {
    const el = document.getElementById('picker-layer');
    if (el) el.remove();
  }

  function applyPick(key, value) {
    const input = document.getElementById('f-' + key);
    const label = document.getElementById('pf-' + key);
    if (input) { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); }
    if (label) {
      label.textContent = value;
      label.classList.remove('empty');   // 从"未选择"占位恢复成正常值样式
    }
    // 分类变了：默认的"计入日均成本"跟着走；当前状态若不在新分类的词表里，换成第一个
    if (key === 'category') {
      if (!formCostTouched) {
        const cb = document.getElementById('f-costtrack');
        if (cb) cb.checked = QY.catOf(value, data()).costTrack !== false;
      }
      const list = QY.catStatuses(value, data());
      const cur = document.getElementById('f-status');
      if (cur && list.indexOf(cur.value) < 0) {
        cur.value = list[0];
        const lbl = document.getElementById('pf-status');
        if (lbl) lbl.textContent = list[0];
      }
    }
    closePicker();
  }

  /* ---------------- 表单 ---------------- */

  let formCostTouched = false;

  function pickerField(key, title, value) {
    return '<div class="field"><label>' + esc(title) + '</label>' +
      '<button type="button" class="picker-field" data-action="i-pick-open" data-k="' + key + '" data-title="' + esc(title) + '">' +
        '<span id="pf-' + key + '">' + esc(value == null ? '' : value) + '</span><span class="chev">›</span>' +
      '</button>' +
      '<input type="hidden" id="f-' + key + '" value="' + esc(value == null ? '' : value) + '" /></div>';
  }

  /* 新版表单的行结构（fsheet）：左标签右控件，见 styles.css .fsheet 一节。
   * 一并维护旧的 pickerField：别的表单（OCR 等）还在用。 */
  function frowText(id, label, val, ph, attrs) {
    return '<div class="frow"><span class="fl">' + label + '</span>' +
      '<input id="' + id + '" class="input finput" placeholder="' + esc(ph || '') + '" value="' +
        esc(val == null ? '' : val) + '" autocomplete="off"' + (attrs || '') + ' /></div>';
  }
  function frowPicker(key, title, value, ph) {
    const has = value != null && value !== '';
    return '<div class="frow"><span class="fl">' + esc(title) + '</span>' +
      '<button type="button" class="fpick" data-action="i-pick-open" data-k="' + key + '" data-title="' + esc(title) + '">' +
        '<span class="fpick-v' + (has ? '' : ' empty') + '" id="pf-' + key + '">' + esc(has ? value : (ph || '未选择')) + '</span>' +
        '<span class="chev">›</span>' +
      '</button>' +
      '<input type="hidden" id="f-' + key + '" value="' + esc(has ? value : '') + '" /></div>';
  }
  function frowDate(id, label, value) {
    return '<div class="frow"><span class="fl">' + label + '</span>' +
      '<input id="' + id + '" class="input finput fdate" type="date" readonly data-action="i-date"' +
        ' data-target="' + id + '" value="' + (value || '') + '" /></div>';
  }

  function formHTML(item) {
    const d = data();
    editingId = item ? item.id : null;
    formPhoto = item ? (item.photo || null) : null;
    formCostTouched = !!item && typeof item.costTrack === 'boolean';

    const defCat = (QY.catList(d)[0] || {}).name || '其他';
    const e = item || {
      name: '', category: defCat, sub: '', acquiredAt: QY.iso(QY.today()),
      source: '商店购买', cost: null, qty: 1, unit: '个', status: QY.catStatuses(defCat, d)[0], location: '',
      expiresAt: null, openedAt: null, warrantyUntil: null, note: '', photo: null
    };
    const costOn = item
      ? QY.tracksCost(item, d)
      : QY.catOf(e.category, d).costTrack !== false;

    return '' +
      '<div class="fsec">基本</div>' +
        '<div class="fcard">' +
          frowText('f-name', '名称', e.name, '例如：发卡') +
          frowPicker('category', '分类', e.category) +
          frowDate('f-date', '获得日期', e.acquiredAt) +
        '</div>' +

        '<div class="fsec">金额与数量</div>' +
        '<div class="fcard">' +
          '<div class="frow"><span class="fl">价格</span><span class="fpre">¥</span>' +
            '<input id="f-cost" class="input finput" type="number" step="0.01" inputmode="decimal" placeholder="0.00" value="' +
              (e.cost != null ? e.cost : '') + '" /></div>' +
          '<div class="frow"><span class="fl">数量</span>' +
            '<input id="f-qty" class="input finput" type="number" step="1" inputmode="numeric" value="' + (e.qty || 1) + '" />' +
            '<button type="button" class="fpick unit" data-action="i-pick-open" data-k="unit" data-title="单位">' +
              '<span class="fpick-v" id="pf-unit">' + esc(e.unit || '个') + '</span><span class="chev">›</span>' +
            '</button>' +
            '<input type="hidden" id="f-unit" value="' + esc(e.unit || '个') + '" /></div>' +
          '<label class="frow wide"><span class="fl">计入日均成本</span>' +
            '<span class="fsw"><input type="checkbox" id="f-costtrack"' + (costOn ? ' checked' : '') + ' /><i></i></span>' +
          '</label>' +
        '</div>' +

        '<div class="fsec">图片<small>支持动图</small></div>' +
        '<div class="fcard"><div class="fphoto">' +
          '<div class="photo-wrap' + (formPhoto ? ' has-img' : '') + '" id="f-photo-wrap">' +
            '<div class="photo-thumb' + (formPhoto ? '' : ' empty') + '" id="f-photo" data-action="i-photo"' +
              (formPhoto ? ' style="background-image:url(' + formPhoto + ')"' : '') + '>' +
              (formPhoto ? '' : (window.QYIcon ? QYIcon.svg('photoadd', 26) : '＋')) + '</div>' +
            '<button type="button" class="photo-del" data-action="i-photo-clear" aria-label="删除图片">×</button>' +
          '</div>' +
          '<div class="fphoto-info"><b>' + (formPhoto ? '更换图片' : '添加图片') + '</b></div>' +
        '</div></div>' +

        '<div class="fmore-wrap">' +
        '<button type="button" class="fmore-btn" data-action="i-more" id="i-more-btn">' +
          '<span>更多选项</span><span class="chev">›</span>' +
        '</button>' +
        '<div class="fmore-body" id="i-more">' +
          '<div class="fcard">' +
            frowPicker('source', '来源', e.source) +
            frowPicker('status', '状态', e.status) +
            frowText('f-sub', '二级分类', e.sub, '装饰 / 生鲜 / 家电…') +
            frowDate('f-opened', '开封日期', e.openedAt) +
            frowDate('f-warranty', '保修至', e.warrantyUntil) +
            frowDate('f-exp', '到期日', e.expiresAt) +
            frowText('f-loc', '存放位置', e.location, '卧室抽屉') +
            frowText('f-note', '备注', e.note, '补充说明…') +
          '</div>' +
        '</div>' +
        '</div>' +

        '<div class="sheet-actions">' +
          '<button class="btn primary" data-action="i-save">' + (item ? '保存' : '添加') + '</button>' +
        '</div>';
  }

  function openForm(item) {
    // 全屏编辑页（外壳和返回确认由 openFullpage 提供）
    UI().openFullpage(item ? '编辑物品' : '新增物品', formHTML(item || null), { edit: !!item });
    if (item) {
      // 编辑时默认展开"更多"，让用户看到全部字段
      const more = document.getElementById('i-more');
      const btn = document.getElementById('i-more-btn');
      if (more) more.classList.add('open');
      if (btn) btn.classList.add('open');
    }
  }

  function syncPhoto() {
    const box = document.getElementById('f-photo');
    const wrap = document.getElementById('f-photo-wrap');
    if (wrap) wrap.classList.toggle('has-img', !!formPhoto);
    // 图片增删是程序改值，派发 input 让全屏编辑页标脏
    if (wrap) wrap.dispatchEvent(new Event('input', { bubbles: true }));
    if (!box) return;
    if (formPhoto) {
      box.classList.remove('empty');
      box.style.backgroundImage = 'url(' + formPhoto + ')';
      box.textContent = '';
    } else {
      box.classList.add('empty');
      box.style.backgroundImage = '';
      box.innerHTML = window.QYIcon ? QYIcon.svg('photoadd', 26) : '＋';
    }
  }

  function saveForm() {
    const d = data();
    const nameEl = document.getElementById('f-name');
    const name = (nameEl.value || '').trim();
    if (!name) { UI().toast('请先填写名称'); return; }

    const costRaw = document.getElementById('f-cost').value;
    const fields = {
      name: name,
      category: document.getElementById('f-category').value || '其他',
      sub: (document.getElementById('f-sub').value || '').trim(),
      acquiredAt: document.getElementById('f-date').value || QY.iso(QY.today()),
      source: document.getElementById('f-source').value,
      cost: costRaw === '' ? null : Number(costRaw),
      qty: Number(document.getElementById('f-qty').value) || 1,
      unit: document.getElementById('f-unit').value,
      status: document.getElementById('f-status').value,
      location: (document.getElementById('f-loc').value || '').trim(),
      expiresAt: document.getElementById('f-exp').value || null,
      openedAt: document.getElementById('f-opened').value || null,
      warrantyUntil: document.getElementById('f-warranty').value || null,
      note: (document.getElementById('f-note').value || '').trim(),
      photo: formPhoto,
      costTrack: document.getElementById('f-costtrack').checked
    };

    if (editingId) {
      const it = byId(editingId);
      if (it) {
        // 记下改了哪些字段，给时间线一条"修改"记录
        const NAMES = { name: '名称', category: '分类', sub: '二级分类', acquiredAt: '获得日期',
          source: '来源', cost: '价格', qty: '数量', unit: '单位', status: '状态',
          location: '位置', expiresAt: '到期日', openedAt: '开封日期', warrantyUntil: '保修',
          note: '备注', photo: '图片', costTrack: '日均成本' };
        const changed = Object.keys(fields).filter(function (k) {
          return String(it[k] == null ? '' : it[k]) !== String(fields[k] == null ? '' : fields[k]);
        });
        Object.keys(fields).forEach(function (k) { it[k] = fields[k]; });
        if (changed.length) {
          data().events.push({
            id: QY.uid('ev'), itemId: it.id, type: 'edited',
            at: QY.iso(QY.today()), amount: null,
            note: changed.map(function (k) { return NAMES[k] || k; }).join('、')
          });
        }
        UI().save();
        UI().closeSheet();
        state.detailId = editingId;
        editingId = null;
        UI().mount();
        UI().toast('已保存');
      }
      return;
    }

    const item = Object.assign({ id: QY.uid('it'), icon: '', openedAt: null, warrantyUntil: null }, fields);
    d.items.push(item);
    d.events.push({
      id: QY.uid('ev'), itemId: item.id, type: 'acquired',
      at: item.acquiredAt, amount: item.cost, note: item.source
    });
    UI().save();
    UI().closeSheet();
    state.detailId = null;
    UI().mount();
    UI().toast('已添加「' + name + '」');
  }

  /* ---------------- 分类管理（放在"我的"里） ---------------- */

  let catEdit = null;   // 正在编辑的分类名，'' 表示新增

  /* 分类管理：'items' 只看物品分类 / 'notes' 只看随笔分类 / 'all' 两块平铺。
     "我的"页两行分别进单块；不传 mode 保持上次的（保存/改名后回同一块） */
  let catMgrMode = 'all';
  function openCatManager(mode) {
    if (mode) catMgrMode = mode;
    catEdit = null;
    renderCatSheet();
  }

  function renderCatSheet() {
    const d = data();
    const cats = QY.catList(d);

    if (catEdit !== null) {
      const isNew = catEdit === '';
      const c = isNew ? QY.nextCatStyle(d) : QY.catOf(catEdit, d);
      const used = isNew ? 0 : d.items.filter(function (i) { return i.category === catEdit; }).length;
      // 图标候选：每一个都能映射到 icons.js 里的【不同】线性图标
      //（列表里出现两个同图标的选项会让用户以为坏了）
      const emojis = ['📦', '🥛', '💊', '🧺', '🧣', '💻', '⚡️', '🎀', '🧴', '🔧', '📚', '⌚️', '🔌', '🪴', '💡']
        .map(function (em) {
          return '<button type="button" class="emoji-opt ' + (em === c.emoji ? 'on' : '') +
            '" data-action="i-cat-emoji" data-em="' + em + '">' +
            (window.QYIcon ? QYIcon.forEmoji(em, 21) : em) + '</button>';
        }).join('');

      UI().openSheet('' +
        '<div class="sheet"><div class="grabber"></div>' +
          '<h3>' + (isNew ? '新增分类' : '编辑分类') + '</h3>' +
          '<div class="field"><label>名称</label>' +
            '<input id="cat-name" class="input" value="' + esc(isNew ? '' : catEdit) + '" placeholder="例如：文具" /></div>' +
          '<div class="field"><label>图标</label>' +
            '<div class="emoji-row" id="cat-emoji">' + emojis + '</div></div>' +
          '<label class="check-row"><input type="checkbox" id="cat-track"' + (c.costTrack !== false ? ' checked' : '') + ' />' +
            '<span>默认计入日均成本</span><b>该分类下新物品的默认值</b></label>' +
          '<div class="field"><label>这个分类的状态</label>' +
            '<input id="cat-statuses" class="input" value="' +
              esc((c.statuses || QY.FALLBACK_STATUSES).join('，')) + '" placeholder="未开封，使用中，已用完" />' +
            '<div class="field-note">用逗号分隔，按先后顺序</div></div>' +
          (used ? '<div class="notice">有 ' + used + ' 件物品在用这个分类</div>' : '') +
          '<div class="sheet-actions">' +
            '<button class="btn plain" data-action="i-cat-cancel">取消</button>' +
            '<button class="btn primary" data-action="i-cat-save">保存</button>' +
          '</div>' +
          (isNew ? '' : '<div class="danger-zone">' +
            '<button class="danger-btn" data-action="i-cat-del">删除这个分类</button></div>') +
        '</div>');
      return;
    }

    const rows = cats.map(function (c) {
      const n = d.items.filter(function (i) { return i.category === c.name; }).length;
      return '<div class="row" data-action="i-cat-edit" data-name="' + esc(c.name) + '">' +
        '<div class="tile sm" style="background:linear-gradient(150deg,' + c.g[0] + ',' + c.g[1] + ')">' +
          (window.QYIcon ? QYIcon.forEmoji(c.emoji, 17) : c.emoji) + '</div>' +
        '<div class="row-main"><div class="row-title">' + esc(c.name) + '</div>' +
          '<div class="row-sub">' + n + ' 件 · ' + (c.costTrack !== false ? '计入日均成本' : '不计入日均成本') + '</div></div>' +
        '<div class="row-side"><span class="chev">›</span></div></div>';
    }).join('');

    // 一页平铺：上面物品分类，下面随笔分类（不用再点一次选哪个）
    const noteRows = (function () {
      if (!window.QYV || !QYV.snapshot) return '';
      const snap = QYV.snapshot();
      const used = {};
      snap.entries.forEach(function (e) { used[e.cat] = (used[e.cat] || 0) + 1; });
      const rs = snap.cats.map(function (c) {
        return '<div class="row static">' +
          '<div class="tl-dot">' + (window.QYIcon ? QYIcon.forEmoji(c.emoji || '📁', 17) : (c.emoji || '📁')) + '</div>' +
          '<div class="row-main"><div class="row-title">' + esc(c.name) + '</div>' +
            '<div class="row-sub">' + (used[c.name] || 0) + ' 篇随笔</div></div>' +
          '<div class="row-side" style="display:flex;gap:6px">' +
            '<button class="btn plain" data-action="i-ncat-rename" data-name="' + esc(c.name) +
              '" style="padding:7px 12px;font-size:13px">改名</button>' +
            ((used[c.name] || 0)
              ? '<button class="btn plain" disabled style="padding:7px 12px;font-size:13px;opacity:.45">删除</button>'
              : '<button class="btn plain" data-action="i-ncat-del" data-name="' + esc(c.name) +
                '" style="padding:7px 12px;font-size:13px;color:var(--red)">删除</button>') +
          '</div></div>';
      }).join('');
      return '<div class="group">' + (rs || '<div class="empty" style="padding:16px"><p>还没有分类</p></div>') +
          '<div class="row" data-action="i-ncat-add">' +
            '<div class="tl-dot">＋</div>' +
            '<div class="row-main"><div class="row-title">新增随笔分类</div></div></div>' +
        '</div>';
    })();

    // 进哪个入口就只看哪块（"我的"页两行分开进；旧入口默认两块平铺）
    const showItems = catMgrMode !== 'notes';
    const showNotes = catMgrMode !== 'items';
    const headTitle = showItems && showNotes ? '分类管理' : (showItems ? '物品分类' : '随笔分类');

    UI().openSheet('' +
      '<div class="sheet"><div class="grabber"></div>' +
        '<div class="sheet-head"><h3>' + headTitle + '</h3>' +
          (showItems && !showNotes ? '<span><button class="head-btn" data-action="i-cat-sort">排序</button></span>' : '') + '</div>' +
        (showItems ?
          (showNotes ? '<div class="section-head" style="margin:6px 0 8px"><h2>物品分类</h2>' +
            '<span><button class="head-btn" data-action="i-cat-sort">排序</button></span></div>' : '') +
          '<div class="group">' + rows +
            '<div class="row" data-action="i-cat-new">' +
              '<div class="tl-dot">＋</div>' +
              '<div class="row-main"><div class="row-title">新增分类</div></div></div>' +
          '</div>' : '') +
        (showNotes ?
          (showItems ? '<div class="section-head" style="margin:18px 0 8px"><h2>随笔分类</h2></div>' : '') +
          noteRows : '') +
        '<div class="sheet-actions" style="margin-top:14px">' +
          '<button class="btn plain" data-action="i-close">关闭</button>' +
        '</div>' +
      '</div>');
  }

  function saveCat() {
    const d = data();
    const nameEl = document.getElementById('cat-name');
    const name = (nameEl.value || '').trim();
    if (!name) { UI().toast('请填写分类名称'); return; }
    const emojiBtn = document.querySelector('#cat-emoji .emoji-opt.on');
    const emoji = emojiBtn ? emojiBtn.getAttribute('data-em') : '📦';
    const track = document.getElementById('cat-track').checked;
    const isNew = catEdit === '';

    // 状态词表：按中英文逗号/顿号切分，去空白去重；空的话退回通用词表
    const raw = (document.getElementById('cat-statuses') || {}).value || '';
    const seen = {};
    const statuses = raw.split(/[,，、]/).map(function (s) { return s.trim(); })
      .filter(function (s) { if (!s || seen[s]) return false; seen[s] = 1; return true; });
    if (!statuses.length) {
      UI().toast('至少写一个状态');
      return;
    }

    if (isNew) {
      if (QY.catList(d).some(function (c) { return c.name === name; })) { UI().toast('已经有这个分类了'); return; }
      const style = QY.nextCatStyle(d);
      d.itemCats.push({ name: name, emoji: emoji, g: style.g.slice(), costTrack: track, statuses: statuses });
    } else {
      const c = QY.catOf(catEdit, d);
      const renamed = name !== catEdit;
      if (renamed && QY.catList(d).some(function (x) { return x.name === name; })) {
        UI().toast('已经有这个分类了'); return;
      }
      c.emoji = emoji;
      c.costTrack = track;
      c.statuses = statuses;
      // 词表改了之后，把已经不在词表里的物品状态纠正回第一个
      d.items.forEach(function (it) {
        if (it.category !== catEdit) return;
        if (statuses.indexOf(it.status) < 0) it.status = statuses[0];
      });
      if (renamed) {
        d.items.forEach(function (i) { if (i.category === catEdit) i.category = name; });
        c.name = name;
      }
    }
    UI().save();
    catEdit = null;
    renderCatSheet();
    UI().mount();
    UI().toast(isNew ? '分类已添加' : '分类已保存');
  }

  function deleteCat() {
    const d = data();
    const name = catEdit;
    if (!name) return;
    const used = d.items.filter(function (i) { return i.category === name; }).length;
    confirmSheet(used
      ? '有 ' + used + ' 件物品在用「' + name + '」，删除后它们会变成「其他」。'
      : '删除分类「' + name + '」？',
      { title: '删除分类', ok: '删除', danger: true }
    ).then(function (ok) {
      if (!ok) return;
      d.itemCats = QY.catList(d).filter(function (c) { return c.name !== name; });
      if (!d.itemCats.length) {
        d.itemCats = QY.DEFAULT_CATS.map(function (c) {
          return { name: c.name, emoji: c.emoji, g: c.g.slice(), costTrack: c.costTrack, statuses: c.statuses.slice() };
        });
      }
      d.items.forEach(function (i) { if (i.category === name) i.category = '其他'; });
      UI().save();
      catEdit = null;
      renderCatSheet();
      UI().mount();
      UI().toast('分类已删除');
    });
  }

  /* ---------------- 其它动作 ---------------- */

  /* 改状态的实际落库（手动弹窗和 AI 动作共用）：
     记时间线，状态换成"开封"类且没记过开封日期时顺手补上 */
  function applyStatus(item, v) {
    const from = item.status;
    item.status = v;
    if (/开封/.test(v) && !item.openedAt) {
      item.openedAt = QY.iso(QY.today());
      data().events.push({
        id: QY.uid('ev'), itemId: item.id, type: 'opened',
        at: item.openedAt, amount: null, note: null
      });
    }
    if (v !== from) {
      data().events.push({
        id: QY.uid('ev'), itemId: item.id, type: 'status',
        at: QY.iso(QY.today()), amount: null, note: from + ' → ' + v
      });
    }
    return v !== from;
  }

  function changeStatus(id) {
    const item = byId(id);
    if (!item) return;
    const cur = item.status;
    const onPick = function (v) {
      applyStatus(item, v);
      UI().save();
      UI().closeSheet();
      UI().mount();
      UI().toast('状态已改为 ' + v);
    };
    const list = QY.catStatuses(item.category, data());
    UI().openSheet('' +
      '<div class="sheet"><div class="grabber"></div>' +
        '<h3>改状态</h3>' +
        '<p class="hint">' + esc(item.category) + ' 的阶段：' + esc(list.join(' → ')) + '</p>' +
        '<div class="group">' + list.map(function (s) {
          return '<div class="picker-opt ' + (s === cur ? 'on' : '') + '" data-action="i-status-set" data-v="' + esc(s) + '">' +
            '<span>' + esc(s) + '</span>' +
            (s === cur ? '<span class="tick">✓</span>' : '') + '</div>';
        }).join('') + '</div>' +
        '<div class="sheet-actions" style="margin-top:14px">' +
          '<button class="btn plain" data-action="i-close">取消</button></div>' +
      '</div>');
    pendingStatusPick = onPick;
  }
  let pendingStatusPick = null;

  /* ---------------- 时间线：记一笔 / 长按修改删除 ----------------
   * 自动记录（新增、改状态、归档、编辑）之外，动作类的（维修/更换/借出…）
   * 用「＋ 记一笔」手动补；长按任意一条可改可删。
   */
  const MANUAL_EVENT_TYPES = ['used', 'opened', 'repaired', 'replaced', 'lent', 'returned', 'disposed', 'status'];

  function openEventSheet(itemId, ev) {
    const e = ev || { id: null, type: 'used', at: QY.iso(QY.today()), amount: null, note: '' };
    const chips = MANUAL_EVENT_TYPES.map(function (t) {
      const meta = QY.EVENT_TYPES[t];
      return '<button type="button" class="chip ' + (e.type === t ? 'active' : '') +
        '" data-action="i-ev-type" data-v="' + t + '">' + (window.QYIcon ? QYIcon.forEvent(t, 14) : meta.emoji) +
        ' ' + meta.label + '</button>';
    }).join('');
    UI().openSheet('' +
      '<div class="sheet"><div class="grabber"></div>' +
        '<h3>' + (ev ? '修改这条记录' : '记一笔') + '</h3>' +
        '<div class="chips" style="margin:10px 0 4px">' + chips + '</div>' +
        '<input type="hidden" id="ev-type" value="' + e.type + '" />' +
        '<div class="field"><label>日期</label>' +
          '<input id="ev-date" class="input" type="date" readonly data-action="i-date"' +
            ' data-target="ev-date" value="' + e.at + '" /></div>' +
        '<div class="field-row">' +
          '<div class="field"><label>金额（可选，如维修费）</label>' +
            '<input id="ev-amount" class="input" type="number" step="0.01" placeholder="0"' +
              ' value="' + (e.amount != null ? e.amount : '') + '" /></div>' +
          '<div class="field"><label>备注</label>' +
            '<input id="ev-note" class="input" value="' + esc(e.note || '') + '" /></div>' +
        '</div>' +
        '<div class="sheet-actions" style="flex-wrap:wrap">' +
          (ev ? '<button class="btn plain" data-action="i-ev-del" data-id="' + itemId +
            '" data-ev="' + e.id + '" style="color:var(--red)">删除</button>' : '') +
          '<button class="btn plain" data-action="i-close">取消</button>' +
          '<button class="btn primary" data-action="i-ev-save" data-id="' + itemId +
            '" data-ev="' + (e.id || '') + '">保存</button>' +
        '</div>' +
      '</div>');
  }

  function saveEventSheet(itemId, evId) {
    const d = data();
    const type = (document.getElementById('ev-type') || {}).value || 'used';
    const at = (document.getElementById('ev-date') || {}).value || QY.iso(QY.today());
    const amountRaw = ((document.getElementById('ev-amount') || {}).value || '').trim();
    const note = ((document.getElementById('ev-note') || {}).value || '').trim();
    if (evId) {
      const ev = d.events.filter(function (x) { return x.id === evId; })[0];
      if (!ev) { UI().toast('这条记录已经不在了'); UI().closeSheet(); return; }
      ev.type = type; ev.at = at;
      ev.amount = amountRaw === '' ? null : Number(amountRaw);
      ev.note = note || null;
      UI().toast('已修改');
    } else {
      d.events.push({
        id: QY.uid('ev'), itemId: itemId, type: type, at: at,
        amount: amountRaw === '' ? null : Number(amountRaw), note: note || null
      });
      UI().toast('已记一笔');
    }
    UI().save();
    UI().closeSheet();
    UI().mount();
  }

  function deleteEvent(itemId, evId) {
    const d = data();
    const i = d.events.findIndex(function (x) { return x.id === evId && x.itemId === itemId; });
    if (i < 0) { UI().closeSheet(); return; }
    confirmSheet('删除这条时间线记录？', { danger: true, ok: '删除' }).then(function (yes) {
      if (!yes) return;
      d.events.splice(i, 1);
      UI().save();
      UI().closeSheet();
      UI().mount();
      UI().toast('已删除');
    });
  }

  /* ---------------- 分类行：按宽度收纳进「⋯」下拉 ----------------
   * 全部恢复显示量一遍自然宽度；放不下就亮出 ⋯ 按钮再量一遍（要扣掉按钮宽）。
   * 当前选中的分类若被收进下拉，按钮直接显示它的名字，选择状态看得见。 */
  let hiddenCats = [];

  function layoutCats() {
    const row = document.querySelector('.page-top .cat-row');
    if (!row) return;
    const wrap = row.querySelector('.cat-wrap');
    const more = row.querySelector('.cat-more');
    if (!wrap || !more) return;
    const chips = Array.prototype.slice.call(wrap.children);
    const gap = 8;
    more.style.display = 'none';
    chips.forEach(function (c) { c.style.display = ''; });
    hiddenCats = [];
    const fits = function (limit) {
      let used = 0;
      for (let i = 0; i < chips.length; i++) {
        used += chips[i].offsetWidth + (i ? gap : 0);
        if (used > limit) return i;         // 第 i 个开始放不下
      }
      return chips.length;
    };
    let hideFrom = fits(wrap.clientWidth);
    if (hideFrom < chips.length) {
      // 显示要用 'flex'，不能用 ''：CSS 默认 display:none，
      // 清空内联样式会回落成隐藏，按钮就永远出不来了
      more.style.display = 'flex';
      // wrap 是 flex:1，⋯ 亮出来的瞬间它已经被挤窄了——
      // 直接用新的 clientWidth，不能再手动减 ⋯ 的宽度（等于双重扣位，
      // 会白白收起一个本放得下的分类，行尾留出一个空位）
      hideFrom = fits(wrap.clientWidth);
      for (let i = hideFrom; i < chips.length; i++) chips[i].style.display = 'none';
      hiddenCats = chips.slice(hideFrom).map(function (c) { return c.getAttribute('data-cat'); });
    }
    // 选中项被收进下拉时，按钮显示选中分类名（否则就是 ⋯）
    const sel = hiddenCats.indexOf(state.category) >= 0;
    more.textContent = sel ? state.category : '⋯';
    more.classList.toggle('active', sel);
  }

  let catResizeTimer = null;
  window.addEventListener('resize', function () {
    if (catResizeTimer) clearTimeout(catResizeTimer);
    catResizeTimer = setTimeout(layoutCats, 120);
  });

  /* 筛选小浮层：点外面收起（选项点击走 i-filter 自己收）；
     分类「⋯」的浮层也是同一个类，一并收 */
  document.addEventListener('click', function (e) {
    const menu = document.querySelector('.seg-dd-menu');
    if (!menu) return;
    if (e.target.closest && e.target.closest('.seg-dd-menu, .seg-dd, .cat-more, .nav-more')) return;
    menu.remove();
  }, true);

  /* 长按时间线条目 500ms → 打开修改弹窗（平时没有多余的按钮，界面干净） */
  (function bindTimelinePress() {
    let pressTimer = null;
    const clear = function () { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } };
    document.addEventListener('pointerdown', function (e) {
      const el = e.target.closest && e.target.closest('.tl-item[data-ev-id]');
      if (!el) return;
      const itemId = el.getAttribute('data-id');
      const evId = el.getAttribute('data-ev-id');
      clear();
      pressTimer = setTimeout(function () {
        pressTimer = null;
        const ev = data().events.filter(function (x) { return x.id === evId; })[0];
        if (ev) openEventSheet(itemId, ev);
      }, 500);
    }, { passive: true });
    document.addEventListener('pointermove', clear, { passive: true });
    document.addEventListener('pointerup', clear);
    document.addEventListener('pointercancel', clear);
  })();

  /* App 自己的确认框。
   * 不依赖 window.confirm —— 安卓 WebView 里它默认只会返回 false（见 MainActivity
   * 里 webChromeClient 的注释），那样"点了删除没反应"。自己画还能统一风格。
   */
  function confirmSheet(message, o) {
    o = o || {};
    return new Promise(function (resolve) {
      const layer = document.createElement('div');
      layer.id = 'qy-confirm';
      // center：确认框必须居中。.picker-layer 默认是"底部弹出"，不加这个会被推到屏幕下方
      layer.className = 'picker-layer center';
      layer.innerHTML =
        '<div class="confirm-box">' +
          '<h3>' + esc(o.title || '确认') + '</h3>' +
          '<p class="hint">' + esc(message) + '</p>' +
          '<div class="sheet-actions">' +
            '<button class="btn plain" data-c="0">' + esc(o.cancel || '取消') + '</button>' +
            '<button class="btn primary" data-c="1"' +
              (o.danger ? ' style="background:var(--red)"' : '') + '>' + esc(o.ok || '确定') + '</button>' +
          '</div>' +
        '</div>';
      layer.addEventListener('click', function (ev) {
        const b = ev.target.closest('[data-c]');
        if (b) {
          const v = b.getAttribute('data-c') === '1';
          layer.remove();
          resolve(v);
          return;
        }
        if (ev.target === layer) { layer.remove(); resolve(false); }
      });
      // 和 picker 一样必须挂 body：面板带 transform 时，挂在里面会让 fixed 退化成
      // absolute，滚动过的面板上弹确认框就会跑到内容顶部（看不见）
      document.body.appendChild(layer);
    });
  }

  /* ---------------- 自定义日期选择 ----------------
   * 不用 <input type="date"> 的原生弹窗：样式和 App 不搭，确认键还叫"设置"。
   * 自己画一个月历，居中卡片显示，按钮是 今天 / 取消 / 确定。
   */
  let calState = null;    // { inputId, view:'YYYY-MM', picked:'YYYY-MM-DD' }

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function calHtml() {
    const st = calState;
    const y = Number(st.view.split('-')[0]);
    const m = Number(st.view.split('-')[1]);
    const firstDow = (new Date(y, m - 1, 1).getDay() + 6) % 7;   // 周一当第一列
    const days = new Date(y, m, 0).getDate();
    const todayIso = QY.iso(QY.today());
    let cells = '';
    for (let i = 0; i < firstDow; i++) cells += '<span class="cal-cell blank"></span>';
    for (let d = 1; d <= days; d++) {
      const iso = y + '-' + pad2(m) + '-' + pad2(d);
      cells += '<button type="button" class="cal-cell' + (iso === st.picked ? ' on' : '') +
        (iso === todayIso ? ' today' : '') + '" data-action="i-cal-pick" data-v="' + iso + '">' + d + '</button>';
    }
    return '<div class="picker-card cal-card">' +
      '<div class="cal-head">' +
        '<button type="button" class="cal-nav" data-action="i-cal-move" data-d="-1">‹</button>' +
        '<b>' + y + ' 年 ' + m + ' 月</b>' +
        '<button type="button" class="cal-nav" data-action="i-cal-move" data-d="1">›</button>' +
      '</div>' +
      '<div class="cal-week"><span>一</span><span>二</span><span>三</span><span>四</span>' +
        '<span>五</span><span>六</span><span>日</span></div>' +
      '<div class="cal-grid">' + cells + '</div>' +
      '<div class="sheet-actions" style="margin-top:12px">' +
        '<button type="button" class="btn plain" data-action="i-cal-today">今天</button>' +
        '<button type="button" class="btn plain" data-action="i-cal-cancel">取消</button>' +
        '<button type="button" class="btn primary" data-action="i-cal-ok">确定</button>' +
      '</div>' +
    '</div>';
  }

  function renderCal() {
    const host = document.getElementById('picker-layer');
    if (!host) return;
    host.className = 'picker-layer center';
    host.innerHTML = calHtml();
  }

  function openDatePicker(inputId) {
    const el = document.getElementById(inputId);
    const cur = (el && el.value) ? el.value : QY.iso(QY.today());
    calState = { inputId: inputId, view: cur.slice(0, 7), picked: cur };
    openOverlay(calHtml());
    const host = document.getElementById('picker-layer');
    if (host) host.classList.add('center');
  }

  /* ---------------- 分类排序（按住手柄拖动） ----------------
   * 主流 App 的手感：被拖的行跟手浮起（阴影+轻微放大），
   * 其它行平滑让位（位移动画），松手才提交顺序。
   */
  let catDrag = null;   // { name, el, from, to, startY, h, tops:[], moved }
  let catJustDragged = false;   // 刚拖完，挡住浏览器补发的那个 click

  function catSortRows() {
    return QY.catList(data()).map(function (c) {
      return '<div class="set-row cat-sort-row" data-cat="' + esc(c.name) + '">' +
        '<span class="set-title">' + c.emoji + '　' + esc(c.name) + '</span>' +
        '<span class="cat-handle">☰</span></div>';
    }).join('');
  }

  function openCatSort() {
    UI().openSheet('<div class="sheet"><div class="grabber"></div>' +
      '<h3>分类排序</h3>' +
      '<p class="hint">按住右侧 ☰ 拖动，松手保存</p>' +
      '<div class="group" id="cat-sort-list">' + catSortRows() + '</div>' +
      '<div class="sheet-actions" style="margin-top:14px">' +
        '<button class="btn primary" data-action="i-cat-sort-done">完成</button>' +
      '</div></div>');
  }

  /* 其它行让位：被拖行从 from 移到 to 时，中间的行整体上/下挪一格 */
  function paintCatShift() {
    const rows = document.querySelectorAll('.cat-sort-row');
    Array.prototype.forEach.call(rows, function (r, i) {
      if (catDrag && r === catDrag.el) return;
      let dy = 0;
      if (catDrag) {
        if (i > catDrag.from && i <= catDrag.to) dy = -catDrag.h;
        else if (i < catDrag.from && i >= catDrag.to) dy = catDrag.h;
      }
      r.style.transform = dy ? 'translateY(' + dy + 'px)' : '';
    });
  }

  document.addEventListener('pointerdown', function (e) {
    const row = e.target.closest && e.target.closest('.cat-sort-row');
    if (!row) return;
    const rows = Array.prototype.slice.call(document.querySelectorAll('.cat-sort-row'));
    const from = rows.indexOf(row);
    if (from < 0) return;
    catDrag = {
      name: row.getAttribute('data-cat'),
      el: row,
      from: from,
      to: from,
      startY: e.clientY,
      moved: false,
      h: row.getBoundingClientRect().height,
      tops: rows.map(function (r) { return r.getBoundingClientRect().top; })
    };
    row.classList.add('dragging');
    paintCatShift();
  }, { passive: true });

  document.addEventListener('pointermove', function (e) {
    if (!catDrag) return;
    const dy = e.clientY - catDrag.startY;
    if (Math.abs(dy) > 6) catDrag.moved = true;
    catDrag.el.style.transform = 'translateY(' + dy + 'px) scale(1.02)';

    // 目标位置：用拖动前记录的原始位置算，避免被 transform 干扰
    const center = catDrag.tops[catDrag.from] + dy + catDrag.h / 2;
    let to = catDrag.from;
    for (let i = 0; i < catDrag.tops.length; i++) {
      if (i === catDrag.from) continue;
      const mid = catDrag.tops[i] + catDrag.h / 2;
      if (i < catDrag.from && center < mid) { to = i; break; }
      if (i > catDrag.from && center > mid) to = i;
    }
    if (to !== catDrag.to) {
      catDrag.to = to;
      paintCatShift();
    }
  }, { passive: true });

  document.addEventListener('pointerup', function () {
    if (!catDrag) return;
    const d = data();
    const drag = catDrag;
    catDrag = null;
    drag.el.classList.remove('dragging');
    // 拖完浏览器会补一个 click。松手时手指若在面板之外，
    // 这个 click 会点到遮罩上 → 面板被关掉 → 看起来就像"排完序直接跳回我的"
    if (drag.moved) {
      catJustDragged = true;
      setTimeout(function () { catJustDragged = false; }, 360);
    }
    const list = QY.catList(d).slice();
    const from = list.map(function (c) { return c.name; }).indexOf(drag.name);
    if (from >= 0 && drag.to !== from) {
      const moved = list.splice(from, 1)[0];
      list.splice(drag.to, 0, moved);
      d.itemCats = list;
      UI().save();
    }
    // 复位并重绘（顺序已写入数据）
    const box = document.getElementById('cat-sort-list');
    if (box) {
      box.innerHTML = catSortRows();
      Array.prototype.forEach.call(box.querySelectorAll('.cat-sort-row'), function (r) {
        r.style.transform = '';
      });
    }
  }, { passive: true });

  /* ---------------- 回收站 ----------------
   * 删除 = 进回收站（30 天），不是真删。恢复时物品和它的时间线一起回来。
   */
  function deleteItem(id) {
    const d = data();
    const item = byId(id);
    if (!item) return;
    confirmSheet('把「' + item.name + '」移入回收站？保留 ' + QY.TRASH_DAYS + ' 天，期间可以恢复。',
      { title: '删除物品', ok: '移入回收站', cancel: '取消', danger: true }
    ).then(function (ok) {
      if (!ok) return;
      d.trash = d.trash || [];
      d.trash.push({
        id: QY.uid('tr'),
        kind: 'item',
        deletedAt: QY.iso(QY.today()),
        item: item,
        events: d.events.filter(function (e) { return e.itemId === id; })
      });
      d.items = d.items.filter(function (i) { return i.id !== id; });
      d.events = d.events.filter(function (e) { return e.itemId !== id; });
      UI().save();
      state.detailId = null;
      UI().mount();
      UI().toast('已移入回收站，' + QY.TRASH_DAYS + ' 天内可恢复');
    });
  }

  /* 回收站视图状态：分段 + 搜索 + 勾选（重渲染时保留） */
  let trashView = { tab: 'all', query: '', sel: {} };

  function trashEntries() {
    const d = data();
    // 旧数据的回收站条目 kind 叫 'collect'，读出来统一当 'note'
    return (d.trash || []).slice().sort(function (a, b) {
      return a.deletedAt < b.deletedAt ? 1 : -1;
    }).map(function (t) {
      return t.kind === 'collect' ? Object.assign({}, t, { kind: 'note' }) : t;
    });
  }

  function trashMatches(t) {
    if (trashView.tab !== 'all' && (t.kind || 'item') !== trashView.tab) return false;
    const q = trashView.query.trim().toLowerCase();
    if (!q) return true;
    const it = t.kind === 'note' ? t.entry : t.item;
    const hay = [(it && it.name) || '', (it && it.title) || '', (it && it.category) || '', (it && it.cat) || '']
      .join(' ').toLowerCase();
    return hay.indexOf(q) >= 0;
  }

  function openTrash() {
    trashView.sel = {};
    UI().openSheet('' +
      '<div class="sheet trash-sheet"><div class="grabber"></div>' +
        '<h3>回收站</h3>' +
        '<p class="hint">保留 ' + QY.TRASH_DAYS + ' 天，过期自动清理</p>' +
        '<div class="trash-search"><input id="t-query" class="input" placeholder="搜索" autocomplete="off" /></div>' +
        '<div class="segmented" id="trash-seg"></div>' +
        '<div id="trash-list"></div>' +
        '<div id="trash-foot"></div>' +
      '</div>');
    const q = document.getElementById('t-query');
    if (q) q.addEventListener('input', function () {
      trashView.query = q.value;
      renderTrashParts();
    });
    renderTrashParts();
  }

  function trashRowHTML(t) {
    const isNote = t.kind === 'note';
    const it = isNote ? (t.entry || {}) : (t.item || {});
    const title = isNote ? (it.title || '（无标题）') : (it.name || '（无名称）');
    const sub = (isNote ? '随笔 · ' + (it.cat || '') + ' · ' + QY.fmtDate(it.date) :
        (it.category || '') + ' · ' + QY.fmtDate(it.acquiredAt) + ' 获得') +
      ' · ' + QY.fmtDate(t.deletedAt) + ' 删除 · 还有 ' + QY.trashDaysLeft(t) + ' 天';
    const sel = !!trashView.sel[t.id];
    return '<div class="row static trow' + (sel ? ' sel' : '') + '" data-tid="' + t.id + '">' +
      '<span class="tsel' + (sel ? ' on' : '') + '" data-action="i-tsel" data-id="' + t.id + '" role="checkbox" aria-checked="' + sel + '">' +
        (sel ? (window.QYIcon ? QYIcon.svg('check', 14) : '✓') : '') + '</span>' +
      (isNote
        ? '<span class="tthumb">' + (window.QYIcon ? QYIcon.svg('book', 20) : '📝') + '</span>'
        : thumb(it, true)) +
      '<div class="row-main">' +
        '<div class="row-title">' + esc(title) + '</div>' +
        '<div class="row-sub">' + esc(sub) + '</div>' +
      '</div>' +
      '<div class="row-side"><button class="btn plain" data-action="i-restore" data-id="' + t.id + '" ' +
        'style="padding:8px 12px;font-size:13px">恢复</button></div>' +
    '</div>';
  }

  function renderFootOnly() {
    const foot = document.getElementById('trash-foot');
    if (!foot) return;
    const all = trashEntries();
    const nSel = Object.keys(trashView.sel).filter(function (k) { return trashView.sel[k]; }).length;
    foot.innerHTML = nSel
      ? '<div class="sheet-actions" style="margin-top:12px">' +
          '<button class="btn plain" data-action="i-purge-sel" style="color:var(--red)">彻底删除 ' + nSel + ' 项</button>' +
          '<button class="btn primary" data-action="i-restore-sel">恢复 ' + nSel + ' 项</button>' +
        '</div>'
      : '<div class="sheet-actions" style="margin-top:12px">' +
          (all.length ? '<button class="btn plain" data-action="i-empty" style="color:var(--red)">清空回收站</button>' : '') +
          '<button class="btn ' + (all.length ? 'plain' : 'primary') + '" data-action="i-close">完成</button>' +
        '</div>';
  }

  function renderTrashParts() {
    const all = trashEntries();
    const list = all.filter(trashMatches);
    const seg = document.getElementById('trash-seg');
    if (seg) {
      const nItem = all.filter(function (t) { return (t.kind || 'item') === 'item'; }).length;
      const nCol = all.filter(function (t) { return t.kind === 'note'; }).length;
      const segBtn = function (k, label, n) {
        return '<button class="' + (trashView.tab === k ? 'active' : '') + '" data-action="i-ttab" data-tab="' + k + '">' +
          label + (n ? ' ' + n : '') + '</button>';
      };
      seg.innerHTML = segBtn('all', '全部', all.length) + segBtn('item', '物品', nItem) + segBtn('note', '随笔', nCol);
    }
    const box = document.getElementById('trash-list');
    if (box) {
      box.innerHTML = list.length
        ? list.map(trashRowHTML).join('')
        : '<div class="empty" style="padding:26px 0"><div class="emoji">🗑</div><p>' +
          (all.length ? '没有匹配的结果' : '回收站是空的') + '</p></div>';
    }
    renderFootOnly();
  }

  function restoreOne(trashId, quiet) {
    const d = data();
    const t = (d.trash || []).filter(function (x) { return x.id === trashId; })[0];
    if (!t) return false;
    let label = '';
    if (t.kind === 'note' || t.kind === 'collect') {   // collect 是旧版随笔回收条目
      if (!window.QYV || !QYV.restoreEntry || !QYV.restoreEntry(t.entry)) return false;
      label = (t.entry && t.entry.title) || '随笔';
    } else {
      d.items.push(t.item);
      (t.events || []).forEach(function (e) { d.events.push(e); });
      label = (t.item && t.item.name) || '物品';
    }
    d.trash = d.trash.filter(function (x) { return x.id !== trashId; });
    delete trashView.sel[trashId];
    UI().save();
    UI().mount();
    if (!quiet) UI().toast('已恢复「' + label + '」');
    return true;
  }

  function purgeOne(trashId, quiet) {
    const d = data();
    const t = (d.trash || []).filter(function (x) { return x.id === trashId; })[0];
    if (!t) return;
    const label = t.kind === 'note' ? ((t.entry && t.entry.title) || '随笔') : ((t.item && t.item.name) || '物品');
    const doPurge = function () {
      d.trash = d.trash.filter(function (x) { return x.id !== trashId; });
      delete trashView.sel[trashId];
      UI().save();
      UI().mount();
      renderTrashParts();
      if (!quiet) UI().toast('已彻底删除「' + label + '」');
    };
    if (quiet) { doPurge(); return; }
    confirmSheet('彻底删除「' + label + '」？这一步不可恢复。',
      { title: '彻底删除', ok: '彻底删除', danger: true }
    ).then(function (ok) { if (ok) doPurge(); });
  }

  // 回收站里的动作单独挂一个监听，不占用 app.js 的动作表
  document.addEventListener('click', function (e) {
    const btn = e.target.closest && e.target.closest('[data-action="i-restore"],[data-action="i-purge"],[data-action="i-empty"],[data-action="i-tsel"],[data-action="i-ttab"],[data-action="i-restore-sel"],[data-action="i-purge-sel"]');
    if (!btn) return;
    e.stopPropagation();
    const act = btn.getAttribute('data-action');
    const d = data();
    if (act === 'i-restore') {
      if (restoreOne(btn.getAttribute('data-id'))) renderTrashParts();
    } else if (act === 'i-purge') {
      purgeOne(btn.getAttribute('data-id'));
    } else if (act === 'i-tsel') {
      // 只更新这一行和底部条——整列重绘会让连点丢事件、滚动跳回顶部
      const id = btn.getAttribute('data-id');
      trashView.sel[id] = !trashView.sel[id];
      if (!trashView.sel[id]) delete trashView.sel[id];
      const row = btn.closest('.trow');
      if (row) {
        const on = !!trashView.sel[id];
        row.classList.toggle('sel', on);
        const c = row.querySelector('.tsel');
        c.classList.toggle('on', on);
        c.setAttribute('aria-checked', on);
        c.innerHTML = on ? (window.QYIcon ? QYIcon.svg('check', 14) : '✓') : '';
      }
      renderFootOnly();
    } else if (act === 'i-ttab') {
      trashView.tab = btn.getAttribute('data-tab') || 'all';
      trashView.sel = {};
      renderTrashParts();
    } else if (act === 'i-restore-sel') {
      const ids = Object.keys(trashView.sel);
      let n = 0;
      ids.forEach(function (id) { if (restoreOne(id, true)) n++; });
      if (n) { UI().toast('已恢复 ' + n + ' 项'); renderTrashParts(); }
    } else if (act === 'i-purge-sel') {
      const ids = Object.keys(trashView.sel);
      if (!ids.length) return;
      confirmSheet('彻底删除选中的 ' + ids.length + ' 项？这一步不可恢复。',
        { title: '彻底删除', ok: '彻底删除', danger: true }
      ).then(function (ok) {
        if (!ok) return;
        ids.forEach(function (id) { purgeOne(id, true); });
        UI().toast('已彻底删除 ' + ids.length + ' 项');
        renderTrashParts();
      });
    } else if (act === 'i-empty') {
      const n = (d.trash || []).length;
      if (!n) return;
      confirmSheet('清空回收站？' + n + ' 项会被彻底删除，不可恢复。',
        { title: '清空回收站', ok: '清空', danger: true }
      ).then(function (ok) {
        if (!ok) return;
        d.trash = [];
        trashView.sel = {};
        UI().save();
        UI().mount();
        renderTrashParts();
        UI().toast('回收站已清空');
      });
    }
  }, true);

  /* 覆盖层：盖在当前面板之上，不销毁它。
   * 表单里要弹东西（选图片、选分类）必须用它——直接 openSheet 会把表单 DOM 冲掉，
   * 于是"选完图片直接被弹回详情页"。
   */
  function openOverlay(html) {
    // 同样挂到 body，理由见 openPicker
    const host = document.body;
    if (!host) { UI().openSheet(html); return; }
    closeOverlay();
    const layer = document.createElement('div');
    layer.className = 'picker-layer';
    layer.id = 'picker-layer';
    layer.innerHTML = html;
    host.appendChild(layer);
  }

  function closeOverlay() {
    const el = document.getElementById('picker-layer');
    if (el) el.remove();
  }

  /* 看大图 */
  function openLightbox(src) {
    const box = document.createElement('div');
    box.className = 'lightbox';
    box.innerHTML = '<img src="' + src + '" alt="" />';
    box.addEventListener('click', function () { box.remove(); });
    document.body.appendChild(box);
  }

  function pickPhoto() {
    if (!window.QYV || !QYV.pickImage) { UI().toast('图片功能不可用'); return; }
    openOverlay('' +
      '<div class="picker-head"><b>添加图片</b>' +
        '<button class="btn plain" data-action="i-photo-cancel" style="padding:6px 14px">关闭</button></div>' +
      '<div class="picker-list">' +
        '<div class="row" data-action="i-photo-from" data-src="camera">' +
          '<div class="tl-dot">📷</div>' +
          '<div class="row-main"><div class="row-title">拍照</div>' +
            '<div class="row-sub">用系统相机拍一张</div></div>' +
          '<div class="row-side"><span class="chev">›</span></div></div>' +
        '<div class="row" data-action="i-photo-from" data-src="gallery">' +
          '<div class="tl-dot">🖼</div>' +
          '<div class="row-main"><div class="row-title">从相册选择</div>' +
            '<div class="row-sub">支持动图（GIF 会保留动画）</div></div>' +
          '<div class="row-side"><span class="chev">›</span></div></div>' +
      '</div>');
  }

  function takePhoto(source) {
    if (!window.QYV || !QYV.pickImage) { UI().toast('图片功能不可用'); return; }
    closeOverlay();
    QYV.pickImage(function (dataUrl, info) {
      if (!dataUrl) return;
      // 动图不重编码，所以体积可能很大，而本机存储总共只有 5MB 左右
      const bytes = info && info.bytes ? info.bytes
        : Math.round((dataUrl.length - dataUrl.indexOf(',')) * 0.75);
      const isGif = /^data:image\/gif/i.test(dataUrl);
      if (isGif && bytes > 1.5 * 1024 * 1024) {
        const mb = (bytes / 1024 / 1024).toFixed(1);
        confirmSheet('这张动图有 ' + mb + 'MB，会很快占满本机存储（上限约 5MB）。',
          { title: '动图偏大', ok: '保留动图', cancel: '只要静态图' }
        ).then(function (keep) {
          if (keep) { formPhoto = dataUrl; syncPhoto(); return; }
          QYV.staticFirstFrame(dataUrl, function (still) {
            formPhoto = still || dataUrl;
            syncPhoto();
          });
        });
        return;
      }
      formPhoto = dataUrl;
      syncPhoto();
    }, { maxSide: source === 'camera' ? 1280 : 1080, quality: 0.82, source: source });
  }

  /* ---------------- 动作路由 ---------------- */

  function handleAction(action, el) {
    if (action.indexOf('i-') !== 0) return false;
    const id = el.getAttribute('data-id');

    if (action === 'i-add') openForm(null);
    else if (action === 'i-edit') openForm(byId(id));
    else if (action === 'i-tl') { const it = byId(id); if (it) openTimeline(it); }
    else if (action === 'i-menu') { const it = byId(id); if (it) openItemMenu(it); }
    else if (action === 'i-long') { const it = byId(id); if (it) makeItemLongImage(it); }
    else if (action === 'i-remind') { const it = byId(id); if (it) openReminderSheet(it); }
    else if (action === 'i-remind-quick') {
      // 快捷时间：滚轮直接跳到该时刻
      const q = String(el.getAttribute('data-v') || '').split(':');
      const hEl = document.getElementById('r-wheel-h');
      const mEl = document.getElementById('r-wheel-m');
      if (hEl && mEl && q.length === 2) {
        hEl._whIdx = Math.max(0, Math.min(23, Number(q[0]) || 0));
        mEl._whIdx = Math.max(0, Math.min(59, Number(q[1]) || 0));
        if (hEl._whApply) hEl._whApply(true);
        if (mEl._whApply) mEl._whApply(true);
      }
    }
    else if (action === 'i-remind-save') {
      const it = byId(id);
      if (!it) return true;
      const h = Math.max(0, Math.min(23, wheelVal(document.getElementById('r-wheel-h'))));
      const m = Math.max(0, Math.min(59, wheelVal(document.getElementById('r-wheel-m'))));
      const alarmEl = document.getElementById('r-alarm');
      it.reminder = { on: true, hour: h, minute: m, alarm: !!(alarmEl && alarmEl.checked) };
      UI().save();
      pushItemReminders();
      UI().closeSheet();
      UI().mount();
      UI().toast('已开启每日提醒：' + h + ':' + pad2(m) + '「' + it.name + '」' +
        (it.reminder.alarm ? '（闹铃）' : ''));
    }
    else if (action === 'i-remind-off') {
      const it = byId(id);
      if (!it) return true;
      delete it.reminder;
      UI().save();
      pushItemReminders();
      UI().closeSheet();
      UI().mount();
      UI().toast('已关闭「' + it.name + '」的每日提醒');
    }
    else if (action === 'i-open') {
      // 记住列表位置，详情返回时还原（goItem 内部也会记）
      if (UI().rememberScroll) UI().rememberScroll();
      if (UI().goItem) UI().goItem(id);
      else { state.detailId = id; UI().mount(); }
    }
    else if (action === 'i-back') {
      // 从首页点进来的要回首页；从列表点进来的回列表。
      // 全部交给 backFromDetail 处理（它一定会把详情状态清干净）
      if (UI().backFromDetail) UI().backFromDetail();
      else { state.detailId = null; UI().mount(); }
    }
    else if (action === 'i-filter') {
      state.filter = el.getAttribute('data-k');
      const menu = document.querySelector('.seg-dd-menu');
      if (menu) menu.remove();   // 就地浮层：选完收起（mount 重渲染也会带走它）
      UI().mount();
    }
    else if (action === 'i-cat-more') {
      // 「⋯」就地浮层：只列被收纳的分类（能放下的已经在行里了）
      const existed = document.querySelector('.seg-dd-menu');
      if (existed) { existed.remove(); return; }
      if (!hiddenCats.length) return;
      const m = document.createElement('div');
      m.className = 'seg-dd-menu';
      m.innerHTML = hiddenCats.map(function (name) {
        return '<button type="button" class="' + (state.category === name ? 'active' : '') +
          '" data-action="i-cat" data-cat="' + esc(name) + '">' + esc(name) +
          (state.category === name ? ' ✓' : '') + '</button>';
      }).join('');
      el.parentNode.appendChild(m);   // .cat-row（position:relative）
    }
    else if (action === 'i-filter-dd') {
      // 就地展开的小浮层（锚在下拉按钮下方），再点一次或点外面收起
      const existed = document.querySelector('.seg-dd-menu');
      if (existed) { existed.remove(); return; }
      const dd = el.closest('.seg-dd');
      if (!dd) return;
      const cur = state.filter;
      const m = document.createElement('div');
      m.className = 'seg-dd-menu';
      m.innerHTML = [['active', '在用'], ['archived', '归档'], ['all', '全部']].map(function (x) {
        return '<button type="button" class="' + (cur === x[0] ? 'active' : '') +
          '" data-action="i-filter" data-k="' + x[0] + '">' + x[1] +
          (cur === x[0] ? ' ✓' : '') + '</button>';
      }).join('');
      dd.parentNode.appendChild(m);
    }
    else if (action === 'i-cat') { state.category = el.getAttribute('data-cat'); UI().mount(); }
    else if (action === 'i-close') { editingId = null; UI().closeSheet(); }
    else if (action === 'i-save') saveForm();
    else if (action === 'i-more') {
      const m = document.getElementById('i-more');
      if (m) {
        m.classList.toggle('open');
        el.classList.toggle('open', m.classList.contains('open'));
      }
    } else if (action === 'i-pick-open') {
      openPicker(el.getAttribute('data-k'), el.getAttribute('data-title'));
    } else if (action === 'i-pick') {
      applyPick(el.getAttribute('data-k'), el.getAttribute('data-v'));
    } else if (action === 'i-pick-close') {
      closePicker();
    } else if (action === 'i-date') {
      openDatePicker(el.getAttribute('data-target'));
    } else if (action === 'i-cal-pick') {
      if (calState) { calState.picked = el.getAttribute('data-v'); renderCal(); }
    } else if (action === 'i-cal-move') {
      if (calState) {
        const p = calState.view.split('-');
        const d2 = new Date(Number(p[0]), Number(p[1]) - 1 + Number(el.getAttribute('data-d')), 1);
        calState.view = d2.getFullYear() + '-' + pad2(d2.getMonth() + 1);
        renderCal();
      }
    } else if (action === 'i-cal-today') {
      if (calState) {
        calState.picked = QY.iso(QY.today());
        calState.view = calState.picked.slice(0, 7);
        renderCal();
      }
    } else if (action === 'i-cal-ok') {
      if (calState) {
        const inp = document.getElementById(calState.inputId);
        // 写回后派发 input 让全屏编辑页标脏（程序改值不会自动触发）
        if (inp) { inp.value = calState.picked; inp.dispatchEvent(new Event('input', { bubbles: true })); }
      }
      closeOverlay();
    } else if (action === 'i-cal-cancel') {
      closeOverlay();
    } else if (action === 'i-photo') {
      pickPhoto();
    } else if (action === 'i-photo-cancel') {
      closeOverlay();
    } else if (action === 'i-zoom') {
      const it = byId(id);
      if (it && it.photo) openLightbox(it.photo);
    } else if (action === 'i-photo-from') {
      takePhoto(el.getAttribute('data-src'));
    } else if (action === 'i-photo-clear') {
      formPhoto = null;
      syncPhoto();
    } else if (action === 'i-status') {
      changeStatus(id);
    } else if (action === 'i-status-set') {
      if (pendingStatusPick) { const f = pendingStatusPick; pendingStatusPick = null; f(el.getAttribute('data-v')); }
    } else if (action === 'i-archive') {
      // 详情页按钮 / 详情「归档」行：与列表右滑同一个逻辑
      const it0 = byId(id);
      if (it0) toggleArchive(it0);
    } else if (action === 'i-pin') {
      const it0 = byId(id);
      if (it0) {
        it0.pinned = !it0.pinned;
        UI().save();
        UI().mount();
        UI().toast(it0.pinned ? '已置顶' : '已取消置顶');
      }
    } else if (action === 'i-ev-add') {
      openEventSheet(id, null);
    } else if (action === 'i-ev-type') {
      const hid = document.getElementById('ev-type');
      if (hid) hid.value = el.getAttribute('data-v');
      document.querySelectorAll('#sheet-root .chips .chip').forEach(function (c) {
        c.classList.toggle('active', c.getAttribute('data-v') === hid.value);
      });
    } else if (action === 'i-ev-save') {
      saveEventSheet(id, el.getAttribute('data-ev'));
    } else if (action === 'i-ev-del') {
      deleteEvent(id, el.getAttribute('data-ev'));
    } else if (action === 'i-del') {
      deleteItem(id);
    } else if (action === 'i-cat-manage') {
      openCatManager('items');        // "我的"页"物品分类"行：只看物品分类
    } else if (action === 'i-cat-notes') {
      openCatManager('notes');        // "我的"页"随笔分类"行：只看随笔分类
    } else if (action === 'i-ncat-add') {
      QYDialog.text({ title: '新分类名称', placeholder: '例如：灵感', onOk: function (name) {
        if (!name) return;
        if (window.QYV && QYV.addCat) {
          const r = QYV.addCat(name);
          if (r) { openCatManager(); UI().toast('已新建「' + name + '」'); }
          else UI().toast('这个名字已经有了');
        }
      } });
    } else if (action === 'i-ncat-rename') {
      const oldName = el.getAttribute('data-name');
      QYDialog.text({ title: '改名', value: oldName, onOk: function (name) {
        if (!name || name === oldName) return;
        if (window.QYV && QYV.renameCat) {
          const r = QYV.renameCat(oldName, name);
          if (r) { openCatManager(); UI().toast('已改名「' + name + '」'); }
          else UI().toast('这个名字已经被用了');
        }
      } });
    } else if (action === 'i-ncat-del') {
      const name = el.getAttribute('data-name');
      QYDialog.confirm('删除随笔分类「' + name + '」？', { title: '删除分类', ok: '删除', danger: true })
        .then(function (ok) {
          if (!ok) return;
          if (window.QYV && QYV.removeCat) {
            QYV.removeCat(name);
            openCatManager();   // 不传 mode：停留在当前这块（随笔分类）里重绘
            UI().toast('已删除');
          }
        });
    } else if (action === 'i-cat-sort') {
      openCatSort();
    } else if (action === 'i-cat-sort-done') {
      // 回到「管理分类」，而不是关掉面板退回「我的」：
      // 排序面板是替换管理分类面板打开的，closeSheet 会把整层一起关掉。
      // 这里重新打开管理分类——它按当前数据渲染，所以能看到新顺序。
      openCatManager();
    } else if (action === 'i-trash') {
      openTrash();
    } else if (action === 'i-cat-new') {
      catEdit = '';
      renderCatSheet();
    } else if (action === 'i-cat-edit') {
      catEdit = el.getAttribute('data-name');
      renderCatSheet();
    } else if (action === 'i-cat-emoji') {
      const box = document.getElementById('cat-emoji');
      Array.prototype.forEach.call(box.children, function (b) { b.classList.remove('on'); });
      el.classList.add('on');
    } else if (action === 'i-cat-save') {
      saveCat();
    } else if (action === 'i-cat-del') {
      deleteCat();
    } else if (action === 'i-cat-cancel') {
      if (catEdit !== null) { catEdit = null; renderCatSheet(); }
      else UI().closeSheet();
    }
    return true;
  }

  function handleInput(e) {
    if (e.target.id !== 'i-search') return false;
    state.query = e.target.value;
    const list = document.getElementById('i-list');
    if (list) list.innerHTML = renderListInner();
    return true;
  }

  window.QYI = {
    renderList: renderList,
    renderDetail: renderDetail,
    renderDetailIfAny: function () { return state.detailId ? renderDetail(state.detailId) : null; },
    openDetail: function (id) { state.detailId = id; },
    hasDetail: function () { return !!state.detailId; },
    clearDetail: function () { state.detailId = null; },
    openForm: openForm,
    openCatManager: openCatManager,
    openTrash: openTrash,
    pushReminders: pushItemReminders,
    handleAction: handleAction,
    handleInput: handleInput,
    // 首页/重挂载后按实际宽度收纳分类行（app.js 的 mount 会调）
    layoutCats: layoutCats,
    // AI 动作也走它，保证时间线/开封联动和手动一致
    applyStatus: applyStatus,
    confirmSheet: confirmSheet
  };

  /* 拖动刚结束时，吃掉浏览器补发的 click（否则会点到遮罩/按钮上） */
  document.addEventListener('click', function (e) {
    if (!catJustDragged) return;
    e.stopPropagation();
    e.preventDefault();
  }, true);

  // 点覆盖层的暗色背景即关闭（点内容不会）
  document.addEventListener('click', function (e) {
    const l = document.getElementById('picker-layer');
    if (l && e.target === l) l.remove();
  }, true);

  /* ---------------- 通用浮层 API ----------------
   * 全 App 只有这一套：底部弹出的选择器、居中卡片的确认/输入/日期。
   * 之前每个模块各写各的（原生 select / window.prompt / window.confirm），
   * 结果样式不统一、安卓 WebView 里还会出现"点不动、位置错"的各种问题。
   */
  function mountLayer(html, center) {
    const old = document.getElementById('picker-layer');
    if (old) old.remove();
    const layer = document.createElement('div');
    layer.className = 'picker-layer' + (center ? ' center' : '');
    layer.id = 'picker-layer';
    layer.innerHTML = html;
    layer.addEventListener('click', function (e) {
      if (e.target === layer) layer.remove();       // 点暗背景关闭
    });
    document.body.appendChild(layer);
    return layer;
  }

  /* { title, options:[{v,t,e}], current, onPick } */
  function openChooser(opts) {
    opts = opts || {};
    const list = (opts.options || []).map(function (o) {
      return '<div class="picker-opt' + (o.v === opts.current ? ' on' : '') +
        '" data-choose="' + esc(o.v) + '">' +
        (o.e ? '<span class="pick-ic">' + (window.QYIcon ? QYIcon.forEmoji(o.e, 18) : esc(o.e)) + '</span>' : '') +
        '<span>' + esc(o.t) + '</span>' +
        (o.v === opts.current ? '<span class="tick">✓</span>' : '') + '</div>';
    }).join('');
    const layer = mountLayer(
      '<div class="picker-head"><b>' + esc(opts.title || '选择') + '</b>' +
        '<button class="btn plain" data-choose-close="1" style="padding:6px 14px">关闭</button></div>' +
      '<div class="picker-list">' + list + '</div>');
    layer.addEventListener('click', function (e) {
      const c = e.target.closest && e.target.closest('[data-choose]');
      if (c) {
        const v = c.getAttribute('data-choose');
        layer.remove();
        if (opts.onPick) opts.onPick(v);
        return;
      }
      if (e.target.closest && e.target.closest('[data-choose-close]')) layer.remove();
    });
  }

  /* 文本输入对话框：{ title, value, placeholder, onOk } */
  function textDialog(opts) {
    opts = opts || {};
    const layer = mountLayer(
      '<div class="picker-card">' +
        '<h3>' + esc(opts.title || '输入') + '</h3>' +
        '<input id="qy-text-input" class="input" value="' + esc(opts.value || '') +
          '" placeholder="' + esc(opts.placeholder || '') + '" />' +
        '<div class="sheet-actions" style="margin-top:14px">' +
          '<button class="btn plain" data-choose-close="1">取消</button>' +
          '<button class="btn primary" data-qy-text-ok="1">确定</button>' +
        '</div>' +
      '</div>', true);
    const inp = layer.querySelector('#qy-text-input');
    if (inp) { inp.focus(); inp.select(); }
    layer.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('[data-choose-close]')) { layer.remove(); return; }
      if (e.target.closest && e.target.closest('[data-qy-text-ok]')) {
        const v = inp ? inp.value : '';
        layer.remove();
        if (opts.onOk) opts.onOk(String(v).trim());
      }
    });
  }

  /* 供其它模块复用（随笔、助手等）
   * choose(选择器) / confirm(确认) / text(文本输入) / date(日期) */
  window.QYDialog = {
    confirm: confirmSheet,
    choose: openChooser,
    text: textDialog,
    date: openDatePicker,
    mount: mountLayer
  };

  // 用户手动动过"计入日均成本"开关后，切换分类不再覆盖它
  document.addEventListener('qy-costtouch', function () { formCostTouched = true; });

  // 启动时把每日提醒清单同步给原生壳一次（之后开/关/改时间会即时推）
  setTimeout(pushItemReminders, 1200);
})();
