/* xctally · 收藏模块（统一条目 + 插件 + 图文混排正文）
 * ---------------------------------------------------------------
 * 设计：
 *   1. 收藏只有一种条目，不再分"日记/零食/影视/游玩"
 *      差异靠「插件」表达：评分 / 价格 / 定位 / 链接 / 心情，想加就加，不加也成立
 *   2. 正文叫「随笔正文」，支持在文字中间穿插图片与动图（知乎式）
 *      内容以受限 HTML 存储：只允许 p / br / strong / em / img
 *   3. 分类完全自定义，类型不再决定字段
 *   4. 数据独立存储（xctally.collect.v1），备份时由 backup.js 统一打包
 * ---------------------------------------------------------------
 */
(function () {
  'use strict';

  const QY = window.QY;
  const KEY = 'xctally.collect.v1';
  const FONT = '"PingFang SC","Microsoft YaHei","Hiragino Sans GB",sans-serif';

  function UI() { return window.QYUI; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------------- 插件注册表 ----------------
   * 这是整个模块唯一需要扩展的地方：以后想加"时长""车牌""地址"等，
   * 在 PLUGINS 里加一条 + 在 pluginField / pluginView 里补两个渲染分支即可。
   */

  const PLUGINS = {
    rating: { name: '评分', icon: '⭐️', hint: '1–5 星' },
    price: { name: '价格', icon: '💰', hint: '花了多少钱' },
    place: { name: '定位', icon: '📍', hint: '在哪儿' },
    link: { name: '链接', icon: '🔗', hint: '相关网址' },
    mood: { name: '心情', icon: '🌤', hint: '当时的心情' }
  };
  const PLUGIN_KEYS = ['rating', 'price', 'place', 'link', 'mood'];
  const MOODS = ['开心', '平静', '疲惫', '兴奋', '低落', '满足'];

  const state = { detailId: null, cat: '全部', query: '' };

  /* ---------------- 种子数据 ---------------- */

  // 用 canvas 现场生成一张占位图（避免依赖外部图片文件，也保证长图导出不被污染）
  function ph(w, h, c1, c2, emoji) {
    try {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d');
      const grad = g.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, c1);
      grad.addColorStop(1, c2);
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
      g.font = Math.round(h * 0.4) + 'px ' + FONT;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(emoji, w / 2, h / 2);
      return c.toDataURL('image/png');
    } catch (err) {
      return '';
    }
  }

  function seed() {
    const D = QY.addDays;
    const imgCoffee = ph(640, 420, '#F7E3C8', '#D9A46A', '☕️');
    const imgBean = ph(640, 360, '#E8DCCB', '#B99B76', '🫘');
    const imgCookie = ph(640, 420, '#FFE3EA', '#F2A6BC', '🍪');
    const imgDrama = ph(640, 420, '#DCE4FF', '#93A6F0', '📺');
    const imgLake = ph(640, 420, '#D6F0DE', '#7FCBA6', '🚲');

    return {
      version: 2,
      cats: [
        { name: '生活', emoji: '🌿' },
        { name: '吃吃喝喝', emoji: '🍪' },
        { name: '看过的', emoji: '🎬' },
        { name: '出去玩', emoji: '🚲' },
        { name: '灵感', emoji: '💡' }
      ],
      entries: [
        {
          id: 'c_diary1',
          title: '第一次自己做手冲',
          cat: '生活',
          date: D(-3),
          tags: ['咖啡', '日常'],
          plugins: [{ k: 'mood', v: '平静' }, { k: 'place', v: { name: '家里厨房', lat: null, lng: null } }],
          bodyHtml:
            '<p>水温 92 度，粉水比 1:15，闷蒸 30 秒。第一杯明显偏酸。</p>' +
            '<img src="' + imgCoffee + '" alt="第一杯">' +
            '<p>第二杯把水温降到 90 度、研磨调粗一点，甜感一下就出来了。原来参数不是玄学，是真的能尝出来的差别。</p>' +
            '<img src="' + imgBean + '" alt="豆子">' +
            '<p>豆子是上周在巷子里那家店买的耶加雪菲，柑橘味很干净。下次想试试 1:16。</p>'
        },
        {
          id: 'c_snack1',
          title: '海盐芝士饼干',
          cat: '吃吃喝喝',
          date: D(-5),
          tags: ['饼干', '会回购'],
          plugins: [{ k: 'rating', v: 4 }, { k: 'price', v: 12.9 }],
          bodyHtml:
            '<p>咸甜平衡得刚好，芝士味很浓但不腻人。饼干本身偏厚实，咬下去有存在感。</p>' +
            '<img src="' + imgCookie + '" alt="饼干">' +
            '<p>缺点是一包只有 8 片，性价比一般。<strong>会回购。</strong></p>'
        },
        {
          id: 'c_media1',
          title: '漫长的季节',
          cat: '看过的',
          date: D(-20),
          tags: ['国产剧', '五星'],
          plugins: [{ k: 'rating', v: 5 }, { k: 'link', v: 'https://movie.douban.com/' }],
          bodyHtml:
            '<img src="' + imgDrama + '" alt="剧照">' +
            '<p>节奏慢，但每一集都在往回收线。最后那场雪里的一句「往前看，别回头」，把前面所有的憋闷都兑现了。</p>' +
            '<p>范伟演得让人心疼。</p>'
        },
        {
          id: 'c_place1',
          title: '东湖绿道骑行',
          cat: '出去玩',
          date: D(-8),
          tags: ['骑行', '日落'],
          plugins: [
            { k: 'rating', v: 5 },
            { k: 'price', v: 0 },
            { k: 'place', v: { name: '武汉 · 东湖绿道', lat: 30.5606, lng: 114.3641 } }
          ],
          bodyHtml:
            '<p>下午四点出发，骑了 12 公里。湖边风很大，太阳落到树后面的时候整条路都是金色的。</p>' +
            '<img src="' + imgLake + '" alt="湖边">' +
            '<p>建议从磨山那边进，人会少一点。</p>'
        },
        {
          id: 'c_idea1',
          title: '关于这个 App 的一点想法',
          cat: '灵感',
          date: D(-9),
          tags: ['产品', 'xctally'],
          plugins: [{ k: 'mood', v: '兴奋' }],
          bodyHtml: '<p>想做一个只给自己用的记录工具。不是记账，也不是待办 —— 是想知道「我拥有的东西每天值多少钱」「哪些钱是白花的」。</p>' +
            '<p>先做出来，能自己用三个月，再谈别的。</p>'
        }
      ]
    };
  }

  function load() {
    let d = null;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) d = JSON.parse(raw);
    } catch (err) { d = null; }
    // 首次安装：不要示例随笔，只保留结构（分类、插件配置）
    if (!d || !d.entries) {
      d = seed();
      d.entries = [];
    }
    if (!d.cats) d.cats = [];
    d.entries.forEach(function (e) {
      if (!e.plugins) e.plugins = [];
      if (!e.tags) e.tags = [];
      if (e.bodyHtml == null) e.bodyHtml = e.body ? '<p>' + esc(e.body).replace(/\n/g, '</p><p>') + '</p>' : '';
    });
    return d;
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (err) {
      UI().toast('本地存储写入失败，可能是图片太大');
    }
  }

  let db = load();

  /* ---------------- 工具 ---------------- */

  function byId(id) {
    for (let i = 0; i < db.entries.length; i++) if (db.entries[i].id === id) return db.entries[i];
    return null;
  }
  function catEmoji(name) {
    for (let i = 0; i < db.cats.length; i++) if (db.cats[i].name === name) return db.cats[i].emoji || '📁';
    return '📁';
  }
  function plug(e, k) {
    const list = e.plugins || [];
    for (let i = 0; i < list.length; i++) if (list[i].k === k) return list[i];
    return null;
  }
  function stars(n) {
    let s = '';
    for (let i = 1; i <= 5; i++) s += i <= n ? '★' : '☆';
    return '<span class="stars">' + s + '</span>';
  }
  function shortDate(s) {
    const p = String(s || '').split('-');
    return p.length === 3 ? (Number(p[1]) + '/' + Number(p[2])) : '—';
  }
  function firstImage(html) {
    const box = document.createElement('div');
    box.innerHTML = html || '';
    const im = box.querySelector('img');
    return im ? im.getAttribute('src') : '';
  }
  function imageCount(html) {
    const box = document.createElement('div');
    box.innerHTML = html || '';
    return box.querySelectorAll('img').length;
  }
  function plainText(html) {
    const box = document.createElement('div');
    box.innerHTML = html || '';
    Array.prototype.forEach.call(box.querySelectorAll('img'), function (im) {
      im.parentNode.replaceChild(document.createTextNode('［图片］'), im);
    });
    Array.prototype.forEach.call(box.querySelectorAll('p,div'), function (p) {
      p.appendChild(document.createTextNode('\n'));
    });
    return (box.textContent || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  }

  // 副标题：分类 + 各插件值
  function subOf(e) {
    const bits = [];
    if (e.cat) bits.push(e.cat);
    PLUGIN_KEYS.forEach(function (k) {
      const p = plug(e, k);
      if (!p || p.v == null || p.v === '') return;
      if (k === 'rating') bits.push('★' + p.v);
      else if (k === 'price') bits.push(QY.fmtMoney(p.v));
      else if (k === 'place') bits.push(p.v.name || '已定位');
      else if (k === 'mood') bits.push(p.v);
      else if (k === 'link') bits.push('链接');
    });
    const n = imageCount(e.bodyHtml);
    if (n) bits.push(n + ' 图');
    return bits.join(' · ');
  }

  /* ---------------- 列表 ---------------- */

  function filtered() {
    const q = state.query.trim().toLowerCase();
    return db.entries.filter(function (e) {
      if (state.cat !== '全部' && e.cat !== state.cat) return false;
      if (!q) return true;
      const hay = (e.title || '') + ' ' + plainText(e.bodyHtml) + ' ' + (e.tags || []).join(' ');
      return hay.toLowerCase().indexOf(q) >= 0;
    }).sort(function (a, b) {
      const k = (window.QYUI && QYUI.ui) ? QYUI.ui().sort.collect : 'recent';
      if (k === 'oldest') return a.date < b.date ? -1 : 1;
      if (k === 'title') return String(a.title || '').localeCompare(String(b.title || ''), 'zh');
      return a.date < b.date ? 1 : -1;
    });
  }

  function tileStyle(e) {
    const img = firstImage(e.bodyHtml);
    if (img) return 'background-image:url(' + img + ');background-size:cover;background-position:center';
    return 'background:linear-gradient(150deg,#E7ECF5,#C9D6E8)';
  }
  function tileInner(e) {
    if (firstImage(e.bodyHtml)) return '';
    const em = catEmoji(e.cat);
    return window.QYIcon ? QYIcon.forEmoji(em, 21) : em;
  }

  function rowHTML(e) {
    const r = plug(e, 'rating');
    const pr = plug(e, 'price');
    let side = '';
    if (r) side += '<div class="row-value">' + stars(r.v) + '</div>';
    if (pr && pr.v != null && pr.v > 0) side += '<div class="row-note">' + QY.fmtMoney(pr.v) + '</div>';
    if (!side) side = '<div class="row-value" style="font-size:13px;color:var(--label-3)">' + shortDate(e.date) + '</div>';

    return '' +
      '<div class="row" data-action="c-detail" data-id="' + e.id + '">' +
        '<div class="tile" style="' + tileStyle(e) + '">' + tileInner(e) + '</div>' +
        '<div class="row-main">' +
          '<div class="row-title">' + esc(e.title) + '</div>' +
          '<div class="row-sub">' + esc(subOf(e)) + '</div>' +
        '</div>' +
        '<div class="row-side">' + side + '</div>' +
      '</div>';
  }

  function renderListInner() {
    const list = filtered();
    if (!list.length) return '<div class="empty"><div class="emoji">' +
      (window.QYIcon ? QYIcon.forEmoji('🗂', 36) : '🗂') + '</div><p>这里还没有内容</p></div>';
    return list.map(rowHTML).join('');
  }

  function renderList() {
    const chips = ['全部'].concat(db.cats.map(function (c) { return c.name; })).map(function (c) {
      const ic = (c !== '全部' && window.QYIcon) ? QYIcon.forEmoji(catEmoji(c), 13) + ' ' : '';
      return '<button class="chip ' + (state.cat === c ? 'active' : '') +
        '" data-action="c-chip" data-cat="' + esc(c) + '">' + ic + esc(c) + '</button>';
    }).join('');

    const recent = db.entries.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }).slice(0, 6);
    const strip = recent.map(function (e) {
      return '<div class="cover-card" data-action="c-detail" data-id="' + e.id + '">' +
        '<div class="cc-emoji" style="' + tileStyle(e) + '">' + tileInner(e) + '</div>' +
        '<div class="cc-title">' + esc(e.title) + '</div>' +
      '</div>';
    }).join('');

    return '' +
      '<div class="page-top">' +
        UI().pageHead('收藏', db.entries.length + ' 条随笔 · ' + db.cats.length + ' 个自定义分类',
          UI().iconBtn('c-add', '新增收藏')) +
      '</div>' +
      '<div class="cover-strip">' + strip + '</div>' +
      '<div class="search">' + UI().I.search +
        '<input id="c-search" placeholder="搜索标题、正文、标签" value="' + esc(state.query) + '" />' +
      '</div>' +
      '<div class="chips">' + chips +
        '<button class="chip" data-action="c-newcat">＋ 新分类</button>' +
      '</div>' +
      '<div class="group" id="c-list">' + renderListInner() + '</div>';
  }

  /* ---------------- 详情 ---------------- */

  function pluginView(e) {
    const r = plug(e, 'rating');
    const pr = plug(e, 'price');
    const pl = plug(e, 'place');
    const lk = plug(e, 'link');
    const md = plug(e, 'mood');

    let out = '';
    const metrics = [];
    if (r) metrics.push('<div class="metric"><div class="m-label">评分</div><div class="m-value">' + r.v + '<small>/5</small></div></div>');
    if (pr && pr.v != null) metrics.push('<div class="metric"><div class="m-label">价格</div><div class="m-value">' + QY.fmtMoney(pr.v) + '</div></div>');
    if (md) metrics.push('<div class="metric"><div class="m-label">心情</div><div class="m-value" style="font-size:15px">' + esc(md.v) + '</div></div>');
    if (metrics.length) {
      out += '<div class="metrics" style="grid-template-columns:repeat(' + metrics.length + ',1fr);margin-top:16px">' +
        metrics.join('') + '</div>';
    }
    if (pl) {
      const hasCoord = !!(pl.v && pl.v.lat);
      out += '<div class="section"><div class="section-head"><h2>位置</h2><span>' +
        (hasCoord ? pl.v.lat.toFixed(4) + ', ' + pl.v.lng.toFixed(4) : '只记了地点名') + '</span></div>' +
        '<div class="map-block"' + (hasCoord ? '' : ' style="background-image:none"') + '>' +
          (hasCoord ? '<div class="map-pin">📍</div>' : '') +
          '<div class="map-label">' + esc((pl.v && pl.v.name) || '未命名地点') + '</div></div></div>';
    }
    if (lk) {
      out += '<div class="section"><div class="group">' +
        '<a class="kv" href="' + esc(lk.v) + '" target="_blank" rel="noopener" style="text-decoration:none;color:inherit">' +
          '<span class="k">相关链接</span><span class="v" style="color:var(--blue)">' + esc(String(lk.v).slice(0, 28)) + '…</span></a>' +
        '</div></div>';
    }
    return out;
  }

  function viewDetail(e) {
    if (!e) return renderList();
    const img = firstImage(e.bodyHtml);
    const cover = img
      ? '<div class="hero-cover" style="background-image:url(' + img + ');background-size:cover;background-position:center"></div>'
      : '<div class="hero-cover" style="background:linear-gradient(150deg,#E7ECF5,#C9D6E8)">' +
        (window.QYIcon ? QYIcon.forEmoji(catEmoji(e.cat), 44) : catEmoji(e.cat)) + '</div>';

    // meta 数组只放纯文本（复制文案 shareText 也用它）；分类图标是 HTML，
    // 必须在拼接处单独注入——之前混进 meta 又整体 esc()，页面上显示的是 SVG 源码
    const meta = [];
    if (e.cat) meta.push(esc(e.cat));
    meta.push(QY.fmtDate(e.date));
    const n = imageCount(e.bodyHtml);
    if (n) meta.push(n + ' 张图');
    const catIcon = e.cat
      ? (window.QYIcon ? QYIcon.forEmoji(catEmoji(e.cat), 13) + ' ' : esc(catEmoji(e.cat)) + ' ')
      : '';

    const tags = (e.tags && e.tags.length)
      ? '<div class="section"><div class="section-head"><h2>标签</h2></div><div class="tag-row">' +
        e.tags.map(function (x) { return '<span class="tag">#' + esc(x) + '</span>'; }).join('') + '</div></div>'
      : '';

    return '' +
      '<div class="navbar"><button class="back" data-action="c-back">‹ 收藏</button>' +
        '<span class="nav-acts">' +
          '<button type="button" class="nav-ico" data-action="c-edit" data-id="' + e.id + '" aria-label="编辑" title="编辑">' +
            (window.QYIcon ? QYIcon.svg('pencil', 19) : '✎') + '</button>' +
          '<button type="button" class="nav-more" data-action="c-menu" data-id="' + e.id + '" aria-label="更多操作">' +
            (window.QYIcon ? QYIcon.svg('more', 20) : '···') + '</button>' +
        '</span></div>' +
      cover +
      '<div style="padding:18px 4px 0">' +
        '<h1 style="margin:0;font-size:25px;font-weight:700;letter-spacing:-0.025em">' + esc(e.title) + '</h1>' +
        '<p style="margin:6px 0 0;font-size:13px;color:var(--label-2)">' + catIcon + meta.join(' · ') + '</p>' +
      '</div>' +
      // 新结构：插件芯片穿插在正文里（见 sanitize 的 SPAN 白名单），
      // 已经在 rich-body 里渲染，就不再单独出指标/位置/链接区块；老数据照旧
      (String(e.bodyHtml || '').indexOf('inline-plug') >= 0 ? '' : pluginView(e)) +
      '<div class="card" style="margin-top:16px"><div class="rich-body">' + (e.bodyHtml || '<p style="color:var(--label-3)">还没有正文</p>') + '</div></div>' +
      tags +
      '<div style="height:26px"></div>';
  }

  /* ---------------- 富文本：净化 / 编辑 ---------------- */

  const ALLOWED = { P: 1, BR: 1, STRONG: 1, EM: 1, B: 1, I: 1, IMG: 1, SPAN: 1, VIDEO: 1 };
  // 这些标签必须整块删掉，不能只拆标签 —— 否则 <script>alert(1)</script>
  // 会被"拆"成正文里的 alert(1) 文本
  const DROP_WHOLE = { SCRIPT: 1, STYLE: 1, IFRAME: 1, OBJECT: 1, EMBED: 1, NOSCRIPT: 1, TEMPLATE: 1, SVG: 1, MATH: 1 };

  // 只保留 p / br / strong / em / img / span(内嵌插件) / video，其余标签拆掉、属性删掉
  function sanitize(html) {
    const box = document.createElement('div');
    box.innerHTML = html || '';
    for (let pass = 0; pass < 6; pass++) {
      let changed = false;
      Array.prototype.forEach.call(box.querySelectorAll('*'), function (el) {
        if (DROP_WHOLE[el.tagName]) {
          el.parentNode.removeChild(el);
          changed = true;
          return;
        }
        if (!ALLOWED[el.tagName]) {
          while (el.firstChild) el.parentNode.insertBefore(el.firstChild, el);
          el.parentNode.removeChild(el);
          changed = true;
          return;
        }
        Array.prototype.slice.call(el.attributes).forEach(function (a) {
          if (el.tagName === 'IMG' && (a.name === 'src' || a.name === 'alt')) {
            if (a.name === 'src' && String(el.getAttribute('src')).indexOf('data:image/') !== 0) {
              el.parentNode.removeChild(el);
              changed = true;
            }
            return;
          }
          // 内嵌插件芯片：只留 inline-plug 这一种 span，class 本身也在白名单里
          // （属性是逐个检查的，class 若先被剥掉，后面的 data-* 就对不上号了）
          if (el.tagName === 'SPAN' &&
              ((a.name === 'class' && a.value === 'inline-plug') ||
               (el.getAttribute('class') === 'inline-plug' &&
                /^(data-k|data-v|data-lat|data-lng|contenteditable)$/.test(a.name)))) {
            if (a.name === 'contenteditable' && a.value !== 'false') { el.removeAttribute(a.name); changed = true; }
            return;
          }
          // 视频：src 必须是本机 data:video/，其余只留控制类布尔属性
          if (el.tagName === 'VIDEO' && /^(src|controls|playsinline|preload)$/.test(a.name)) {
            if (a.name === 'src' && String(el.getAttribute('src')).indexOf('data:video/') !== 0) {
              el.parentNode.removeChild(el);
              changed = true;
            }
            return;
          }
          el.removeAttribute(a.name);
          changed = true;
        });
      });
      const walker = document.createTreeWalker(box, NodeFilter.SHOW_COMMENT, null);
      const comments = [];
      while (walker.nextNode()) comments.push(walker.currentNode);
      comments.forEach(function (c) { c.parentNode.removeChild(c); changed = true; });
      if (!changed) break;
    }
    return box.innerHTML;
  }

  /* ---------------- 图片处理 ----------------
   * 两条硬规则：
   *   1. 普通照片/截图 → canvas 缩放 + JPEG 重编码（顺带丢掉 EXIF，包括 GPS）
   *   2. 动图（GIF）→ 原样保留，绝不走 canvas，否则动画就没了
   */
  const IMG_MAX_SIDE = 1600;
  const IMG_QUALITY = 0.82;

  function bytesOfDataUrl(u) {
    const i = String(u || '').indexOf(',');
    return i < 0 ? 0 : Math.round((u.length - i - 1) * 0.75);
  }

  // 原生活回的是 dataURL，转回 File 好复用同一条压缩管线（含 GIF 判定）
  function dataUrlToFile(dataUrl) {
    const s = String(dataUrl || '');
    const comma = s.indexOf(',');
    const mime = (s.slice(0, comma).match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
    const bin = atob(s.slice(comma + 1));
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new File([arr], 'photo.' + (mime.split('/')[1] || 'jpg'), { type: mime });
  }

  function readAsDataURL(file) {
    return new Promise(function (resolve, reject) {
      const fr = new FileReader();
      fr.onerror = function () { reject(new Error('读取失败')); };
      fr.onload = function () { resolve(fr.result); };
      fr.readAsDataURL(file);
    });
  }

  function compressImage(file, opts) {
    const maxSide = (opts && opts.maxSide) || IMG_MAX_SIDE;
    const quality = (opts && opts.quality) || IMG_QUALITY;
    if (/image\/gif/i.test(file.type) && !(opts && opts.forceStatic)) {
      // 动图：原样保留（代价是体积大，插的时候会提示）
      return readAsDataURL(file).then(function (u) {
        return { dataUrl: u, before: file.size, after: bytesOfDataUrl(u), gif: true, w: 0, h: 0 };
      });
    }
    return readAsDataURL(file).then(function (src) {
      return new Promise(function (resolve, reject) {
        const im = new Image();
        im.onerror = function () { reject(new Error('这个格式浏览器解不开（HEIC 常见）')); };
        im.onload = function () {
          const w0 = im.naturalWidth || 1;
          const h0 = im.naturalHeight || 1;
          const scale = Math.min(1, maxSide / Math.max(w0, h0));
          const w = Math.max(1, Math.round(w0 * scale));
          const h = Math.max(1, Math.round(h0 * scale));
          const c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          const g = c.getContext('2d');
          g.fillStyle = '#FFFFFF';        // 透明 PNG 转 JPEG 会变黑底，先铺白
          g.fillRect(0, 0, w, h);
          g.drawImage(im, 0, 0, w, h);
          const out = c.toDataURL('image/jpeg', quality);

          // 纯色截图 / 图标这类图，JPEG 可能反而更大 —— 原图本来就小的话就直接用原图
          const keepOriginal = out.length > src.length && src.length < 400 * 1024;
          const picked = keepOriginal ? src : out;
          resolve({
            dataUrl: picked,
            before: file.size,
            after: bytesOfDataUrl(picked),
            gif: false,
            kept: keepOriginal ? 'original' : 'jpeg',
            w: keepOriginal ? w0 : w,
            h: keepOriginal ? h0 : h
          });
        };
        im.src = src;
      });
    });
  }

  function humanSize(n) {
    if (n == null) return '—';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  }

  // 插入一张图片：先压缩，再插到光标处
  function insertFile(editor, file) {
    if (!file || String(file.type).indexOf('image/') !== 0) { UI().toast('只能插入图片'); return; }
    const big = file.size > 8 * 1024 * 1024;
    if (big && !/image\/gif/i.test(file.type)) { UI().toast('图片较大，正在压缩…'); }
    compressImage(file).then(function (r) {
      insertImage(editor, r.dataUrl);
      const saved = r.before > 0 ? Math.round((1 - r.after / r.before) * 100) : 0;
      if (r.gif) UI().toast('动图原样插入（' + humanSize(r.after) + '，动图不压缩）');
      else if (r.kept === 'original') UI().toast('原图已足够小（' + humanSize(r.after) + '），直接插入');
      else UI().toast('已插入图片 ' + humanSize(r.before) + ' → ' + humanSize(r.after) +
        (saved > 0 ? '（省 ' + saved + '%）' : '') + ' · ' + r.w + '×' + r.h);
    }).catch(function (err) {
      UI().toast('插入失败：' + err.message);
    });
  }

  /* 把光标放回编辑器（优先恢复原选区，否则落在末尾），再执行 execCommand */
  function execAtCaret(editor, cmd, val) {
    editor.focus();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !editor.contains(sel.anchorNode)) {
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    return document.execCommand(cmd, false, val);
  }

  function insertImage(editor, dataUrl) {
    execAtCaret(editor, 'insertImage', dataUrl);
    Array.prototype.forEach.call(editor.querySelectorAll('img'), function (im) {
      im.setAttribute('alt', im.getAttribute('alt') || '图片');
    });
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function insertHTML(editor, html) {
    execAtCaret(editor, 'insertHTML', html);
  }

  /* ---------------- 内嵌插件芯片：穿插在正文里的内容块 ----------------
   * span.inline-plug（contenteditable=false）跟文字一起流动：
   * 退格整颗删掉、点一下改值。保存时既留在正文 HTML 里、
   * 也抽取成 plugins[]（AI / 搜索 / 老数据结构都照常用）。 */
  function plugChipLabel(k, v) {
    if (k === 'rating') return (v || 3) + ' 分';
    if (k === 'price') return v ? ('¥ ' + v) : '价格';
    if (k === 'place') return (v && v.name) || '地点';
    if (k === 'link') {
      const s = String(v || '');
      return s ? (s.length > 18 ? s.slice(0, 18) + '…' : s) : '链接';
    }
    if (k === 'mood') return v || MOODS[0];
    return k;
  }

  function plugChipHTML(k, v, coord) {
    const p = PLUGINS[k] || {};
    const val = k === 'place' ? ((v && v.name) || '') : (v == null ? '' : v);
    return '<span class="inline-plug" contenteditable="false" data-k="' + k + '"' +
      ' data-v="' + esc(String(val)) + '"' +
      (coord && coord.lat ? ' data-lat="' + coord.lat + '" data-lng="' + coord.lng + '"' : '') +
      '>' + (window.QYIcon ? QYIcon.forEmoji(p.icon || '⬦', 13) : (p.icon || '⬦')) +
      ' ' + esc(plugChipLabel(k, v)) + '</span>&nbsp;';
  }

  function refreshPlugChip(chip) {
    const k = chip.getAttribute('data-k');
    let v = chip.getAttribute('data-v') || '';
    if (k === 'place') v = { name: v, lat: chip.getAttribute('data-lat'), lng: chip.getAttribute('data-lng') };
    chip.textContent = '';
    chip.insertAdjacentHTML('afterbegin',
      (window.QYIcon ? QYIcon.forEmoji((PLUGINS[k] || {}).icon || '⬦', 13) : (PLUGINS[k] || {}).icon || '⬦') +
      ' ' + esc(plugChipLabel(k, k === 'place' ? v : v)));
  }

  /* 编辑器内"最后的已知光标"：选区一旦离开编辑器（点工具栏/对话框），
   * 浏览器会把 focus 的光标重置到开头，插卡片就会插错位置。
   * 这里持续记录编辑器内的选区，插入时优先用它。 */
  let lastCaret = null;
  document.addEventListener('selectionchange', function () {
    const sel = window.getSelection();
    const ed = document.getElementById('c-body');
    if (!ed || !sel || !sel.rangeCount) return;
    if (ed.contains(sel.anchorNode)) lastCaret = sel.getRangeAt(0).cloneRange();
  });

  /* 在光标处直接落一颗芯片并返回它的引用。
   * 不走 execCommand('insertHTML')：编辑对话框关掉后选区经常丢，
   * execCommand 会把内容插到不可控的位置，也没法拿到"刚插的那颗"。 */
  function insertChipAtCaret(editor, k, v, coord) {
    editor.focus();
    const tpl = document.createElement('div');
    tpl.innerHTML = plugChipHTML(k, v, coord);
    const chip = tpl.firstChild;
    const nbsp = document.createTextNode('\u00A0');
    const sel = window.getSelection();
    let range = null;
    if (lastCaret && editor.contains(lastCaret.startContainer) &&
        editor.contains(lastCaret.endContainer)) {
      range = lastCaret.cloneRange();
    } else if (sel && sel.rangeCount && editor.contains(sel.anchorNode)) {
      range = sel.getRangeAt(0).cloneRange();
    }
    if (range) {
      range.collapse(false);
      range.insertNode(nbsp);
      range.insertNode(chip);          // 后插的在前面：[chip][nbsp]
      const after = document.createRange();
      after.setStartAfter(nbsp);
      after.collapse(true);
      sel.removeAllRanges();
      sel.addRange(after);
      lastCaret = after.cloneRange();
    } else {
      const p = document.createElement('p');
      p.appendChild(chip);
      p.appendChild(nbsp);
      editor.appendChild(p);
    }
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    return chip;
  }

  /* 点芯片 → 按种类弹对应编辑器，改完写回芯片 */
  function editPlugChip(chip, done) {
    const k = chip.getAttribute('data-k');
    let v = chip.getAttribute('data-v') || '';
    const write = function (nv) {
      if (nv != null && nv !== '') chip.setAttribute('data-v', String(nv));
      refreshPlugChip(chip);
      if (done) done();
    };
    if (k === 'rating') {
      window.QYDialog.choose({
        title: '评分', current: v || '3',
        options: [1, 2, 3, 4, 5].map(function (n) {
          return { v: String(n), t: '★'.repeat(n) + '☆'.repeat(5 - n) };
        }),
        onPick: write
      });
    } else if (k === 'mood') {
      window.QYDialog.choose({
        title: '心情', current: v || MOODS[0],
        options: MOODS.map(function (m) { return { v: m, t: m }; }),
        onPick: write
      });
    } else if (k === 'price') {
      window.QYDialog.text({
        title: '价格', value: v, placeholder: '38.5',
        onOk: write
      });
    } else if (k === 'link') {
      window.QYDialog.text({
        title: '链接', value: v, placeholder: 'https://',
        onOk: write
      });
    } else if (k === 'place') {
      window.QYDialog.text({
        title: '地点名', value: v, placeholder: '武汉 · 东湖绿道',
        onOk: function (nv) {
          chip.setAttribute('data-v', nv || '');
          refreshPlugChip(chip);
          if (done) done();
        }
      });
    }
  }

  /* 从编辑器收 plugins[]：按芯片出现顺序，空值跳过，类型按 App 约定收口 */
  function readInlinePlugins(editor) {
    const out = [];
    Array.prototype.forEach.call(editor.querySelectorAll('.inline-plug'), function (chip) {
      const k = chip.getAttribute('data-k');
      const v = chip.getAttribute('data-v') || '';
      if (k === 'rating') {
        const n = Number(v);
        if (n) out.push({ k: k, v: n });
      } else if (k === 'price') {
        if (v !== '') out.push({ k: k, v: Number(v) });
      } else if (k === 'mood') {
        if (v) out.push({ k: k, v: v });
      } else if (k === 'link') {
        if (v) out.push({ k: k, v: v });
      } else if (k === 'place') {
        const lat = chip.getAttribute('data-lat');
        out.push({ k: k, v: { name: v, lat: lat ? Number(lat) : null, lng: lat ? Number(chip.getAttribute('data-lng')) : null } });
      }
    });
    return out;
  }

  function pickImage(editor) {
    // 原生壳（安卓/卓易通/鸿蒙）里 <input type=file> 点了没反应——宿主没实现
    // onShowFileChooser。走平台层的原生选图（系统面板：相机第一项），
    // 原生侧已缩到长边 1600 / JPEG 重编码（顺带清掉 EXIF/GPS）。
    if (window.QYPlatform && QYPlatform.native && QYPlatform.pickImage) {
      QYPlatform.pickImage(function (dataUrl) {
        if (!dataUrl) return;
        insertImage(editor, dataUrl);
        UI().toast('已插入图片');
      }, '');
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', function () {
      const files = Array.prototype.slice.call(input.files || []);
      input.remove();
      if (!files.length) return;
      // 串行插入，避免多张图并发导致顺序错乱
      files.reduce(function (p, f) {
        return p.then(function () { return insertFile(editor, f); });
      }, Promise.resolve());
    });
    input.click();
  }

  /* 选一段视频：纯前端没条件转码，所以限 2.5MB 内的短片原样内嵌 */
  const VIDEO_MAX = 2.5 * 1024 * 1024;
  function pickVideo(editor) {
    if (!window.QYPlatform || !QYPlatform.pickVideo) { UI().toast('当前环境不支持选视频'); return; }
    QYPlatform.pickVideo(function (dataUrl) {
      if (!dataUrl) return;
      const bytes = Math.round(dataUrl.length * 3 / 4);
      if (bytes > VIDEO_MAX) {
        UI().toast('视频太大（' + humanSize(bytes) + '）：只能内嵌 2.5MB 内的短片');
        return;
      }
      insertVideo(editor, dataUrl);
      UI().toast('已插入视频 ' + humanSize(bytes));
    });
  }

  function insertVideo(editor, dataUrl) {
    insertHTML(editor, '<video src="' + dataUrl + '" controls playsinline preload="metadata"></video><p><br></p>');
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /* ---------------- 表单 ---------------- */

  let editingId = null;

  function catOptions(selected) {
    return db.cats.map(function (c) {
      return '<option' + (c.name === selected ? ' selected' : '') + '>' + esc(c.name) + '</option>';
    }).join('') + '<option value="__new">＋ 新建分类…</option>';
  }

  function formHTML(entry) {
    editingId = entry ? entry.id : null;
    const e = entry || { title: '', cat: (db.cats[0] && db.cats[0].name), date: QY.iso(QY.today()), tags: [], plugins: [], bodyHtml: '' };

    // 旧版数据迁移：插件还是"表单底部一摞"的老结构，编辑时转成
    // 正文里的内嵌芯片（追加在正文末尾），保存后就是新结构了
    let bodyHtml = e.bodyHtml || '';
    if ((e.plugins || []).length && bodyHtml.indexOf('inline-plug') < 0) {
      bodyHtml += '<p>' + (e.plugins || []).map(function (p) {
        return plugChipHTML(p.k, p.v, p.k === 'place' ? p.v : null);
      }).join(' ') + '</p>';
    }

    return '' +
      '<div class="ftitle-row">' +
          '<input id="c-title" class="ftitle" placeholder="例如：第一次自己做手冲" value="' +
            esc(e.title) + '" autocomplete="off" />' +
          '<span class="fcount" id="c-title-count">0/30</span>' +
        '</div>' +
        '<div class="fmeta">' +
          '<button type="button" class="fmeta-pill" data-action="c-pick" data-target="c-cat"' +
            ' data-list="cats" data-label="pf-c-cat" data-title="分类">' +
            '<span id="pf-c-cat">' + esc(e.cat || '') + '</span><span class="chev">›</span></button>' +
          '<input id="c-date" class="fmeta-pill fdate" type="date" readonly data-action="i-date"' +
            ' data-target="c-date" value="' + e.date + '" />' +
          '<input type="hidden" id="c-cat" value="' + esc(e.cat || '') + '" />' +
        '</div>' +

        '<div class="fp-tool-bar">' +
          '<div class="editor-toolbar">' +
            '<button data-action="c-bold" title="加粗" aria-label="加粗"><b>B</b></button>' +
            '<button data-action="c-italic" title="斜体" aria-label="斜体"><i>I</i></button>' +
            '<span class="tb-sep"></span>' +
            '<button data-action="c-image" title="插入图片" aria-label="插入图片">🖼</button>' +
            '<button data-action="c-gif" title="插入动图（GIF 不压缩）" aria-label="插入动图">✨</button>' +
            '<button data-action="c-video" title="插入视频（限 2.5MB 内的短片）" aria-label="插入视频">🎬</button>' +
            '<button data-action="c-plug" title="插入评分 / 地点 / 价格等卡片" aria-label="插入卡片">⬦</button>' +
            '<span class="tb-sep"></span>' +
            '<button data-action="c-del-img" title="删除选中的图片 / 视频" aria-label="删除选中内容" class="tb-danger">🗑</button>' +
          '</div>' +
        '</div>' +

        '<div class="fcard fedit">' +
          '<div id="c-body" class="rich-editor" contenteditable="true" ' +
            'data-placeholder="记录此刻的想法…">' + bodyHtml + '</div>' +
          '<button type="button" class="fzen-open" data-action="c-zen" title="全屏写作" aria-label="全屏写作">⤢ 全屏写作</button>' +
        '</div>' +

        '<div class="fsec">标签</div>' +
        '<div class="fcard">' +
          '<div class="frow"><span class="fl">标签</span>' +
            '<input id="c-tags" class="input finput" placeholder="用空格分隔，例如：咖啡 日常" value="' +
              esc((e.tags || []).join(' ')) + '" autocomplete="off" /></div>' +
        '</div>';
  }

  /* ---------------- 全屏写作（专注模式）----------------
   * 把编辑区和工具栏整个"搬"进覆盖层：整屏只剩文字 + 工具栏。
   * DOM 搬家保内容保光标，所有 data-action 照常工作。 */
  function openZen() {
    const editor = document.getElementById('c-body');
    const toolbar = document.querySelector('.fp-tool-bar .editor-toolbar');
    if (!editor || !toolbar || document.getElementById('zen-root')) return;
    const layer = document.createElement('div');
    layer.id = 'zen-root';
    layer.innerHTML =
      '<div class="zen-head">' +
        '<span class="zen-count" id="zen-count"></span>' +
        '<button type="button" class="zen-done" data-action="c-zen-done">完成 ✓</button>' +
      '</div>' +
      '<div class="zen-body" id="zen-body"></div>' +
      '<div class="zen-foot" id="zen-foot"></div>';
    document.body.appendChild(layer);
    layer.querySelector('#zen-body').appendChild(editor);
    layer.querySelector('#zen-foot').appendChild(toolbar);
    updateZenCount();
    editor.focus();
  }

  function closeZen() {
    const layer = document.getElementById('zen-root');
    if (!layer) return;
    const editor = document.getElementById('c-body');
    const toolbar = layer.querySelector('.editor-toolbar');
    const card = document.querySelector('.fp .fedit');
    if (editor && card) card.insertBefore(editor, card.querySelector('.fzen-open'));
    const bar = document.querySelector('.fp-tool-bar');
    if (toolbar && bar) bar.appendChild(toolbar);
    layer.remove();
  }

  function updateZenCount() {
    const editor = document.getElementById('c-body');
    const el = document.getElementById('zen-count');
    if (!editor || !el) return;
    el.textContent = editor.textContent.replace(/\s+/g, ' ').trim().length + ' 字';
  }

  function readPlugins() {
    // 已被"正文内嵌芯片"取代：读一遍编辑器里的 .inline-plug 就是 plugins[]
    const editor = document.getElementById('c-body');
    return editor ? readInlinePlugins(editor) : [];
  }

  function saveForm() {
    const titleEl = document.getElementById('c-title');
    const title = (titleEl.value || '').trim();
    if (!title) { UI().toast('请先填写标题'); return; }
    const editor = document.getElementById('c-body');
    const bodyHtml = sanitize(editor ? editor.innerHTML : '');
    const catSel = document.getElementById('c-cat');

    const payload = {
      title: title,
      cat: catSel.value === '__new' ? (db.cats[0] ? db.cats[0].name : '未分类') : catSel.value,
      date: document.getElementById('c-date').value || QY.iso(QY.today()),
      tags: (document.getElementById('c-tags').value || '').split(/[\s,，]+/).filter(Boolean),
      plugins: editor ? readInlinePlugins(editor) : [],
      bodyHtml: bodyHtml
    };

    if (editingId) {
      const e = byId(editingId);
      if (e) Object.keys(payload).forEach(function (k) { e[k] = payload[k]; });
      UI().closeSheet();
      state.detailId = editingId;
      editingId = null;
      save();
      UI().mount();
      UI().toast('已保存修改');
      return;
    }

    payload.id = QY.uid('c');
    db.entries.push(payload);
    save();
    UI().closeSheet();
    state.detailId = null;
    UI().mount();
    UI().toast('已收藏「' + title + '」');
  }

  /* ---------------- 分享：文案 ---------------- */

  function shareText(e) {
    const lines = [e.title];
    const meta = [];
    if (e.cat) meta.push(e.cat);
    meta.push(QY.fmtDate(e.date));
    const md = plug(e, 'mood');
    if (md) meta.push(md.v);
    const pl = plug(e, 'place');
    if (pl && pl.v && pl.v.name) meta.push('📍' + pl.v.name);
    const pr = plug(e, 'price');
    if (pr && pr.v) meta.push(QY.fmtMoney(pr.v));
    const r = plug(e, 'rating');
    if (r) meta.push('★'.repeat(r.v));
    lines.push(meta.join(' · '));
    const body = plainText(e.bodyHtml);
    if (body) { lines.push(''); lines.push(body); }
    if (e.tags && e.tags.length) { lines.push(''); lines.push(e.tags.map(function (t) { return '#' + t; }).join(' ')); }
    return lines.join('\n');
  }

  function copyText(e) {
    const text = shareText(e);
    const done = function () { UI().toast('文案已复制'); };
    const fallback = function () {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); }
      catch (err) { UI().toast('复制失败，请手动选择'); }
      ta.remove();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  }

  /* ---------------- 分享：长图（含正文里的图片） ---------------- */

  const IMG_W = 1080;
  const PAD = 56;
  const BODY_FONT = '32px ' + FONT;

  function blocksOf(html) {
    const box = document.createElement('div');
    box.innerHTML = html || '';
    const out = [];
    (function walk(node) {
      Array.prototype.forEach.call(node.childNodes, function (n) {
        if (n.nodeType === 3) {
          const t = n.textContent.replace(/\s+/g, ' ').trim();
          if (t) out.push({ t: 'p', text: t });
          return;
        }
        if (n.nodeType !== 1) return;
        if (n.tagName === 'IMG') { out.push({ t: 'img', src: n.getAttribute('src') }); return; }
        if (n.tagName === 'BR') return;
        walk(n);
      });
    })(box);
    return out;
  }

  function wrapLines(ctx, text, maxWidth) {
    const out = [];
    String(text || '').split('\n').forEach(function (para) {
      if (!para) { out.push(''); return; }
      let cur = '';
      for (let i = 0; i < para.length; i++) {
        const next = cur + para[i];
        if (ctx.measureText(next).width > maxWidth && cur) { out.push(cur); cur = para[i]; }
        else cur = next;
      }
      if (cur) out.push(cur);
    });
    return out;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function loadImage(src) {
    return new Promise(function (resolve) {
      const im = new Image();
      im.onload = function () { resolve(im); };
      im.onerror = function () { resolve(null); };
      im.src = src;
    });
  }

  function makeLongImage(e) {
    const blocks = blocksOf(e.bodyHtml);
    const imgBlocks = blocks.filter(function (b) { return b.t === 'img'; });
    Promise.all(imgBlocks.map(function (b) { return loadImage(b.src); })).then(function (ims) {
      imgBlocks.forEach(function (b, i) { b.el = ims[i]; });
      draw();
    }).catch(function () { draw(); });

    function draw() {
      const probe = document.createElement('canvas').getContext('2d');
      const maxW = IMG_W - PAD * 2 - 64;
      const lineH = 56;
      const imgMaxH = 620;
      const gap = 26;

      probe.font = BODY_FONT;
      blocks.forEach(function (b) {
        if (b.t === 'p') b.lines = wrapLines(probe, b.text, maxW);
      });

      let bodyH = 0;
      blocks.forEach(function (b) {
        if (b.t === 'p') bodyH += b.lines.length * lineH + gap;
        else if (b.el) {
          const scale = Math.min(maxW / b.el.width, imgMaxH / b.el.height, 1.6);
          b.w = Math.round(b.el.width * scale);
          b.h = Math.round(b.el.height * scale);
          bodyH += b.h + gap;
        }
      });

      const coverH = firstImage(e.bodyHtml) ? 0 : 300;
      const headH = coverH + 210;
      const H = PAD + headH + bodyH + 200;

      const c = document.createElement('canvas');
      c.width = IMG_W;
      c.height = H;
      const g = c.getContext('2d');

      g.fillStyle = '#F2F2F7';
      g.fillRect(0, 0, IMG_W, H);
      roundRect(g, PAD / 2, PAD / 2, IMG_W - PAD, H - PAD, 44);
      g.fillStyle = '#FFFFFF';
      g.fill();

      let y = PAD + 40;

      // 没有配图时给一个渐变色块当封面
      if (coverH) {
        const grad = g.createLinearGradient(0, 0, IMG_W, coverH);
        grad.addColorStop(0, '#E7ECF5');
        grad.addColorStop(1, '#C9D6E8');
        g.save();
        roundRect(g, PAD / 2, PAD / 2, IMG_W - PAD, coverH, 44);
        g.clip();
        g.fillStyle = grad;
        g.fillRect(0, 0, IMG_W, coverH);
        // 排版字封面：标题首字。不用分类 emoji —— 画进导出长图会显得廉价
        g.font = '600 96px ' + FONT;
        g.fillStyle = 'rgba(28, 28, 30, 0.55)';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(String(e.title || '记').trim().charAt(0) || '记', IMG_W / 2, coverH / 2 + PAD / 2);
        g.restore();
        y = PAD + coverH + 30;
      }

      // 标题
      g.textAlign = 'left';
      g.textBaseline = 'alphabetic';
      g.fillStyle = '#1C1C1E';
      probe.font = '600 46px ' + FONT;
      const titleLines = wrapLines(probe, e.title, maxW);
      g.font = '600 46px ' + FONT;
      titleLines.slice(0, 2).forEach(function (line) {
        g.fillText(line, PAD + 32, y + 42);
        y += 60;
      });

      // 元信息
      const meta = [];
      if (e.cat) meta.push(e.cat);
      meta.push(QY.fmtDate(e.date));
      const r = plug(e, 'rating');
      if (r) meta.push('★'.repeat(r.v) + '☆'.repeat(5 - r.v));
      const pr = plug(e, 'price');
      if (pr && pr.v) meta.push(QY.fmtMoney(pr.v));
      const pl = plug(e, 'place');
      if (pl && pl.v && pl.v.name) meta.push('📍' + pl.v.name);
      g.fillStyle = '#8E8E93';
      g.font = '28px ' + FONT;
      g.fillText(meta.join('  ·  '), PAD + 32, y + 30);
      y += 86;

      // 正文（文字与图片按原顺序穿插）
      g.textAlign = 'left';
      blocks.forEach(function (b) {
        if (b.t === 'p') {
          g.fillStyle = '#1C1C1E';
          g.font = BODY_FONT;
          b.lines.forEach(function (line) {
            g.fillText(line, PAD + 32, y + 32);
            y += lineH;
          });
          y += gap;
        } else if (b.el) {
          const x = PAD + 32;
          g.save();
          roundRect(g, x, y, b.w, b.h, 24);
          g.clip();
          g.drawImage(b.el, x, y, b.w, b.h);
          g.restore();
          y += b.h + gap;
        }
      });

      // 页脚
      g.fillStyle = '#C7C7CC';
      g.font = '26px ' + FONT;
      g.fillText('琪遇台账 · ' + (e.tags || []).map(function (x) { return '#' + x; }).join(' '), PAD + 32, H - PAD - 40);

      const url = c.toDataURL('image/png');
      const name = 'xctally-' + e.title.replace(/[\\/:*?"<>|\s]/g, '') + '.png';
      UI().openSheet('' +
        '<div class="sheet">' +
          '<div class="grabber"></div>' +
          '<h3>长图已生成</h3>' +
          '<p class="hint">1080 × ' + H + ' · 图文一起排版，适合发朋友圈 / 小红书</p>' +
          '<div style="border-radius:var(--r-md);overflow:hidden;box-shadow:var(--shadow-card);max-height:46vh;overflow-y:auto">' +
            '<img src="' + url + '" style="width:100%;display:block" />' +
          '</div>' +
          '<div class="sheet-actions">' +
            '<button class="btn plain" data-action="c-close">关闭</button>' +
            '<a class="btn primary" href="' + url + '" download="' + name + '" style="text-align:center;text-decoration:none;line-height:1.4">保存图片</a>' +
          '</div>' +
        '</div>');
    }
  }

  /* ---------------- 交互 ---------------- */

  function newCategory() {
    // 用 App 自己的输入框，不用 window.prompt（安卓 WebView 里原生弹窗样式不搭）
    if (window.QYDialog) {
      window.QYDialog.text({
        title: '新分类的名字',
        placeholder: '例如：咖啡',
        onOk: function (name) {
          const clean = String(name || '').trim();
          if (!clean) return;
          if (!db.cats.some(function (c) { return c.name === clean; })) {
            db.cats.push({ name: clean, emoji: '📁' });
            save();
          }
          UI().toast('已添加分类「' + clean + '」');
          UI().closeSheet();
          UI().mount();
        }
      });
      return null;
    }
    const name = window.prompt('新分类的名字？', '');
    if (!name) return null;
    const clean = name.trim();
    if (!clean) return null;
    if (!db.cats.some(function (c) { return c.name === clean; })) {
      db.cats.push({ name: clean, emoji: '📁' });
      save();
    }
    return clean;
  }

  function handleAction(action, el) {
    if (action.indexOf('c-') !== 0) return false;
    const id = el.getAttribute('data-id');

    if (action === 'c-add') {
      UI().openFullpage('新增随笔', formHTML(null), { save: { action: 'c-save', label: '保存' } });
      initEditor();
    } else if (action === 'c-edit') {
      UI().openFullpage('编辑随笔', formHTML(byId(id)), { edit: true, save: { action: 'c-save', label: '保存修改' } });
      initEditor();
    } else if (action === 'c-plug') {
      // 插入内嵌卡片：选种类 → 光标处落一颗芯片 → 顺手弹编辑改值
      if (!window.QYDialog) return true;
      window.QYDialog.choose({
        title: '插入卡片',
        current: '',
        options: PLUGIN_KEYS.map(function (k) {
          return { v: k, t: PLUGINS[k].name, e: PLUGINS[k].icon };
        }),
        onPick: function (k) {
          const editor = document.getElementById('c-body');
          if (!editor) return;
          const def = k === 'rating' ? 3 : (k === 'mood' ? MOODS[0] : '');
          const chip = insertChipAtCaret(editor, k, def);
          editPlugChip(chip);
        }
      });
    } else if (action === 'c-zen') {
      openZen();
    } else if (action === 'c-zen-done') {
      closeZen();
    } else if (action === 'c-video') {
      const editor = document.getElementById('c-body');
      if (editor) pickVideo(editor);
    } else if (action === 'c-bold') {
      document.execCommand('bold');
    } else if (action === 'c-italic') {
      document.execCommand('italic');
    } else if (action === 'c-image' || action === 'c-gif') {
      const editor = document.getElementById('c-body');
      if (editor) pickImage(editor);
    } else if (action === 'c-del-img') {
      if (!selectedImg || !selectedImg.parentNode) { UI().toast('先点一下正文里的图片或视频'); return true; }
      selectedImg.parentNode.removeChild(selectedImg);
      selectedImg = null;
      syncDeleteBtn();
      UI().toast('已删除');
    } else if (action === 'c-close') {
      editingId = null;
      UI().closeSheet();
    } else if (action === 'c-save') {
      saveForm();
    } else if (action === 'c-menu') {
      // 右上角 ··· 的操作菜单：图标 + 文字；再点一下收起
      const exist = document.querySelector('.navbar .seg-dd-menu');
      if (exist) { exist.remove(); return true; }
      const ic = function (n) { return window.QYIcon ? QYIcon.svg(n, 16) : ''; };
      const menu = document.createElement('div');
      menu.className = 'seg-dd-menu act-menu';
      menu.innerHTML =
        '<button data-action="c-copy" data-id="' + id + '">' + ic('copy') + '复制文案</button>' +
        '<button data-action="c-long" data-id="' + id + '">' + ic('image') + '生成长图</button>' +
        '<button data-action="c-del" data-id="' + id + '" class="danger">' + ic('trash') + '删除</button>';
      el.parentNode.appendChild(menu);
      // 选了任何一项就收起菜单（事件继续冒泡给对应 handler）
      menu.addEventListener('click', function (ev) {
        if (ev.target.closest && ev.target.closest('[data-action]')) menu.remove();
      });
    } else if (action === 'c-detail') {
      if (UI().rememberScroll) UI().rememberScroll();   // 返回时还原列表位置
      state.detailId = id;
      UI().mount();
    } else if (action === 'c-back') {
      state.detailId = null;
      UI().mount();
    } else if (action === 'c-chip') {
      state.cat = el.getAttribute('data-cat');
      UI().mount();
    } else if (action === 'c-newcat') {
      const name = newCategory();
      if (name) { state.cat = name; UI().mount(); UI().toast('已新建分类「' + name + '」'); }
    } else if (action === 'c-copy') {
      copyText(byId(id));
    } else if (action === 'c-long') {
      makeLongImage(byId(id));
    } else if (action === 'c-del') {
      const e = byId(id);
      if (!e) return true;
      const doDel = function () {
        // 和物品一样进回收站（存在 prototype 库的 d.trash 里），30 天内可恢复
        const d = UI().data();
        d.trash = d.trash || [];
        d.trash.push({
          id: QY.uid('tr'),
          kind: 'collect',
          deletedAt: QY.iso(QY.today()),
          entry: e
        });
        UI().save();
        db.entries = db.entries.filter(function (x) { return x.id !== id; });
        save();
        state.detailId = null;
        UI().mount();
        UI().toast('已移入回收站，' + QY.TRASH_DAYS + ' 天内可恢复');
      };
      if (window.QYDialog) {
        window.QYDialog.confirm('把「' + e.title + '」移入回收站？保留 ' + QY.TRASH_DAYS + ' 天，期间可以恢复。',
          { title: '删除随笔', ok: '移入回收站', cancel: '取消', danger: true }).then(function (ok) { if (ok) doDel(); });
      } else if (window.confirm('删除「' + e.title + '」？此操作不可撤销。')) {
        doDel();
      }
    }
    return true;
  }

  // 编辑器初始化：Enter 生成 <p>、粘贴只保留纯文本、支持粘贴/拖入图片
  let selectedImg = null;

  function syncDeleteBtn() {
    const btn = document.querySelector('[data-action="c-del-img"]');
    if (btn) btn.style.opacity = selectedImg ? '1' : '0.4';
  }

  function initEditor() {
    selectedImg = null;
    const editor = document.getElementById('c-body');
    if (!editor) return;

    // 正文输入顺带刷新全屏写作层的字数
    editor.addEventListener('input', function () { if (document.getElementById('zen-root')) updateZenCount(); });
    // 标题字数提示（小红书同款）：0/30，超了变橙——软上限，不拦保存
    const titleEl = document.getElementById('c-title');
    const countEl = document.getElementById('c-title-count');
    if (titleEl && countEl) {
      const upd = function () {
        const n = titleEl.value.trim().length;
        countEl.textContent = n + '/30';
        countEl.classList.toggle('warn', n > 30);
      };
      titleEl.addEventListener('input', upd);
      upd();
    }

    try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (err) { /* 忽略 */ }

    editor.addEventListener('paste', function (ev) {
      const items = (ev.clipboardData && ev.clipboardData.items) || [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type && items[i].type.indexOf('image') === 0) {
          ev.preventDefault();
          insertFile(editor, items[i].getAsFile());
          return;
        }
      }
      ev.preventDefault();
      const text = (ev.clipboardData || window.clipboardData).getData('text/plain');
      if (text) document.execCommand('insertText', false, text);
    });

    editor.addEventListener('dragover', function (ev) { ev.preventDefault(); });
    editor.addEventListener('drop', function (ev) {
      const files = ev.dataTransfer && ev.dataTransfer.files;
      if (!files || !files.length) return;
      ev.preventDefault();
      Array.prototype.slice.call(files).reduce(function (p, f) {
        return p.then(function () { return insertFile(editor, f); });
      }, Promise.resolve());
    });

    // 点一下正文里的卡片改值；点图片/视频选中，再用工具栏的「删图」去掉
    editor.addEventListener('click', function (ev) {
      const chip = ev.target && ev.target.closest ? ev.target.closest('.inline-plug') : null;
      if (chip) { editPlugChip(chip); return; }
      const t = ev.target;
      const media = (t && (t.tagName === 'IMG' || t.tagName === 'VIDEO')) ? t : null;
      Array.prototype.forEach.call(editor.querySelectorAll('.img-selected'), function (x) {
        x.classList.remove('img-selected');
      });
      if (media) {
        media.classList.add('img-selected');
        selectedImg = media;
      } else {
        selectedImg = null;
      }
      syncDeleteBtn();
    });
  }

  // 工具栏按钮不能让编辑区失焦，否则 execCommand 无效
  document.addEventListener('mousedown', function (ev) {
    const el = ev.target && ev.target.closest ? ev.target.closest('[data-action]') : null;
    if (!el) return;
    const a = el.getAttribute('data-action');
    if (a === 'c-bold' || a === 'c-italic' || a === 'c-image' || a === 'c-gif' ||
        a === 'c-plug' || a === 'c-video') ev.preventDefault();
  });

  /* ---------------- 供 app.js / backup.js 调用 ---------------- */

  function renderDetailIfAny() {
    return state.detailId ? viewDetail(byId(state.detailId)) : null;
  }

  function snapshot() {
    return { entries: db.entries.slice(), cats: db.cats.slice() };
  }

  // 合并原则：冲突默认保留本地版本，绝不静默覆盖
  function merge(remote, preferRemote) {
    const res = { added: 0, same: 0, conflict: 0, updated: 0 };
    (remote.cats || []).forEach(function (rc) {
      if (!db.cats.some(function (c) { return c.name === rc.name; })) db.cats.push(rc);
    });
    const index = {};
    db.entries.forEach(function (e) { index[e.id] = e; });
    (remote.entries || []).forEach(function (re) {
      const le = index[re.id];
      if (!le) { db.entries.push(re); res.added++; return; }
      if (JSON.stringify(le) === JSON.stringify(re)) { res.same++; return; }
      if (preferRemote) {
        Object.keys(re).forEach(function (k) { le[k] = re[k]; });
        res.updated++;
      } else {
        res.conflict++;
      }
    });
    save();
    return res;
  }

  function handleInput(e) {
    if (e.target.id !== 'c-search') return false;
    state.query = e.target.value;
    const list = document.getElementById('c-list');
    if (list) list.innerHTML = renderListInner();
    return true;
  }

  function handleChange(e) {
    if (e.target.id === 'c-cat' && e.target.value === '__new') {
      const name = newCategory();
      const sel = e.target;
      if (name) {
        if (!Array.prototype.some.call(sel.options, function (o) { return o.value === name; })) {
          const opt = document.createElement('option');
          opt.textContent = name;
          opt.value = name;
          sel.insertBefore(opt, sel.lastElementChild);
        }
        sel.value = name;
      } else {
        sel.selectedIndex = 0;
      }
      return true;
    }
    return false;
  }

  /* 统一的选择器入口：和物品表单用同一套浮层（QYDialog.choose）
     data-target = 隐藏输入 id，data-list = 选项来源（cats / moods），
     data-label = 选完要更新的文字元素 id */
  document.addEventListener('click', function (e) {
    const el = e.target.closest && e.target.closest('[data-action="c-pick"]');
    if (!el) return;
    e.stopPropagation();
    const target = el.getAttribute('data-target');
    const list = el.getAttribute('data-list');
    const labelId = el.getAttribute('data-label');
    const input = document.getElementById(target);
    const options = list === 'cats'
      ? db.cats.map(function (c) { return { v: c.name, t: c.name, e: c.emoji }; })
      : MOODS.map(function (m) { return { v: m, t: m }; });
    if (!window.QYDialog) return;
    window.QYDialog.choose({
      title: el.getAttribute('data-title') || '选择',
      options: options,
      current: input ? input.value : '',
      onPick: function (v) {
        // 写回后派发 input，让全屏编辑页把这次选择记为"有改动"
        if (input) { input.value = v; input.dispatchEvent(new Event('input', { bubbles: true })); }
        const lbl = document.getElementById(labelId);
        if (lbl) lbl.textContent = v;
      }
    });
  }, true);

  window.QYV = {
    renderList: renderList,
    renderDetailIfAny: renderDetailIfAny,
    // 首页加号 / AI 用：直接打开"新增随笔"表单（等于点收藏页的 + ）
    openForm: function () { UI().openFullpage('新增随笔', formHTML(null), { save: { action: 'c-save', label: '保存' } }); initEditor(); },
    clearDetail: function () { state.detailId = null; },
    hasDetail: function () { return !!state.detailId; },
    openDetail: function (id) { state.detailId = id; },
    handleAction: handleAction,
    handleInput: handleInput,
    handleChange: handleChange,
    snapshot: snapshot,
    merge: merge,
    save: save,
    // 给 AI 助手用：直接新增一条随笔（不走表单）。返回新条目 id。
    addEntry: function (p) {
      p = p || {};
      const cat = String(p.cat || '').trim();
      if (cat && !db.cats.some(function (c) { return c.name === cat; })) {
        db.cats.push({ name: cat, emoji: '📁' });   // AI 提到的收藏分类不存在就顺手建
      }
      // 插件值只收认识的键，类型按 App 的约定收口
      const KNOWN = { rating: 'number', price: 'number', mood: 'string', link: 'string' };
      const plugins = (Array.isArray(p.plugins) ? p.plugins : []).filter(function (x) {
        return x && KNOWN[x.k] && x.v != null && x.v !== '';
      }).map(function (x) {
        return { k: x.k, v: KNOWN[x.k] === 'number' ? Number(x.v) : String(x.v) };
      });
      const entry = {
        id: QY.uid('c'),
        title: String(p.title || '未命名').trim() || '未命名',
        cat: cat || (db.cats[0] ? db.cats[0].name : ''),
        date: p.date || QY.iso(QY.today()),
        tags: Array.isArray(p.tags) ? p.tags.map(String).filter(Boolean) : [],
        plugins: plugins,
        bodyHtml: sanitize('<p>' + esc(String(p.body || '').trim() || p.title || '').replace(/\n/g, '</p><p>') + '</p>')
      };
      db.entries.push(entry);
      save();
      return entry.id;
    },
    // 回收站恢复用：整条放回收藏库
    restoreEntry: function (entry) {
      if (!entry || !entry.id) return false;
      if (db.entries.some(function (x) { return x.id === entry.id; })) return false;
      db.entries.push(entry);
      save();
      return true;
    },

    // 给 AI 助手用：按 id 改随笔（字段白名单）与删除随笔
    updateEntry: function (id, patch) {
      const e = db.entries.filter(function (x) { return x.id === id; })[0];
      if (!e) return false;
      patch = patch || {};
      if (patch.title != null) e.title = String(patch.title).trim() || e.title;
      if (patch.cat) e.cat = String(patch.cat);
      if (patch.date) e.date = patch.date;
      if (Array.isArray(patch.tags)) e.tags = patch.tags.map(String).filter(Boolean);
      if (patch.body != null) {
        e.bodyHtml = sanitize('<p>' + esc(String(patch.body).trim()).replace(/\n/g, '</p><p>') + '</p>');
      }
      save();
      return true;
    },
    deleteEntry: function (id) {
      const n = db.entries.length;
      db.entries = db.entries.filter(function (x) { return x.id !== id; });
      save();
      return db.entries.length < n;
    },
    // 给物品模块复用：选一张图（原生可拍照/相册）-> 压缩 -> 回调 dataURL
    // cb(dataUrl, info)，info.bytes 是最终字节数、info.gif 标记动图
    pickImage: function (cb, opts) {
      const handle = function (file) {
        if (!file) { cb(null); return; }
        compressImage(file, opts).then(function (r) {
          cb(r.dataUrl, { bytes: r.after, gif: !!r.gif, kept: r.kept });
        }).catch(function (err) {
          UI().toast('图片处理失败：' + err.message);
          cb(null);
        });
      };
      // 安卓/鸿蒙壳：走原生选择器，才可能调起相机
      if (window.QYPlatform && QYPlatform.pickImage) {
        QYPlatform.pickImage(function (dataUrl) {
          handle(dataUrl ? dataUrlToFile(dataUrl) : null);
        }, (opts && opts.source) || '');
        return;
      }
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.style.display = 'none';
      document.body.appendChild(input);
      input.addEventListener('change', function () {
        const f = input.files && input.files[0];
        input.remove();
        handle(f);
      });
      input.click();
    },

    /* 取动图第一帧，用于"只留静态图"的降级选择 */
    staticFirstFrame: function (dataUrl, cb) {
      try {
        const file = dataUrlToFile(dataUrl);
        compressImage(file, { forceStatic: true }).then(function (r) {
          cb(r.dataUrl);
        }).catch(function () { cb(null); });
      } catch (err) {
        cb(null);
      }
    },
    humanSize: humanSize,
    recent: function (n) {
      return db.entries.slice()
        .sort(function (a, b) { return a.date < b.date ? 1 : -1; })
        .slice(0, n || 3)
        .map(function (e) {
          return {
            id: e.id,
            title: e.title,
            sub: subOf(e),
            date: e.date,
            img: firstImage(e.bodyHtml),
            emoji: catEmoji(e.cat)
          };
        });
    },
    imageBytes: function () {
      let n = 0;
      db.entries.forEach(function (e) {
        const box = document.createElement('div');
        box.innerHTML = e.bodyHtml || '';
        Array.prototype.forEach.call(box.querySelectorAll('img'), function (im) {
          n += bytesOfDataUrl(im.getAttribute('src'));
        });
      });
      return n;
    },
    reset: function () { db = seed(); save(); state.detailId = null; state.cat = '全部'; },
    count: function () { return db.entries.length; },
    // 供页内自检使用
    _test: {
      sanitize: sanitize,
      compressImage: compressImage,
      blocksOf: blocksOf,
      shareText: shareText,
      insertImage: insertImage,
      bytesOfDataUrl: bytesOfDataUrl,
      humanSize: humanSize,
      get: byId
    }
  };
})();
