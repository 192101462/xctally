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
    // 不计入日均成本的（食品/药品等）只显示价格，不显示"每天多少钱"
    if (QY.tracksCost(item, data())) {
      const p = QY.perDay(item, data());
      return '<div class="row-value">' + (p != null ? QY.fmtRate(p) + '<span class="per">/天</span>' : '—') + '</div>' +
        '<div class="row-note">' + (item.cost != null ? QY.fmtMoney(item.cost) : '价格未知') + '</div>';
    }
    return '<div class="row-value" style="font-size:14px">' +
      (item.cost != null ? QY.fmtMoney(item.cost) : '—') + '</div>' +
      '<div class="row-note">' + (QY.isArchived(item) ? esc(item.status) : '') + '</div>';
  }

  function rowItem(item) {
    const bits = [item.category];
    if (item.sub) bits.push(item.sub);
    bits.push(QY.fmtDate(item.acquiredAt) + ' 获得');
    if (item.location) bits.push(item.location);
    return '' +
      '<div class="row" data-action="i-open" data-id="' + item.id + '">' +
        thumb(item) +
        '<div class="row-main">' +
          '<div class="row-title">' + esc(item.name) + '</div>' +
          '<div class="row-sub">' + esc(bits.join(' · ')) + '</div>' +
        '</div>' +
        '<div class="row-side">' + sideOf(item) + '</div>' +
      '</div>';
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
    }).sort(function (a, b) { return a.acquiredAt < b.acquiredAt ? 1 : -1; });
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

    const chips = ['全部'].concat(QY.catList(d).map(function (c) { return c.name; })).map(function (c) {
      return '<button class="chip ' + (state.category === c ? 'active' : '') +
        '" data-action="i-cat" data-cat="' + esc(c) + '">' + esc(c) + '</button>';
    }).join('');

    return '' +
      UI().pageHead('物品', s.count + ' 件在用 · 累计投入 ' + QY.fmtMoney(s.totalSpend),
        UI().iconBtn('i-add', '新增')) +
      '<div class="segmented" style="margin-bottom:14px">' + seg + '</div>' +
      '<div class="search">' + UI().I.search +
        '<input id="i-search" placeholder="搜索名称、位置、来源" value="' + esc(state.query) + '" />' +
      '</div>' +
      '<div class="chips">' + chips + '</div>' +
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
      ? '<div class="hero-cover" style="background-image:url(' + item.photo + ');background-size:cover;background-position:center"></div>'
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
      kv('状态', '<span class="pill ' + (QY.isArchived(item) ? 'gray' : 'green') + '">' + esc(item.status) + '</span>'),
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
      return '<div class="tl-item"><div class="tl-dot">' + t.emoji + '</div>' +
        '<div class="tl-body"><div class="tl-title">' + t.label +
          (e.amount ? ' <span class="amount">' + QY.fmtMoney(e.amount) + '</span>' : '') + '</div>' +
        '<div class="tl-sub">' + QY.fmtDate(e.at) + (e.note ? ' · ' + esc(e.note) : '') + '</div></div></div>';
    }).join('');

    return '' +
      '<div class="navbar"><button class="back" data-action="i-back">‹ 物品</button></div>' +
      hero +
      '<div style="padding:18px 4px 0">' +
        '<h1 style="margin:0;font-size:25px;font-weight:700;letter-spacing:-0.025em">' + esc(item.name) + '</h1>' +
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
      '<div class="section"><div class="section-head"><h2>时间线</h2><span>' + events.length + ' 条</span></div>' +
        '<div class="group timeline">' + timeline + '</div></div>' +
      '<div class="section"><div class="sheet-actions" style="flex-wrap:wrap">' +
        '<button class="btn primary" data-action="i-edit" data-id="' + item.id + '">编辑</button>' +
        '<button class="btn plain" data-action="i-status" data-id="' + item.id + '">改状态</button>' +
        '<button class="btn plain" data-action="i-del" data-id="' + item.id + '" style="color:var(--red)">删除</button>' +
      '</div></div>';
  }

  /* ---------------- 通用选择器（替代原生 select） ----------------
   * 覆盖在当前表单面板之上，所以表单的 DOM 不会被销毁，输入的内容不会丢。
   */
  function pickerOptionsFor(key) {
    const d = data();
    if (key === 'category') return QY.catList(d).map(function (c) { return { v: c.name, t: c.name, e: c.emoji }; });
    if (key === 'source') return QY.SOURCES.map(function (s) { return { v: s, t: s }; });
    if (key === 'unit') return QY.UNITS.map(function (s) { return { v: s, t: s }; });
    if (key === 'status') return QY.STATUSES.map(function (s) {
      return { v: s, t: s + (QY.isArchived({ status: s }) ? '（归档）' : '') };
    });
    return [];
  }

  function openPicker(key, title) {
    const sheet = document.querySelector('#sheet-root .sheet');
    if (!sheet) return;
    const cur = (document.getElementById('f-' + key) || {}).value;
    const opts = pickerOptionsFor(key).map(function (o) {
      return '<div class="picker-opt ' + (o.v === cur ? 'on' : '') + '" data-action="i-pick" data-k="' + key +
        '" data-v="' + esc(o.v) + '">' + (o.e ? '<span style="font-size:17px">' + o.e + '</span>' : '') +
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
    if (input) input.value = value;
    if (label) label.textContent = value;
    // 分类变了，如果用户还没手动改过"计入日均成本"，就跟着分类默认值走
    if (key === 'category' && !formCostTouched) {
      const cb = document.getElementById('f-costtrack');
      if (cb) cb.checked = QY.catOf(value, data()).costTrack !== false;
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

  function formHTML(item) {
    const d = data();
    editingId = item ? item.id : null;
    formPhoto = item ? (item.photo || null) : null;
    formCostTouched = !!item && typeof item.costTrack === 'boolean';

    const e = item || {
      name: '', category: (QY.catList(d)[0] || {}).name || '其他', sub: '', acquiredAt: QY.iso(QY.today()),
      source: '商店购买', cost: null, qty: 1, unit: '个', status: '在用', location: '',
      expiresAt: null, openedAt: null, warrantyUntil: null, note: '', photo: null
    };
    const costOn = item
      ? QY.tracksCost(item, d)
      : QY.catOf(e.category, d).costTrack !== false;

    return '' +
      '<div class="sheet">' +
        '<div class="grabber"></div>' +
        '<h3>' + (item ? '编辑物品' : '新增物品') + '</h3>' +
        '<p class="hint">' + (item ? '改完点保存，状态和时间线都保留' : '名称、分类、价格、日期四项就够') + '</p>' +

        '<div class="field"><label>名称</label>' +
          '<input id="f-name" class="input" placeholder="例如：发卡" value="' + esc(e.name) + '" autocomplete="off" /></div>' +

        pickerField('category', '分类', e.category) +

        '<div class="field-row">' +
          '<div class="field"><label>价格</label>' +
            '<input id="f-cost" class="input" type="number" step="0.01" placeholder="9.90" value="' +
              (e.cost != null ? e.cost : '') + '" /></div>' +
          '<div class="field"><label>数量</label>' +
            '<input id="f-qty" class="input" type="number" step="1" value="' + (e.qty || 1) + '" /></div>' +
        '</div>' +

        '<div class="field"><label>获得日期</label>' +
          '<input id="f-date" class="input" type="date" value="' + e.acquiredAt + '" /></div>' +

        '<label class="check-row"><input type="checkbox" id="f-costtrack"' + (costOn ? ' checked' : '') + ' />' +
          '<span>计入日均成本</span><b>食品/药品这类消耗品通常不需要</b></label>' +

        '<div class="field"><label>图片（可选）</label>' +
          '<div class="photo-row">' +
            '<div class="photo-thumb' + (formPhoto ? '' : ' empty') + '" id="f-photo"' +
              (formPhoto ? ' style="background-image:url(' + formPhoto + ')"' : '') + '>' +
              (formPhoto ? '' : '＋') + '</div>' +
            '<div class="photo-actions">' +
              '<button type="button" class="btn plain" data-action="i-photo">选择图片</button>' +
              '<button type="button" class="btn plain" data-action="i-photo-clear">移除</button>' +
            '</div>' +
          '</div></div>' +

        '<button class="more-toggle" data-action="i-more">更多选项 ＋</button>' +
        '<div class="more" id="i-more">' +
          '<div class="field-row">' +
            pickerField('source', '来源', e.source) +
            pickerField('unit', '单位', e.unit) +
          '</div>' +
          pickerField('status', '状态', e.status) +
          '<div class="field"><label>二级分类</label>' +
            '<input id="f-sub" class="input" placeholder="装饰 / 生鲜 / 家电…" value="' + esc(e.sub || '') + '" /></div>' +
          '<div class="field"><label>到期日（保质期 / 保修，可留空）</label>' +
            '<input id="f-exp" class="input" type="date" value="' + (e.expiresAt || '') + '" /></div>' +
          '<div class="field"><label>存放位置</label>' +
            '<input id="f-loc" class="input" placeholder="卧室抽屉" value="' + esc(e.location || '') + '" /></div>' +
          '<div class="field"><label>备注</label>' +
            '<input id="f-note" class="input" value="' + esc(e.note || '') + '" /></div>' +
        '</div>' +

        '<div class="sheet-actions">' +
          '<button class="btn plain" data-action="i-close">取消</button>' +
          '<button class="btn primary" data-action="i-save">' + (item ? '保存' : '添加') + '</button>' +
        '</div>' +
      '</div>';
  }

  function openForm(item) {
    UI().openSheet(formHTML(item || null));
    if (item) {
      // 编辑时默认展开"更多"，让用户看到全部字段
      const more = document.getElementById('i-more');
      const btn = document.querySelector('[data-action="i-more"]');
      if (more) { more.classList.add('open'); }
      if (btn) btn.innerHTML = '收起选项 ＋';
    }
  }

  function syncPhoto() {
    const box = document.getElementById('f-photo');
    if (!box) return;
    if (formPhoto) {
      box.classList.remove('empty');
      box.style.backgroundImage = 'url(' + formPhoto + ')';
      box.textContent = '';
    } else {
      box.classList.add('empty');
      box.style.backgroundImage = '';
      box.textContent = '＋';
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
      note: (document.getElementById('f-note').value || '').trim(),
      photo: formPhoto,
      costTrack: document.getElementById('f-costtrack').checked
    };

    if (editingId) {
      const it = byId(editingId);
      if (it) Object.keys(fields).forEach(function (k) { it[k] = fields[k]; });
      UI().save();
      UI().closeSheet();
      state.detailId = editingId;
      editingId = null;
      UI().mount();
      UI().toast('已保存');
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

  function openCatManager() {
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
      const emojis = ['📦', '🥛', '💊', '🧺', '🧣', '💻', '⚡️', '🎀', '🍞', '🧴', '🪥', '🧸', '📚', '🔧', '🪴']
        .map(function (em) {
          return '<button type="button" class="emoji-opt ' + (em === c.emoji ? 'on' : '') +
            '" data-action="i-cat-emoji" data-em="' + em + '">' + em + '</button>';
        }).join('');

      UI().openSheet('' +
        '<div class="sheet"><div class="grabber"></div>' +
          '<h3>' + (isNew ? '新增分类' : '编辑分类') + '</h3>' +
          '<div class="field"><label>名称</label>' +
            '<input id="cat-name" class="input" value="' + esc(isNew ? '' : catEdit) + '" placeholder="例如：文具" /></div>' +
          '<div class="field"><label>图标（仅用于选择器，列表里不再显示图标）</label>' +
            '<div class="emoji-row" id="cat-emoji">' + emojis + '</div></div>' +
          '<label class="check-row"><input type="checkbox" id="cat-track"' + (c.costTrack !== false ? ' checked' : '') + ' />' +
            '<span>默认计入日均成本</span><b>该分类下新物品的默认值</b></label>' +
          (used ? '<div class="notice">有 ' + used + ' 件物品在用这个分类</div>' : '') +
          '<div class="sheet-actions">' +
            (isNew ? '' : '<button class="btn plain" data-action="i-cat-del" style="color:var(--red)">删除</button>') +
            '<button class="btn plain" data-action="i-cat-cancel">取消</button>' +
            '<button class="btn primary" data-action="i-cat-save">保存</button>' +
          '</div>' +
        '</div>');
      return;
    }

    const rows = cats.map(function (c) {
      const n = d.items.filter(function (i) { return i.category === c.name; }).length;
      return '<div class="row" data-action="i-cat-edit" data-name="' + esc(c.name) + '">' +
        '<div class="tile sm" style="background:linear-gradient(150deg,' + c.g[0] + ',' + c.g[1] + ')">' + c.emoji + '</div>' +
        '<div class="row-main"><div class="row-title">' + esc(c.name) + '</div>' +
          '<div class="row-sub">' + n + ' 件 · ' + (c.costTrack !== false ? '计入日均成本' : '不计入日均成本') + '</div></div>' +
        '<div class="row-side"><span class="chev">›</span></div></div>';
    }).join('');

    UI().openSheet('' +
      '<div class="sheet"><div class="grabber"></div>' +
        '<h3>物品分类</h3>' +
        '<p class="hint">新增、改名、删除，或者调整某个分类默认要不要算日均成本</p>' +
        '<div class="group">' + rows +
          '<div class="row" data-action="i-cat-new">' +
            '<div class="tl-dot">＋</div>' +
            '<div class="row-main"><div class="row-title">新增分类</div></div></div>' +
        '</div>' +
        '<div class="sheet-actions" style="margin-top:14px">' +
          '<button class="btn plain" data-action="i-cat-cancel">完成</button>' +
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

    if (isNew) {
      if (QY.catList(d).some(function (c) { return c.name === name; })) { UI().toast('已经有这个分类了'); return; }
      const style = QY.nextCatStyle(d);
      d.itemCats.push({ name: name, emoji: emoji, g: style.g.slice(), costTrack: track });
    } else {
      const c = QY.catOf(catEdit, d);
      const renamed = name !== catEdit;
      if (renamed && QY.catList(d).some(function (x) { return x.name === name; })) {
        UI().toast('已经有这个分类了'); return;
      }
      c.emoji = emoji;
      c.costTrack = track;
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
    if (!window.confirm(used
      ? '有 ' + used + ' 件物品在用「' + name + '」，删除后它们会变成「其他」。确定吗？'
      : '删除分类「' + name + '」？')) return;
    d.itemCats = QY.catList(d).filter(function (c) { return c.name !== name; });
    if (!d.itemCats.length) d.itemCats = QY.DEFAULT_CATS.map(function (c) { return { name: c.name, emoji: c.emoji, g: c.g.slice(), costTrack: c.costTrack }; });
    d.items.forEach(function (i) { if (i.category === name) i.category = '其他'; });
    UI().save();
    catEdit = null;
    renderCatSheet();
    UI().mount();
    UI().toast('分类已删除');
  }

  /* ---------------- 其它动作 ---------------- */

  function changeStatus(id) {
    const item = byId(id);
    if (!item) return;
    const sheet = document.querySelector('#sheet-root .sheet');
    const cur = item.status;
    const onPick = function (v) {
      item.status = v;
      UI().save();
      UI().closeSheet();
      UI().mount();
      UI().toast(QY.isArchived(item) ? '已移入归档，随时可以改回来' : '状态已改为 ' + v);
    };
    UI().openSheet('' +
      '<div class="sheet"><div class="grabber"></div>' +
        '<h3>改状态</h3>' +
        '<p class="hint">已用完 / 已处置 会移入归档，不是删除，随时能改回来</p>' +
        '<div class="group">' + QY.STATUSES.map(function (s) {
          return '<div class="picker-opt ' + (s === cur ? 'on' : '') + '" data-action="i-status-set" data-v="' + s + '">' +
            '<span>' + s + (QY.isArchived({ status: s }) ? '（归档）' : '') + '</span>' +
            (s === cur ? '<span class="tick">✓</span>' : '') + '</div>';
        }).join('') + '</div>' +
        '<div class="sheet-actions" style="margin-top:14px">' +
          '<button class="btn plain" data-action="i-close">取消</button></div>' +
      '</div>');
    pendingStatusPick = onPick;
  }
  let pendingStatusPick = null;

  function deleteItem(id) {
    const d = data();
    const item = byId(id);
    if (!item) return;
    if (!window.confirm('删除「' + item.name + '」？物品和它的时间线都会一起删掉，不能恢复。')) return;
    d.items = d.items.filter(function (i) { return i.id !== id; });
    d.events = d.events.filter(function (e) { return e.itemId !== id; });
    UI().save();
    state.detailId = null;
    UI().mount();
    UI().toast('已删除');
  }

  function pickPhoto() {
    if (!window.QYV || !QYV.pickImage) { UI().toast('图片功能不可用'); return; }
    QYV.pickImage(function (dataUrl) {
      if (!dataUrl) return;
      formPhoto = dataUrl;
      syncPhoto();
    }, { maxSide: 1080, quality: 0.82 });
  }

  /* ---------------- 动作路由 ---------------- */

  function handleAction(action, el) {
    if (action.indexOf('i-') !== 0) return false;
    const id = el.getAttribute('data-id');

    if (action === 'i-add') openForm(null);
    else if (action === 'i-edit') openForm(byId(id));
    else if (action === 'i-open') {
      if (UI().goItem) UI().goItem(id);
      else { state.detailId = id; UI().mount(); }
    }
    else if (action === 'i-back') { state.detailId = null; UI().mount(); }
    else if (action === 'i-filter') { state.filter = el.getAttribute('data-k'); UI().mount(); }
    else if (action === 'i-cat') { state.category = el.getAttribute('data-cat'); UI().mount(); }
    else if (action === 'i-close') { editingId = null; UI().closeSheet(); }
    else if (action === 'i-save') saveForm();
    else if (action === 'i-more') {
      const m = document.getElementById('i-more');
      if (m) {
        m.classList.toggle('open');
        el.innerHTML = (m.classList.contains('open') ? '收起选项' : '更多选项') + ' ＋';
      }
    } else if (action === 'i-pick-open') {
      openPicker(el.getAttribute('data-k'), el.getAttribute('data-title'));
    } else if (action === 'i-pick') {
      applyPick(el.getAttribute('data-k'), el.getAttribute('data-v'));
    } else if (action === 'i-pick-close') {
      closePicker();
    } else if (action === 'i-photo') {
      pickPhoto();
    } else if (action === 'i-photo-clear') {
      formPhoto = null;
      syncPhoto();
    } else if (action === 'i-status') {
      changeStatus(id);
    } else if (action === 'i-status-set') {
      if (pendingStatusPick) { const f = pendingStatusPick; pendingStatusPick = null; f(el.getAttribute('data-v')); }
    } else if (action === 'i-del') {
      deleteItem(id);
    } else if (action === 'i-cat-manage') {
      openCatManager();
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
    handleAction: handleAction,
    handleInput: handleInput
  };

  // 用户手动动过"计入日均成本"开关后，切换分类不再覆盖它
  document.addEventListener('qy-costtouch', function () { formCostTouched = true; });
})();
