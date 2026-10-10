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
    }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  }

  function tileStyle(e) {
    const img = firstImage(e.bodyHtml);
    if (img) return 'background-image:url(' + img + ');background-size:cover;background-position:center';
    return 'background:linear-gradient(150deg,#E7ECF5,#C9D6E8)';
  }
  function tileInner(e) {
    return firstImage(e.bodyHtml) ? '' : catEmoji(e.cat);
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
    if (!list.length) return '<div class="empty"><div class="emoji">🗂</div><p>这里还没有内容</p></div>';
    return list.map(rowHTML).join('');
  }

  function renderList() {
    const chips = ['全部'].concat(db.cats.map(function (c) { return c.name; })).map(function (c) {
      const emoji = c === '全部' ? '' : catEmoji(c) + ' ';
      return '<button class="chip ' + (state.cat === c ? 'active' : '') +
        '" data-action="c-chip" data-cat="' + esc(c) + '">' + emoji + esc(c) + '</button>';
    }).join('');

    const recent = db.entries.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }).slice(0, 6);
    const strip = recent.map(function (e) {
      return '<div class="cover-card" data-action="c-detail" data-id="' + e.id + '">' +
        '<div class="cc-emoji" style="' + tileStyle(e) + '">' + tileInner(e) + '</div>' +
        '<div class="cc-title">' + esc(e.title) + '</div>' +
      '</div>';
    }).join('');

    return '' +
      UI().pageHead('收藏', db.entries.length + ' 条随笔 · ' + db.cats.length + ' 个自定义分类',
        UI().iconBtn('c-add', '新增收藏')) +
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
      : '<div class="hero-cover" style="background:linear-gradient(150deg,#E7ECF5,#C9D6E8)">' + catEmoji(e.cat) + '</div>';

    const meta = [];
    if (e.cat) meta.push(catEmoji(e.cat) + ' ' + e.cat);
    meta.push(QY.fmtDate(e.date));
    const n = imageCount(e.bodyHtml);
    if (n) meta.push(n + ' 张图');

    const tags = (e.tags && e.tags.length)
      ? '<div class="section"><div class="section-head"><h2>标签</h2></div><div class="tag-row">' +
        e.tags.map(function (x) { return '<span class="tag">#' + esc(x) + '</span>'; }).join('') + '</div></div>'
      : '';

    return '' +
      '<div class="navbar"><button class="back" data-action="c-back">‹ 收藏</button></div>' +
      cover +
      '<div style="padding:18px 4px 0">' +
        '<h1 style="margin:0;font-size:25px;font-weight:700;letter-spacing:-0.025em">' + esc(e.title) + '</h1>' +
        '<p style="margin:6px 0 0;font-size:13px;color:var(--label-2)">' + esc(meta.join(' · ')) + '</p>' +
      '</div>' +
      pluginView(e) +
      '<div class="card" style="margin-top:16px"><div class="rich-body">' + (e.bodyHtml || '<p style="color:var(--label-3)">还没有正文</p>') + '</div></div>' +
      tags +
      '<div class="section">' +
        '<div class="sheet-actions" style="flex-wrap:wrap">' +
          '<button class="btn plain" data-action="c-copy" data-id="' + e.id + '">复制文案</button>' +
          '<button class="btn primary" data-action="c-long" data-id="' + e.id + '">生成长图</button>' +
          '<button class="btn plain" data-action="c-edit" data-id="' + e.id + '">编辑</button>' +
          '<button class="btn plain" data-action="c-del" data-id="' + e.id + '" style="color:var(--red)">删除</button>' +
        '</div>' +
      '</div>';
  }

  /* ---------------- 富文本：净化 / 编辑 ---------------- */

  const ALLOWED = { P: 1, BR: 1, STRONG: 1, EM: 1, B: 1, I: 1, IMG: 1 };
  // 这些标签必须整块删掉，不能只拆标签 —— 否则 <script>alert(1)</script>
  // 会被"拆"成正文里的 alert(1) 文本
  const DROP_WHOLE = { SCRIPT: 1, STYLE: 1, IFRAME: 1, OBJECT: 1, EMBED: 1, NOSCRIPT: 1, TEMPLATE: 1, SVG: 1, MATH: 1 };

  // 只保留 p / br / strong / em / img，其余标签拆掉、属性删掉
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

  function insertImage(editor, dataUrl) {
    editor.focus();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !editor.contains(sel.anchorNode)) {
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    document.execCommand('insertImage', false, dataUrl);
    Array.prototype.forEach.call(editor.querySelectorAll('img'), function (im) {
      im.setAttribute('alt', im.getAttribute('alt') || '图片');
    });
  }

  function pickImage(editor) {
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

  /* ---------------- 表单 ---------------- */

  let editingId = null;
  let placeCoord = { lat: null, lng: null };

  function catOptions(selected) {
    return db.cats.map(function (c) {
      return '<option' + (c.name === selected ? ' selected' : '') + '>' + esc(c.name) + '</option>';
    }).join('') + '<option value="__new">＋ 新建分类…</option>';
  }

  function pluginFieldHTML(k, v) {
    const p = PLUGINS[k];
    let inner = '';
    if (k === 'rating') {
      inner = '<div class="stars pick" id="p-rating" data-k="rating">' +
        [1, 2, 3, 4, 5].map(function (i) {
          return '<span data-action="c-star" data-v="' + i + '" class="' +
            (v && i <= v ? 'on' : '') + '">' + (v && i <= v ? '★' : '☆') + '</span>';
        }).join('') + '</div>';
    } else if (k === 'price') {
      inner = '<input class="input" id="p-price" type="number" step="0.1" placeholder="12.9" value="' +
        (v != null ? v : '') + '" />';
    } else if (k === 'place') {
      inner = '<div style="display:flex;gap:10px">' +
        '<input class="input" id="p-place" placeholder="武汉 · 东湖绿道" value="' +
          esc(v && v.name ? v.name : '') + '" />' +
        '<button class="btn plain" data-action="c-locate" style="flex:none;border-radius:var(--r-sm);padding:0 14px">定位</button>' +
        '</div><div class="mini-foot" id="p-coord" style="margin-top:6px">' +
        (placeCoord.lat ? '已定位 ' + placeCoord.lat.toFixed(4) + ', ' + placeCoord.lng.toFixed(4) : '未取坐标（可只写地点名）') +
        '</div>';
    } else if (k === 'link') {
      inner = '<input class="input" id="p-link" placeholder="https://" value="' + esc(v || '') + '" />';
    } else if (k === 'mood') {
      inner = '<select class="select" id="p-mood">' + MOODS.map(function (m) {
        return '<option' + (m === v ? ' selected' : '') + '>' + m + '</option>';
      }).join('') + '</select>';
    }
    return '<div class="field plugin-field" data-plugin="' + k + '">' +
      '<label>' + p.icon + ' ' + p.name +
        '<button class="plugin-remove" data-action="c-remove-plugin" data-k="' + k + '" title="移除">×</button>' +
      '</label>' + inner + '</div>';
  }

  function formHTML(entry) {
    editingId = entry ? entry.id : null;
    placeCoord = { lat: null, lng: null };
    const e = entry || { title: '', cat: (db.cats[0] && db.cats[0].name), date: QY.iso(QY.today()), tags: [], plugins: [], bodyHtml: '' };
    if (entry) {
      const pl = plug(entry, 'place');
      if (pl && pl.v) placeCoord = { lat: pl.v.lat, lng: pl.v.lng };
    }

    const addChips = PLUGIN_KEYS.filter(function (k) {
      return !(e.plugins || []).some(function (p) { return p.k === k; });
    }).map(function (k) {
      return '<button class="chip small" data-action="c-add-plugin" data-k="' + k + '">' +
        PLUGINS[k].icon + ' ' + PLUGINS[k].name + '</button>';
    }).join('');

    const fields = (e.plugins || []).map(function (p) {
      return pluginFieldHTML(p.k, p.v);
    }).join('');

    return '' +
      '<div class="sheet">' +
        '<div class="grabber"></div>' +
        '<h3>' + (entry ? '编辑随笔' : '新增随笔') + '</h3>' +
        '<p class="hint">正文可以插图片和动图；下面的插件想加就加</p>' +

        '<div class="field"><label>标题</label>' +
          '<input id="c-title" class="input" placeholder="例如：第一次自己做手冲" value="' +
            esc(e.title) + '" autocomplete="off" /></div>' +

        '<div class="field-row">' +
          '<div class="field"><label>分类</label>' +
            '<select id="c-cat" class="select">' + catOptions(e.cat) + '</select></div>' +
          '<div class="field"><label>日期</label>' +
            '<input id="c-date" class="input" type="date" value="' + e.date + '" /></div>' +
        '</div>' +

        '<div class="field"><label>插件</label>' +
          '<div class="plugin-box">' +
            '<div id="plugin-fields">' + fields + '</div>' +
            (addChips ? '<div class="chip-row" id="plugin-add">' + addChips + '</div>'
                      : '<div class="mini-foot">所有插件都加上了</div>') +
          '</div>' +
        '</div>' +

        '<div class="field"><label>随笔正文</label>' +
          '<div class="editor-toolbar">' +
            '<button data-action="c-bold" title="加粗"><b>B</b></button>' +
            '<button data-action="c-italic" title="斜体"><i>I</i></button>' +
            '<span class="tb-sep"></span>' +
            '<button data-action="c-image" title="插入图片">🖼 图片</button>' +
            '<button data-action="c-gif" title="插入动图（GIF 不压缩）">✨ 动图</button>' +
            '<span class="tb-sep"></span>' +
            '<button data-action="c-del-img" title="删除选中的图片" class="tb-danger">删图</button>' +
          '</div>' +
          '<div id="c-body" class="rich-editor" contenteditable="true" ' +
            'data-placeholder="写点什么…可以直接把图片拖进来，或粘贴截图">' + (e.bodyHtml || '') + '</div>' +
          '<div class="mini-foot" style="margin-top:6px">图片自动压到长边 1600px 并重编码（顺带清掉 EXIF/GPS）· 动图保持原样</div>' +
        '</div>' +

        '<div class="field"><label>标签（用空格分隔）</label>' +
          '<input id="c-tags" class="input" placeholder="咖啡 日常" value="' + esc((e.tags || []).join(' ')) + '" /></div>' +

        '<div class="sheet-actions">' +
          '<button class="btn plain" data-action="c-close">取消</button>' +
          '<button class="btn primary" data-action="c-save">' + (entry ? '保存修改' : '保存') + '</button>' +
        '</div>' +
      '</div>';
  }

  function setStars(v) {
    const box = document.getElementById('p-rating');
    if (!box) return;
    Array.prototype.forEach.call(box.children, function (el) {
      const on = Number(el.getAttribute('data-v')) <= v;
      el.textContent = on ? '★' : '☆';
      el.className = on ? 'on' : '';
    });
  }
  function currentStars() {
    const box = document.getElementById('p-rating');
    if (!box) return 0;
    return box.querySelectorAll('span.on').length;
  }

  function readPlugins() {
    const out = [];
    Array.prototype.forEach.call(document.querySelectorAll('#plugin-fields .plugin-field'), function (f) {
      const k = f.getAttribute('data-plugin');
      if (k === 'rating') {
        const v = currentStars();
        if (v) out.push({ k: k, v: v });
      } else if (k === 'price') {
        const el = document.getElementById('p-price');
        if (el && el.value !== '') out.push({ k: k, v: Number(el.value) });
      } else if (k === 'place') {
        const el = document.getElementById('p-place');
        const name = el ? el.value.trim() : '';
        if (name || placeCoord.lat) out.push({ k: k, v: { name: name, lat: placeCoord.lat, lng: placeCoord.lng } });
      } else if (k === 'link') {
        const el = document.getElementById('p-link');
        if (el && el.value.trim()) out.push({ k: k, v: el.value.trim() });
      } else if (k === 'mood') {
        const el = document.getElementById('p-mood');
        if (el) out.push({ k: k, v: el.value });
      }
    });
    return out;
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
      plugins: readPlugins(),
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
        g.font = '110px ' + FONT;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(catEmoji(e.cat), IMG_W / 2, coverH / 2 + PAD / 2);
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

  function locate() {
    const box = document.getElementById('p-coord');
    if (!navigator.geolocation) { UI().toast('这个环境不支持定位'); return; }
    if (box) box.textContent = '定位中…';
    navigator.geolocation.getCurrentPosition(function (pos) {
      placeCoord = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      if (box) box.textContent = '已定位 ' + placeCoord.lat.toFixed(4) + ', ' + placeCoord.lng.toFixed(4);
      UI().toast('已获取当前位置');
    }, function () {
      if (box) box.textContent = '拿不到定位（本地文件打开时浏览器会拒绝）';
    }, { timeout: 6000 });
  }

  function addPlugin(k) {
    const wrap = document.getElementById('plugin-fields');
    if (!wrap) return;
    const div = document.createElement('div');
    div.innerHTML = pluginFieldHTML(k, k === 'rating' ? 0 : '');
    const node = div.firstChild;
    wrap.appendChild(node);
    const chip = document.querySelector('#plugin-add [data-k="' + k + '"]');
    if (chip) chip.remove();
    if (!document.querySelector('#plugin-add .chip')) {
      const row = document.getElementById('plugin-add');
      if (row) row.outerHTML = '<div class="mini-foot">所有插件都加上了</div>';
    }
  }

  function removePlugin(k) {
    const f = document.querySelector('#plugin-fields .plugin-field[data-plugin="' + k + '"]');
    if (f) f.remove();
    const add = document.getElementById('plugin-add');
    if (add && !document.querySelector('#plugin-add [data-k="' + k + '"]')) {
      const b = document.createElement('button');
      b.className = 'chip small';
      b.setAttribute('data-action', 'c-add-plugin');
      b.setAttribute('data-k', k);
      b.textContent = PLUGINS[k].icon + ' ' + PLUGINS[k].name;
      add.appendChild(b);
    } else if (!add) {
      const box = document.querySelector('.plugin-box');
      if (box) {
        const row = document.createElement('div');
        row.className = 'chip-row';
        row.id = 'plugin-add';
        row.innerHTML = '<button class="chip small" data-action="c-add-plugin" data-k="' + k + '">' +
          PLUGINS[k].icon + ' ' + PLUGINS[k].name + '</button>';
        box.appendChild(row);
      }
    }
  }

  function handleAction(action, el) {
    if (action.indexOf('c-') !== 0) return false;
    const id = el.getAttribute('data-id');

    if (action === 'c-add') {
      UI().openSheet(formHTML(null));
      initEditor();
    } else if (action === 'c-edit') {
      UI().openSheet(formHTML(byId(id)));
      initEditor();
    } else if (action === 'c-add-plugin') {
      addPlugin(el.getAttribute('data-k'));
    } else if (action === 'c-remove-plugin') {
      removePlugin(el.getAttribute('data-k'));
    } else if (action === 'c-star') {
      setStars(Number(el.getAttribute('data-v')));
    } else if (action === 'c-locate') {
      locate();
    } else if (action === 'c-bold') {
      document.execCommand('bold');
    } else if (action === 'c-italic') {
      document.execCommand('italic');
    } else if (action === 'c-image' || action === 'c-gif') {
      const editor = document.getElementById('c-body');
      if (editor) pickImage(editor);
    } else if (action === 'c-del-img') {
      if (!selectedImg || !selectedImg.parentNode) { UI().toast('先点一下正文里的图片'); return true; }
      selectedImg.parentNode.removeChild(selectedImg);
      selectedImg = null;
      syncDeleteBtn();
      UI().toast('已删除这张图片');
    } else if (action === 'c-close') {
      editingId = null;
      UI().closeSheet();
    } else if (action === 'c-save') {
      saveForm();
    } else if (action === 'c-detail') {
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
      if (!window.confirm('删除「' + e.title + '」？此操作不可撤销。')) return true;
      db.entries = db.entries.filter(function (x) { return x.id !== id; });
      save();
      state.detailId = null;
      UI().mount();
      UI().toast('已删除');
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

    // 点一下正文里的图片可以选中，再用工具栏的「删图」把它去掉
    editor.addEventListener('click', function (ev) {
      const im = ev.target && ev.target.tagName === 'IMG' ? ev.target : null;
      Array.prototype.forEach.call(editor.querySelectorAll('img.img-selected'), function (x) {
        x.classList.remove('img-selected');
      });
      if (im) {
        im.classList.add('img-selected');
        selectedImg = im;
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
    if (a === 'c-bold' || a === 'c-italic' || a === 'c-image' || a === 'c-gif') ev.preventDefault();
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

  window.QYV = {
    renderList: renderList,
    renderDetailIfAny: renderDetailIfAny,
    clearDetail: function () { state.detailId = null; },
    hasDetail: function () { return !!state.detailId; },
    openDetail: function (id) { state.detailId = id; },
    handleAction: handleAction,
    handleInput: handleInput,
    handleChange: handleChange,
    snapshot: snapshot,
    merge: merge,
    save: save,
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
