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

  /* ---------------- 提示条 ---------------- */
  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2000);
  }

  /* ---------------- 图标 ---------------- */
  const I = {
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10.6 12 4.2l8 6.4V19a1.6 1.6 0 0 1-1.6 1.6H5.6A1.6 1.6 0 0 1 4 19z"/><path d="M9.6 20.6v-5.8h4.8v5.8"/></svg>',
    items: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.4 20 7.9v8.2L12 20.6 4 16.1V7.9z"/><path d="M4 7.9l8 4.5 8-4.5"/><path d="M12 12.4v8.2"/></svg>',
    collect: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6.6 3.6h10.8a1.6 1.6 0 0 1 1.6 1.6v15.2L12 16.2l-7 4.2V5.2a1.6 1.6 0 0 1 1.6-1.6z"/></svg>',
    energy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M13.2 2.8 5.6 13.4h5.2l-1 7.8 8-11.2h-5.4z"/></svg>',
    me: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8.4" r="3.6"/><path d="M4.9 20.2c1.4-3.6 4-5.4 7.1-5.4s5.7 1.8 7.1 5.4"/></svg>',
    search: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M16.5 16.5 21 21"/></svg>',
    plus: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>'
  };

  const TABS = [
    { id: 'home', label: '首页', icon: I.home },
    { id: 'items', label: '物品', icon: I.items },
    { id: 'collect', label: '收藏', icon: I.collect },
    { id: 'energy', label: '能源', icon: I.energy },
    { id: 'me', label: '我的', icon: I.me }
  ];

  /* ---------------- 通用组件 ---------------- */

  function tile(item, small) {
    // 有图片就用图片；没有就用中性底 + 名称首字（物品列表已不用 emoji 图标）
    if (item.photo) {
      return '<div class="tile ' + (small ? 'sm' : '') + '" style="background-image:url(' + item.photo +
        ');background-size:cover;background-position:center"></div>';
    }
    return '<div class="tile tile-plain ' + (small ? 'sm' : '') + '">' + esc(QY.thumbChar(item)) + '</div>';
  }

  function expiryPill(item) {
    const lv = QY.expiryLevel(item);
    if (lv == null) return '';
    const d = QY.daysLeft(item);
    if (lv === 0) return '<span class="pill red">已过期 ' + Math.abs(d) + ' 天</span>';
    if (lv === 1) return '<span class="pill red">剩 ' + d + ' 天</span>';
    if (lv === 2) return '<span class="pill orange">剩 ' + d + ' 天</span>';
    return '<span class="pill green">剩 ' + d + ' 天</span>';
  }

  function rowItem(item) {
    const p = QY.perDay(item, data);
    return '' +
      '<div class="row" data-action="detail" data-id="' + item.id + '">' +
        tile(item) +
        '<div class="row-main">' +
          '<div class="row-title">' + esc(item.name) + '</div>' +
          '<div class="row-sub">' + esc(QY.titleOf(item)) + ' · ' + QY.fmtDate(item.acquiredAt) + ' 获得' +
            (item.status !== '在用' ? ' · ' + esc(item.status) : '') + '</div>' +
        '</div>' +
        '<div class="row-side">' +
          '<div class="row-value">' + (p != null ? QY.fmtRate(p) + '<span class="per">/天</span>' : '—') + '</div>' +
          '<div class="row-note">' + (item.cost != null ? QY.fmtMoney(item.cost) : '价格未知') + '</div>' +
        '</div>' +
      '</div>';
  }

  function kv(k, v) {
    return '<div class="kv"><span class="k">' + esc(k) + '</span><span class="v">' + v + '</span></div>';
  }

  // 本地存储占用（两个 localStorage key 的字符数，≈ 字节数）
  function localBytes() {
    let n = 0;
    try {
      n = (localStorage.getItem('xctally.prototype.v1') || '').length +
          (localStorage.getItem('xctally.collect.v1') || '').length;
    } catch (err) { n = 0; }
    return n;
  }
  function humanBytes(n) {
    if (!n) return '0 KB';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  }

  // 页面标题栏：左侧大标题 + 副标题，右侧可挂一个圆形操作按钮
  function pageHead(title, sub, btn) {
    return '<div class="page-head">' +
      '<div>' +
        '<h1 class="screen-title">' + title + '</h1>' +
        '<p class="screen-sub">' + sub + '</p>' +
      '</div>' + (btn || '') +
    '</div>';
  }
  function iconBtn(action, label) {
    return '<button class="icon-btn" data-action="' + action + '" aria-label="' + label + '">+</button>';
  }

  /* ---------------- 首页 ---------------- */

  function viewHome() {
    const s = QY.summaries(data);
    const d = QY.today();
    const weekday = '日一二三四五六'[d.getDay()];
    const dateLabel = (d.getMonth() + 1) + '月' + d.getDate() + '日 · 星期' + weekday;

    const expiring = s.expiring.slice(0, 5).map(function (it) {
      return '' +
        '<div class="row" data-action="i-open" data-id="' + it.id + '">' +
          tile(it) +
          '<div class="row-main">' +
            '<div class="row-title">' + esc(it.name) + '</div>' +
            '<div class="row-sub">' + esc(QY.titleOf(it)) + ' · ' + QY.fmtDate(it.expiresAt) + ' 到期</div>' +
          '</div>' +
          '<div class="row-side">' + expiryPill(it) + '</div>' +
        '</div>';
    }).join('');

    const recent = s.recent.map(function (it) {
      const tracked = QY.tracksCost(it, data);
      const p = tracked ? QY.perDay(it, data) : null;
      return '' +
        '<div class="row" data-action="i-open" data-id="' + it.id + '">' +
          tile(it, true) +
          '<div class="row-main">' +
            '<div class="row-title">' + esc(it.name) + '</div>' +
            '<div class="row-sub">' + QY.fmtDate(it.acquiredAt) + ' · ' + esc(it.source || '—') + '</div>' +
          '</div>' +
          '<div class="row-side"><div class="row-value">' + QY.fmtMoney(it.cost) + '</div>' +
            (p != null ? '<div class="row-note">' + QY.fmtRate(p) + '/天</div>' : '') + '</div>' +
        '</div>';
    }).join('');

    const trendCls = s.energyTrend >= 0 ? 'trend-up' : 'trend-down';

    // 最近随笔：让首页同时反映"两本账"
    const notes = (window.QYV ? QYV.recent(3) : []).map(function (nt) {
      const tile = nt.img
        ? '<div class="tile" style="background-image:url(' + nt.img + ');background-size:cover;background-position:center"></div>'
        : '<div class="tile">' + nt.emoji + '</div>';
      return '<div class="row" data-action="goto-collect" data-id="' + nt.id + '">' + tile +
        '<div class="row-main">' +
          '<div class="row-title">' + esc(nt.title) + '</div>' +
          '<div class="row-sub">' + esc(nt.sub) + '</div>' +
        '</div>' +
        '<div class="row-side"><div class="row-value" style="font-size:13px;color:var(--label-3)">' +
          QY.fmtDate(nt.date).slice(5) + '</div></div>' +
      '</div>';
    }).join('');

    return '' +
      pageHead('今天', dateLabel + ' · 正在记录 ' + s.count + ' 样东西', iconBtn('add', '新增记录')) +

      '<div class="card hero">' +
        '<div class="hero-label">已经浪费掉的钱</div>' +
        '<div class="hero-value">' + QY.fmtMoney(s.wasted) + '</div>' +
        '<div class="hero-foot">' + s.wastedCount + ' 样东西过期未处置 · 累计投入的 ' +
          (s.totalSpend ? (s.wasted / s.totalSpend * 100).toFixed(1) : '0') + '%</div>' +
      '</div>' +

      '<div class="grid-2">' +
        '<div class="card">' +
          '<div class="mini-label">持有成本</div>' +
          '<div class="mini-value">' + QY.fmtRate(s.daily) + '<span class="unit">/天</span></div>' +
          '<div class="mini-foot">全部在用物品合计</div>' +
        '</div>' +
        '<div class="card">' +
          '<div class="mini-label">本月能源</div>' +
          '<div class="mini-value">' + QY.fmtMoney(s.energy) + '</div>' +
          '<div class="mini-foot ' + trendCls + '">较上月 ' + (s.energyTrend >= 0 ? '+' : '') +
            (s.energyTrend * 100).toFixed(0) + '%</div>' +
        '</div>' +
      '</div>' +

      '<div class="section">' +
        '<div class="section-head"><h2>临期提醒</h2><span>30 天内 ' + s.expiring.length + ' 件</span></div>' +
        '<div class="group">' + (expiring || '<div class="empty"><div class="emoji">🫧</div><p>暂时没有快到期的东西</p></div>') + '</div>' +
      '</div>' +

      '<div class="section">' +
        '<div class="section-head"><h2>最近记录</h2><span>共 ' + data.items.length + ' 条</span></div>' +
        '<div class="group">' + recent + '</div>' +
      '</div>' +

      (notes ? '<div class="section">' +
        '<div class="section-head"><h2>最近随笔</h2><span>共 ' +
          (window.QYV ? QYV.count() : 0) + ' 篇</span></div>' +
        '<div class="group">' + notes + '</div>' +
      '</div>' : '');
  }

  /* ---------------- 物品列表 ---------------- */

  function filteredItems() {
    const q = state.query.trim().toLowerCase();
    return data.items.filter(function (it) {
      if (state.category !== '全部' && it.category !== state.category) return false;
      if (!q) return true;
      return (it.name + ' ' + (it.sub || '') + ' ' + (it.location || '') + ' ' + (it.source || ''))
        .toLowerCase().indexOf(q) >= 0;
    }).sort(function (a, b) { return a.acquiredAt < b.acquiredAt ? 1 : -1; });
  }

  function renderItemList() {
    const list = filteredItems();
    if (!list.length) {
      return '<div class="empty"><div class="emoji">🔍</div><p>没有匹配的东西</p></div>';
    }
    return list.map(rowItem).join('');
  }

  function viewItems() {
    const active = data.items.filter(QY.isActive).length;
    const spend = data.items.reduce(function (s, it) { return s + (it.cost || 0); }, 0);
    const chips = ['全部'].concat(QY.CATEGORY_NAMES).map(function (c) {
      return '<button class="chip ' + (state.category === c ? 'active' : '') +
        '" data-action="chip" data-cat="' + c + '">' + c + '</button>';
    }).join('');

    return '' +
      pageHead('物品', active + ' 件在用 · 累计投入 ' + QY.fmtMoney(spend), iconBtn('add', '新增记录')) +
      '<div class="search">' + I.search +
        '<input id="search" placeholder="搜索名称、位置、来源" value="' + esc(state.query) + '" />' +
      '</div>' +
      '<div class="chips">' + chips + '</div>' +
      '<div class="group" id="item-list">' + renderItemList() + '</div>';
  }

  /* ---------------- 物品详情 ---------------- */

  // 日均成本衰减曲线：横轴按几何级数采样（1,2,3,5,8,13…），让 1/t 的衰减看得清
  function sparkline(item, held) {
    const cost = QY.costOf(item, data);
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
    const lastX = px(vals.length - 1).toFixed(1), lastY = py(vals[vals.length - 1]).toFixed(1);

    return '' +
      '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:88px;color:var(--blue);margin-top:6px">' +
        '<defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0" stop-color="currentColor" stop-opacity="0.26"/>' +
          '<stop offset="1" stop-color="currentColor" stop-opacity="0"/>' +
        '</linearGradient></defs>' +
        '<polygon points="' + pts + ' ' + (W - P) + ',' + (H - P) + ' ' + P + ',' + (H - P) + '" fill="url(#sg)"/>' +
        '<polyline points="' + pts + '" fill="none" stroke="currentColor" stroke-width="2.4" ' +
          'stroke-linecap="round" stroke-linejoin="round"/>' +
        '<circle cx="' + lastX + '" cy="' + lastY + '" r="4" fill="currentColor"/>' +
      '</svg>';
  }

  function viewDetail(item) {
    if (!item) return viewItems();
    const held = QY.heldDays(item);
    const per = QY.perDay(item, data);
    const total = QY.costOf(item, data);
    const extra = total - (item.cost || 0);

    const dl = QY.daysLeft(item);
    const detailRows = [
      kv('获得日期', QY.fmtDate(item.acquiredAt)),
      kv('来源', esc(item.source || '—')),
      kv('价格', item.cost != null ? QY.fmtMoney(item.cost) : '未知（获赠/无价）'),
      kv('数量', (item.qty || 1) + ' ' + (item.unit || '个') +
        (item.cost != null && (item.qty || 1) > 1 ? ' · 单价 ' + QY.fmtMoney(item.cost / item.qty) : '')),
      kv('日均成本', per != null ? QY.fmtRate(per) + ' / 天' : '—'),
      item.cost != null && (item.qty || 1) > 1 ? kv('单件日均', QY.fmtRate(per / item.qty) + ' / 天') : '',
      kv('状态', esc(item.status || '在用')),
      kv('存放位置', esc(item.location || '—')),
      item.expiresAt ? kv('到期日', QY.fmtDate(item.expiresAt) +
        (dl != null ? ' <span class="pill ' + (dl < 0 ? 'red' : dl <= 7 ? 'orange' : 'green') + '">' +
          (dl < 0 ? '已过期 ' + Math.abs(dl) + ' 天' : '剩 ' + dl + ' 天') + '</span>' : '')) : '',
      item.openedAt ? kv('开封日期', QY.fmtDate(item.openedAt)) : '',
      item.warrantyUntil ? kv('保修至', QY.fmtDate(item.warrantyUntil)) : ''
    ].join('');

    const events = QY.eventsOf(data, item.id);
    const timeline = events.map(function (e) {
      const t = QY.EVENT_TYPES[e.type] || { label: e.type, emoji: '•' };
      return '' +
        '<div class="tl-item">' +
          '<div class="tl-dot">' + t.emoji + '</div>' +
          '<div class="tl-body">' +
            '<div class="tl-title">' + t.label +
              (e.amount ? ' <span class="amount">' + QY.fmtMoney(e.amount) + '</span>' : '') + '</div>' +
            '<div class="tl-sub">' + QY.fmtDate(e.at) + (e.note ? ' · ' + esc(e.note) : '') + '</div>' +
          '</div>' +
        '</div>';
    }).join('');

    return '' +
      '<div class="navbar"><button class="back" data-action="back">‹ 物品</button></div>' +
      '<div class="detail-head">' +
        tile(item) +
        '<div>' +
          '<h1>' + esc(item.name) + '</h1>' +
          '<p>' + esc(QY.titleOf(item)) + (item.location ? ' · ' + esc(item.location) : '') + '</p>' +
        '</div>' +
      '</div>' +

      '<div class="card">' +
        '<div class="metrics">' +
          '<div class="metric"><div class="m-label">持有</div>' +
            '<div class="m-value">' + held + '<small>天</small></div></div>' +
          '<div class="metric"><div class="m-label">日均成本</div>' +
            '<div class="m-value">' + (per != null ? QY.fmtRate(per) : '—') + '</div></div>' +
          '<div class="metric"><div class="m-label">累计投入</div>' +
            '<div class="m-value">' + QY.fmtMoney(total) + '</div></div>' +
        '</div>' +
        sparkline(item, held) +
        '<div class="mini-foot" style="text-align:center;margin-top:6px">' +
          (extra > 0 ? '含维修/更换 ' + QY.fmtMoney(extra) + ' · ' : '') + '用得越久，每天越便宜</div>' +
      '</div>' +

      '<div class="section">' +
        '<div class="section-head"><h2>详情</h2></div>' +
        '<div class="group">' + detailRows + '</div>' +
      '</div>' +

      '<div class="section">' +
        '<div class="section-head"><h2>时间线</h2><span>' + events.length + ' 条</span></div>' +
        '<div class="group timeline">' + timeline + '</div>' +
      '</div>' +

      '<div class="section">' +
        '<div class="sheet-actions">' +
          '<button class="btn plain" data-action="add-event" data-id="' + item.id + '">记一笔支出</button>' +
          '<button class="btn plain" data-action="dispose" data-id="' + item.id + '">处置</button>' +
        '</div>' +
      '</div>';
  }

  /* ---------------- 能源 ---------------- */

  function meterCard(m) {
    const hist = m.history.concat([{
      m: m.current.m, usage: m.current.projected, cost: m.current.projectedCost, now: true
    }]);
    const max = Math.max.apply(null, hist.map(function (h) { return h.usage; })) || 1;
    const pct = Math.min(100, m.tier.used / m.tier.cap * 100);
    const cls = pct > 85 ? 'danger' : pct > 60 ? 'warn' : '';
    const trend = m.current.trend || 0;

    const bars = hist.map(function (h) {
      return '<div class="bar-col">' +
        '<div class="bar ' + (h.now ? 'now' : '') + '" style="height:' + (h.usage / max * 100).toFixed(1) + '%"></div>' +
        '<div class="bar-label">' + QY.fmtMonth(h.m) + '</div>' +
      '</div>';
    }).join('');

    return '' +
      '<div class="card">' +
        '<div style="display:flex;align-items:center;gap:12px">' +
          '<div class="tile" style="background:linear-gradient(150deg,#FFF1C9,#FFD666)">' + m.icon + '</div>' +
          '<div class="row-main">' +
            '<div class="row-title">' + m.name + '</div>' +
            '<div class="row-sub">' + m.account + ' · ' + m.priceLabel + '</div>' +
          '</div>' +
          '<span class="pill ' + (trend > 0.1 ? 'orange' : 'green') + '">' +
            (trend >= 0 ? '+' : '') + (trend * 100).toFixed(0) + '%</span>' +
        '</div>' +

        '<div class="metrics" style="grid-template-columns:1fr 1fr">' +
          '<div class="metric"><div class="m-label">本月已用</div>' +
            '<div class="m-value">' + QY.fmtNum(m.current.usage) + '<small>' + m.unit + '</small></div></div>' +
          '<div class="metric"><div class="m-label">本月费用</div>' +
            '<div class="m-value">' + QY.fmtMoney(m.current.cost) + '</div></div>' +
        '</div>' +

        '<div class="mini-foot" style="margin-top:14px">已进入 ' + m.tier.name + ' · ' + m.tier.range +
          ' · 单价 ¥' + m.tier.price + '/' + m.unit + '</div>' +
        '<div class="track ' + cls + '"><i style="width:' + pct.toFixed(1) + '%"></i></div>' +
        '<div class="mini-foot">阶梯进度 ' + QY.fmtNum(m.tier.used, 0) + ' / ' + m.tier.cap + ' ' + m.unit + '</div>' +

        '<div class="bars">' + bars + '</div>' +
        '<div class="mini-foot" style="text-align:center">近 12 个月用量（' + m.unit + '）· 最后一根为本月预测</div>' +

        '<button class="btn plain" style="width:100%;margin-top:16px" data-action="reading" data-id="' +
          m.id + '">抄表 / 记一笔</button>' +
      '</div>';
  }

  function viewEnergy() {
    const total = data.meters.reduce(function (s, m) { return s + m.current.cost; }, 0);
    const head = pageHead('能源', '本月合计 ' + QY.fmtMoney(total) + ' · ' + data.meters.length + ' 只表具',
      iconBtn('reading', '抄表'));
    if (!data.meters.length) {
      return head + '<div class="empty"><div class="emoji">⚡️</div><p>还没有表具，点右下角添加</p></div>';
    }
    return head + data.meters.map(meterCard).join('');
  }

  /* ---------------- 我的 ---------------- */

  function viewMe() {
    const s = QY.summaries(data);
    const backupHint = data.lastBackup ? '上次备份 ' + QY.fmtDate(data.lastBackup) : '数据只在这台设备上';
    const imgBytes = window.QYV ? QYV.imageBytes() : 0;
    const totalBytes = localBytes();
    const heavy = totalBytes > 4.5 * 1024 * 1024;
    const byCat = {};
    data.items.forEach(function (it) {
      if (it.cost != null) byCat[it.category] = (byCat[it.category] || 0) + it.cost;
    });
    const cats = Object.keys(byCat).sort(function (a, b) { return byCat[b] - byCat[a]; });
    const max = cats.length ? byCat[cats[0]] : 1;

    const catRows = cats.map(function (c) {
      const g = QY.catOf(c, data).g;
      const pct = (byCat[c] / max * 100).toFixed(1);
      return '' +
        '<div class="row static">' +
          '<div class="tile sm" style="background:linear-gradient(150deg,' + g[0] + ',' + g[1] + ')">' +
            QY.catOf(c, data).emoji + '</div>' +
          '<div class="row-main">' +
            '<div class="row-title">' + esc(c) + '</div>' +
            '<div class="track" style="margin-top:8px"><i style="width:' + pct + '%"></i></div>' +
          '</div>' +
          '<div class="row-side"><div class="row-value">' + QY.fmtMoney(byCat[c]) + '</div></div>' +
        '</div>';
    }).join('');

    return '' +
      pageHead('我的', '数据全部存在本机 · 无需注册、不联网') +

      '<div class="group">' +
        kv('在用物品', s.count + ' 件' + (s.archived ? '（另有 ' + s.archived + ' 件归档）' : '')) +
        kv('累计投入', QY.fmtMoney(s.totalSpend)) +
        kv('当前持有成本', QY.fmtRate(s.daily) + ' / 天') +
        kv('已浪费', QY.fmtMoney(s.wasted)) +
      '</div>' +

      '<div class="section">' +
        '<div class="section-head"><h2>分类投入</h2><span>按购买价合计</span></div>' +
        '<div class="group">' + (catRows || '<div class="empty"><p>还没有数据</p></div>') + '</div>' +
      '</div>' +

      '<div class="section">' +
        '<div class="section-head"><h2>物品分类</h2><span>可自定义</span></div>' +
        '<div class="group">' +
          '<div class="row" data-action="i-cat-manage">' +
            '<div class="tl-dot">🏷</div>' +
            '<div class="row-main"><div class="row-title">管理分类</div>' +
              '<div class="row-sub">新增 / 改名 / 删除，并设置默认是否算日均成本</div></div>' +
            '<div class="row-side"><span class="chev">›</span></div>' +
          '</div>' +
          '<div class="row" data-action="i-trash">' +
            '<div class="tl-dot">🗑</div>' +
            '<div class="row-main"><div class="row-title">回收站</div>' +
              '<div class="row-sub">删除的物品保留 ' + QY.TRASH_DAYS + ' 天，可恢复</div></div>' +
            '<div class="row-side"><span class="chev">›</span></div>' +
          '</div>' +
        '</div>' +
      '</div>' +

      // AI：没填 Key 时只露出"配置"一项，界面保持干净；填了才出现识图入口
      (function () {
        const aiReady = !!(window.QYO && QYO.ready());
        const cfg = window.QYA ? QYA.cfg() : null;
        return '<div class="section">' +
          '<div class="section-head"><h2>AI 助手</h2><span>' +
            (aiReady ? '已开启 · 需要联网' : '未配置') + '</span></div>' +
          '<div class="group">' +
            (aiReady ? '<div class="row" data-action="i-ocr">' +
              '<div class="tl-dot">📷</div>' +
              '<div class="row-main"><div class="row-title">从截图识别</div>' +
                '<div class="row-sub">淘宝/京东/拼多多订单截图、购物小票</div></div>' +
              '<div class="row-side"><span class="chev">›</span></div></div>' : '') +
            (aiReady ? '<div class="row" data-action="i-ball-show">' +
              '<div class="tl-dot">💬</div>' +
              '<div class="row-main"><div class="row-title">对话助手</div>' +
                '<div class="row-sub">右下角悬浮球，可拖动，位置会记住</div></div>' +
              '<div class="row-side"><span class="chev">›</span></div></div>' : '') +
            (aiReady ? (function () {
              const u = window.QYA ? QYA.usage() : null;
              return '<div class="row" data-action="i-ai-usage">' +
                '<div class="tl-dot">📊</div>' +
                '<div class="row-main"><div class="row-title">用量与额度</div>' +
                  '<div class="row-sub">' + (u && u.calls
                    ? u.calls + ' 次调用 · ' + u.total.toLocaleString() + ' token' +
                      (u.priced ? ' · 约 ¥' + u.cost.toFixed(3) : '')
                    : '还没有调用过') + '</div></div>' +
                '<div class="row-side"><span class="chev">›</span></div></div>';
            })() : '') +
            '<div class="row" data-action="i-ai-cfg">' +
              '<div class="tl-dot">🔑</div>' +
              '<div class="row-main"><div class="row-title">DeepSeek 配置</div>' +
                '<div class="row-sub">' + (cfg && cfg.key
                  ? '模型 ' + esc(cfg.model)
                  : '填 API Key 后开启识图与对话') + '</div></div>' +
              '<div class="row-side"><span class="chev">›</span></div>' +
            '</div>' +
          '</div>' +
        '</div>';
      })() +

      '<div class="section">' +
        '<div class="section-head"><h2>数据</h2><span>' + backupHint + '</span></div>' +
        (heavy ? '<div class="notice">本地占用已经接近浏览器上限（约 5MB）。建议先导出一份备份，' +
          '再删掉一些老随笔里的图片。</div>' : '') +
        '<div class="group">' +
          '<div class="row static">' +
            '<div class="tl-dot">💾</div>' +
            '<div class="row-main"><div class="row-title">本地占用</div>' +
              '<div class="row-sub">其中随笔图片 ' + humanBytes(imgBytes) + '</div></div>' +
            '<div class="row-side"><div class="row-value">' + humanBytes(totalBytes) + '</div></div>' +
          '</div>' +
          '<div class="row" data-action="b-export">' +
            '<div class="tl-dot">📤</div>' +
            '<div class="row-main"><div class="row-title">导出完整备份</div>' +
              '<div class="row-sub">物品 + 随笔 + 能源，换手机时导入即可</div></div>' +
            '<div class="row-side"><span class="pill blue">一个文件</span></div>' +
          '</div>' +
          '<div class="row" data-action="b-import">' +
            '<div class="tl-dot">📥</div>' +
            '<div class="row-main"><div class="row-title">从备份恢复</div>' +
              '<div class="row-sub">先对比再合并，冲突时保留当前设备的版本</div></div>' +
          '</div>' +
          '<div class="row" data-action="selftest">' +
            '<div class="tl-dot">🧪</div>' +
            '<div class="row-main"><div class="row-title">运行内置自检</div>' +
              '<div class="row-sub">54 项断言，用来排查"数据算错 / 图片坏了"</div></div>' +
          '</div>' +
          '<div class="row" data-action="toggle-theme">' +
            '<div class="tl-dot">🌗</div>' +
            '<div class="row-main"><div class="row-title">深色模式</div>' +
              '<div class="row-sub">跟随系统 / 手动切换</div></div>' +
          '</div>' +
          '<div class="row" data-action="reset">' +
            '<div class="tl-dot">♻️</div>' +
            '<div class="row-main"><div class="row-title">恢复示例数据</div>' +
              '<div class="row-sub">清空本机改动，回到初始状态</div></div>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  /* ---------------- 表单面板 ---------------- */

  function openSheet(html) {
    const root = $('#sheet-root');
    root.innerHTML = '<div class="scrim" data-action="close-sheet"></div>' + html;
    root.classList.add('open');
  }
  function closeSheet() {
    const root = $('#sheet-root');
    root.classList.remove('open');
    root.innerHTML = '';
  }

  function itemFormHTML() {
    const cats = QY.CATEGORY_NAMES.map(function (c) {
      return '<option>' + c + '</option>';
    }).join('');
    const srcs = QY.SOURCES.map(function (s) { return '<option>' + s + '</option>'; }).join('');
    const units = QY.UNITS.map(function (u) { return '<option>' + u + '</option>'; }).join('');
    return '' +
      '<div class="sheet">' +
        '<div class="grabber"></div>' +
        '<h3>新增记录</h3>' +
        '<p class="hint">默认只填 4 项就够，剩下的可以以后补</p>' +
        '<div class="field"><label>名称</label>' +
          '<input id="f-name" class="input" placeholder="例如：发卡" autocomplete="off" /></div>' +
        '<div class="field"><label>分类</label>' +
          '<select id="f-cat" class="select">' + cats + '</select></div>' +
        '<div class="field-row">' +
          '<div class="field"><label>价格</label>' +
            '<input id="f-cost" class="input" type="number" step="0.01" placeholder="9.90" /></div>' +
          '<div class="field"><label>数量</label>' +
            '<input id="f-qty" class="input" type="number" step="1" value="1" /></div>' +
        '</div>' +
        '<div class="field"><label>获得日期</label>' +
          '<input id="f-date" class="input" type="date" value="' + QY.iso(QY.today()) + '" /></div>' +

        '<button class="more-toggle" data-action="toggle-more">更多选项 ' + I.plus + '</button>' +

        '<div class="more" id="more-fields">' +
          '<div class="field-row">' +
            '<div class="field"><label>来源</label><select id="f-source" class="select">' + srcs + '</select></div>' +
            '<div class="field"><label>单位</label><select id="f-unit" class="select">' + units + '</select></div>' +
          '</div>' +
          '<div class="field"><label>二级分类</label>' +
            '<input id="f-sub" class="input" placeholder="装饰 / 生鲜 / 家电…" /></div>' +
          '<div class="field"><label>到期日（保质期 / 保修，可留空）</label>' +
            '<input id="f-exp" class="input" type="date" /></div>' +
          '<div class="field"><label>存放位置</label>' +
            '<input id="f-loc" class="input" placeholder="冰箱冷藏 / 卧室抽屉" /></div>' +
          '<div class="field"><label>备注</label>' +
            '<input id="f-note" class="input" placeholder="开封后 30 天失效…" /></div>' +
        '</div>' +

        '<div class="sheet-actions">' +
          '<button class="btn plain" data-action="close-sheet">取消</button>' +
          '<button class="btn primary" data-action="save-item">保存</button>' +
        '</div>' +
      '</div>';
  }

  function readingFormHTML(meterId) {
    const opts = data.meters.map(function (m) {
      return '<option value="' + m.id + '"' + (m.id === meterId ? ' selected' : '') + '>' +
        m.name + '（' + m.unit + '）</option>';
    }).join('');
    return '' +
      '<div class="sheet">' +
        '<div class="grabber"></div>' +
        '<h3>抄表 / 记一笔</h3>' +
        '<p class="hint">记下读数，阶梯价和趋势自动算</p>' +
        '<div class="field"><label>表具</label><select id="f-meter" class="select">' + opts + '</select></div>' +
        '<div class="field"><label>本月用量</label>' +
          '<input id="f-usage" class="input" type="number" step="0.1" placeholder="例如：236" /></div>' +
        '<div class="sheet-actions">' +
          '<button class="btn plain" data-action="close-sheet">取消</button>' +
          '<button class="btn primary" data-action="save-reading">保存</button>' +
        '</div>' +
      '</div>';
  }

  function saveItem() {
    const name = ($('#f-name').value || '').trim();
    if (!name) { toast('请先填写名称'); return; }
    const costRaw = $('#f-cost').value;
    const item = {
      id: QY.uid('it'),
      name: name,
      icon: '',
      category: $('#f-cat').value,
      sub: ($('#f-sub').value || '').trim(),
      acquiredAt: $('#f-date').value || QY.iso(QY.today()),
      source: $('#f-source').value,
      cost: costRaw === '' ? null : Number(costRaw),
      qty: Number($('#f-qty').value) || 1,
      unit: $('#f-unit').value,
      status: '在用',
      location: ($('#f-loc').value || '').trim(),
      expiresAt: $('#f-exp').value || null,
      openedAt: null,
      warrantyUntil: null,
      note: ($('#f-note').value || '').trim()
    };
    data.items.push(item);
    data.events.push({
      id: QY.uid('ev'), itemId: item.id, type: 'acquired',
      at: item.acquiredAt, amount: item.cost, note: item.source
    });
    save();
    closeSheet();
    mount();
    toast('已记录「' + name + '」');
  }

  function saveReading() {
    const id = $('#f-meter').value;
    const usage = Number($('#f-usage').value);
    if (!usage) { toast('请填写用量'); return; }
    let meter = null;
    data.meters.forEach(function (m) { if (m.id === id) meter = m; });
    if (!meter) return;
    const last = meter.history[meter.history.length - 1];
    meter.current.usage = usage;
    meter.current.cost = Number((usage * meter.tier.price).toFixed(2));
    meter.current.projected = usage;
    meter.current.projectedCost = meter.current.cost;
    meter.current.trend = last && last.cost ? (meter.current.cost - last.cost) / last.cost : 0;
    meter.tier.used = usage;
    save();
    closeSheet();
    mount();
    toast(meter.name + ' 已更新');
  }

  /* ---------------- 其他动作 ---------------- */

  function disposeItem(id) {
    const item = itemById(id);
    if (!item) return;
    item.status = '已处置';
    data.events.push({
      id: QY.uid('ev'), itemId: id, type: 'disposed',
      at: QY.iso(QY.today()), amount: null, note: '标记为已处置'
    });
    save();
    mount();
    toast('已把「' + item.name + '」标记为处置');
  }

  function addExtraEvent(id) {
    const item = itemById(id);
    if (!item) return;
    const input = window.prompt('这笔支出是多少钱？（例如配件、维修、耗材）', '39');
    if (input == null) return;
    const amount = Number(input);
    if (!amount) { toast('金额无效'); return; }
    data.events.push({
      id: QY.uid('ev'), itemId: id, type: 'repaired',
      at: QY.iso(QY.today()), amount: amount, note: '手动记录'
    });
    save();
    mount();
    toast('已记入 ' + QY.fmtMoney(amount) + '，日均成本已更新');
  }

  /* ---------------- 渲染 ---------------- */

  // 支持 URL 直达：index.html#items / #energy / #me / #detail=it_mac
  // 加 ?bare 隐藏左侧说明栏（截图 / 单屏预览）；?light / ?dark 强制主题
  function applyHash() {
    const raw = (location.hash || '').replace(/^#\/?/, '');
    const parts = raw.split('?');
    const h = parts[0];
    document.body.classList.toggle('bare', raw.indexOf('bare') >= 0);
    if (raw.indexOf('light') >= 0) document.documentElement.setAttribute('data-theme', 'light');
    else if (raw.indexOf('dark') >= 0) document.documentElement.setAttribute('data-theme', 'dark');
    if (!h) return;
    if (h.indexOf('detail=') === 0) {
      state.tab = 'items';
      state.detailId = null;
      if (window.QYI) QYI.openDetail(h.slice(7));
      else state.detailId = h.slice(7);
    } else if (h.indexOf('cdetail=') === 0) {
      state.tab = 'collect';
      state.detailId = null;
      if (window.QYV) QYV.openDetail(h.slice(8));
    } else if (['home', 'items', 'collect', 'energy', 'me'].indexOf(h) >= 0) {
      state.tab = h;
      state.detailId = null;
    }
  }

  function mount() {
    const view = $('#view');
    const QYV = window.QYV;
    const QYI = window.QYI;
    // 悬浮球跟着配置走：配了 Key 且没被关掉才出现
    if (window.QYO && QYO.syncBall) QYO.syncBall();
    let html;
    if (state.tab === 'collect' && QYV) {
      html = QYV.renderDetailIfAny() || QYV.renderList();
    } else if (state.tab === 'items' && QYI) {
      html = QYI.renderDetailIfAny() || QYI.renderList();
    } else if (state.detailId) {
      html = viewDetail(itemById(state.detailId));
    } else if (state.tab === 'home') {
      html = viewHome();
    } else if (state.tab === 'items') {
      html = viewItems();
    } else if (state.tab === 'energy') {
      html = viewEnergy();
    } else {
      html = viewMe();
    }
    view.innerHTML = html;

    const collectDetail = !!(window.QYV && QYV.hasDetail());
    const itemDetail = !!(window.QYI && QYI.hasDetail());
    $('#tabbar').innerHTML = TABS.map(function (t) {
      return '<button class="tab ' + (state.tab === t.id && !state.detailId && !collectDetail &&
        !(itemDetail && t.id === 'items') ? 'active' : '') +
        '" data-action="tab" data-tab="' + t.id + '">' + t.icon + '<span>' + t.label + '</span></button>';
    }).join('');

    const oldFab = document.querySelector('.fab');
    if (oldFab) oldFab.remove();

    view.scrollTop = 0;

    try {
      history.replaceState(null, '', state.detailId ? '#detail=' + state.detailId : '#' + state.tab);
    } catch (err) { /* file:// 下忽略 */ }

    pushReminders();
  }

  // 把到期清单交给原生壳去发系统通知（浏览器里是空操作）
  function pushReminders() {
    if (!window.QYPlatform || !window.QYPlatform.native) return;
    const list = [];
    data.items.forEach(function (it) {
      if (!QY.isActive(it)) return;
      const targets = [];
      if (it.expiresAt) targets.push({ date: it.expiresAt, kind: '到期' });
      if (it.warrantyUntil) targets.push({ date: it.warrantyUntil, kind: '保修到期' });
      targets.forEach(function (t) {
        const days = QY.dayDiff(QY.today(), QY.parseDate(t.date));
        if (days == null || days < 0) return;
        list.push({
          id: it.id + '_' + t.kind,
          title: it.name + ' · ' + t.kind,
          body: QY.fmtDate(t.date) + (days > 0 ? '（还有 ' + days + ' 天）' : '（就是今天）'),
          // 提前 3 天提醒；已经进入 3 天以内的，明天早上提醒一次
          remindAt: days > 3 ? QY.addDays(days - 3) : QY.addDays(1)
        });
      });
    });
    QYPlatform.scheduleReminders(list);
  }

  /* ---------------- 事件委托 ---------------- */

  document.addEventListener('click', function (e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.getAttribute('data-action');
    const id = el.getAttribute('data-id');

    // 收藏模块自己处理 c- 开头的动作
    if (window.QYV && QYV.handleAction(action, el)) return;
    // 备份模块处理 b- 开头的动作
    if (window.QYB && QYB.handleAction(action, el)) return;
    // 物品模块处理 i- 开头的动作
    if (window.QYI && QYI.handleAction(action, el)) return;

    if (action === 'tab') {
      state.tab = el.getAttribute('data-tab');
      state.detailId = null;
      if (window.QYV) QYV.clearDetail();
      if (window.QYI) QYI.clearDetail();
      mount();
    } else if (action === 'detail') {
      state.detailId = id;
      mount();
    } else if (action === 'back') {
      state.detailId = null;
      mount();
    } else if (action === 'chip') {
      state.category = el.getAttribute('data-cat');
      mount();
    } else if (action === 'add') {
      // 物品新增统一走 items.js 的表单
      if (window.QYI) QYI.openForm(null);
      else openSheet(itemFormHTML());
    } else if (action === 'reading') {
      openSheet(readingFormHTML(id || (data.meters[0] && data.meters[0].id)));
    } else if (action === 'close-sheet') {
      closeSheet();
    } else if (action === 'save-item') {
      saveItem();
    } else if (action === 'save-reading') {
      saveReading();
    } else if (action === 'toggle-more') {
      const m = $('#more-fields');
      if (m) {
        m.classList.toggle('open');
        el.innerHTML = (m.classList.contains('open') ? '收起选项' : '更多选项') + ' ' + I.plus;
      }
    } else if (action === 'goto-collect') {
      state.tab = 'collect';
      state.detailId = null;
      if (window.QYV) QYV.openDetail(id);
      mount();
    } else if (action === 'selftest') {
      // 真机上没有地址栏，用这一行进入自检报告
      location.hash = 'selftest';
      location.reload();
    } else if (action === 'toggle-theme') {
      const cur = document.documentElement.getAttribute('data-theme');
      document.documentElement.setAttribute('data-theme', cur === 'dark' ? 'light' : 'dark');
    } else if (action === 'reset') {
      data = QY.reset();
      if (window.QYV) QYV.reset();
      state.detailId = null;
      mount();
      toast('已恢复示例数据');
    } else if (action === 'dispose') {
      disposeItem(id);
    } else if (action === 'add-event') {
      addExtraEvent(id);
    }
  });

  document.addEventListener('input', function (e) {
    if (window.QYV && QYV.handleInput(e)) return;
    if (window.QYI && QYI.handleInput(e)) return;
    if (e.target.id === 'search') {
      state.query = e.target.value;
      const list = $('#item-list');
      if (list) list.innerHTML = renderItemList();
    }
  });

  document.addEventListener('change', function (e) {
    if (window.QYV && QYV.handleChange(e)) return;
    // 用户手动改过"计入日均成本"之后，切换分类就不再覆盖它
    if (e.target.id === 'f-costtrack' && window.QYI) {
      const ev = new CustomEvent('qy-costtouch');
      document.dispatchEvent(ev);
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeSheet();
  });

  /* ---------------- 给收藏模块的桥接接口 ---------------- */

  // 跳到某个物品的详情（首页的临期/最近列表也用它）
  function goItem(id) {
    state.tab = 'items';
    state.detailId = null;
    if (window.QYV) QYV.clearDetail();
    if (window.QYI) QYI.openDetail(id);
    mount();
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
    itemById: function (id) { return itemById(id); },
    data: function () { return data; },
    save: save
  };

  /* ---------------- 启动 ---------------- */

  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');

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
