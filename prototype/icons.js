/* xctally · 线性图标集（SF Symbols 风格）
 * ---------------------------------------------------------------
 * 为什么不用 emoji 当图标：emoji 是"彩色插画"，各平台字形不一，
 * 和整体的 iOS 视觉语言（单色细线 + 克制用色）不搭。
 * 这里统一成 24×24 视框、1.7 描边、圆角端点的单色 SVG，
 * 颜色跟随 currentColor，由使用处决定。
 *
 * 数据层（data.js / notes.js / 备份文件）里存的仍是 emoji 字符串 ——
 * 那是历史格式，动它会破坏老数据；渲染时通过 E2I 表映射成图标，
 * 映射不到的自定义 emoji 原样显示（用户自己的选择，尊重）。
 *
 * 本文件必须在渲染之前加载（platform.js 之后即可）。
 * ---------------------------------------------------------------
 */
(function () {
  'use strict';

  var P = {
    /* 分类 */
    food: '<path d="M9.2 3.5h5.6l3.2 4.2H6z"/><path d="M6.5 7.7h11v10.8a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2z"/><path d="M9.5 13.4c.8-.7 1.7-.7 2.5 0s1.7.7 2.5 0"/>',
    pill: '<g transform="rotate(-45 12 12)"><rect x="4.8" y="8.9" width="14.4" height="6.2" rx="3.1"/><path d="M12 8.9v6.2"/></g>',
    basket: '<path d="M5.6 9.2h12.8l-1.1 9.6a2 2 0 0 1-2 1.7H8.7a2 2 0 0 1-2-1.7z"/><path d="M9 9V7.2a3 3 0 0 1 6 0V9"/>',
    shirt: '<path d="M8.6 3.8 12 5.4l3.4-1.6L20 7.6l-2.6 2.8v10H6.6v-10L4 7.6z"/>',
    laptop: '<rect x="4.6" y="5.4" width="14.8" height="10.2" rx="1.8"/><path d="M3 18.6h18"/>',
    bolt: '<path d="M13.2 2.8 5.6 13.4h5.2l-1 7.8 8-11.2h-5.4z"/>',
    gauge: '<path d="M4.4 16.8a8.4 8.4 0 1 1 15.2 0"/><path d="M12 15.8 16 9.8"/><circle cx="12" cy="16.6" r="1.1" fill="currentColor" stroke="none"/>',
    box: '<path d="M12 3.4 20 7.9v8.2L12 20.6 4 16.1V7.9z"/><path d="M4 7.9l8 4.5 8-4.5"/><path d="M12 12.4v8.2"/>',
    tag: '<path d="M11.2 3.6H19a1.4 1.4 0 0 1 1.4 1.4v7.8L11.6 21.6a1.6 1.6 0 0 1-2.3 0L2.4 14.7a1.6 1.6 0 0 1 0-2.3z"/><circle cx="15.8" cy="8.2" r="1.1"/>',
    gift: '<rect x="4.4" y="10.6" width="15.2" height="9" rx="1.6"/><path d="M3.6 7.6h16.8v3H3.6z"/><path d="M12 7.6v12"/><circle cx="9.5" cy="5.9" r="1.5"/><circle cx="14.5" cy="5.9" r="1.5"/>',
    wrench: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.1L4.6 16a2 2 0 1 0 2.8 2.8l4.7-4.7a4 4 0 0 0 5.1-5.4l-2.5 2.5-2.5-.7-.7-2.5z"/>',
    book: '<path d="M12 6.8C10.2 5.2 7.8 4.4 4.8 4.4v13c3 0 5.4.8 7.2 2.4 1.8-1.6 4.2-2.4 7.2-2.4v-13c-3 0-5.4.8-7.2 2.4z"/><path d="M12 6.8v13"/>',
    music: '<path d="M9.4 17.6V6.2l9-1.8v11.4"/><circle cx="7.1" cy="17.6" r="2.3"/><circle cx="16.1" cy="15.8" r="2.3"/>',
    palette: '<path d="M12 3.6a8.4 8.4 0 0 0 0 16.8c1.3 0 2-.7 2-1.7 0-.9-.6-1.4-.6-2.2 0-.9.7-1.6 1.7-1.6h1.5c2.1 0 3.8-1.7 3.8-3.9C20.4 6.8 16.7 3.6 12 3.6z"/><circle cx="8.2" cy="10.6" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="16" cy="10.6" r="1" fill="currentColor" stroke="none"/>',
    plug: '<path d="M9 3.6v4.8M15 3.6v4.8"/><path d="M6.6 8.4h10.8v3.2a5.4 5.4 0 0 1-10.8 0z"/><path d="M12 17v3.4"/>',
    watch: '<rect x="7.6" y="6.6" width="8.8" height="10.8" rx="2.6"/><path d="M9.4 6.6 9.9 3h4.2l.5 3.6M9.4 17.4l.5 3.6h4.2l.5-3.6"/>',
    leaf: '<path d="M5.2 18.8C5.2 10.4 10.4 5.2 18.8 5.2c0 8.4-5.2 13.6-13.6 13.6z"/><path d="M5.2 18.8C7.8 13 11.6 9.2 17 7"/>',
    spray: '<rect x="8" y="9" width="8" height="11.4" rx="2"/><path d="M10 9V7.2a1.6 1.6 0 0 1 1.6-1.6h.8A1.6 1.6 0 0 1 14 7.2V9"/><path d="M16.6 4.2h2.8M18 2.8V5.6"/>',
    folder: '<path d="M3.6 7.6a2 2 0 0 1 2-2h3.6l2 2.4h7.2a2 2 0 0 1 2 2v8.4a1.6 1.6 0 0 1-1.6 1.6H5.2a1.6 1.6 0 0 1-1.6-1.6z"/>',
    cookie: '<circle cx="12" cy="12" r="7.6"/><circle cx="9.6" cy="10.2" r=".65" fill="currentColor" stroke="none"/><circle cx="13.8" cy="9.4" r=".65" fill="currentColor" stroke="none"/><circle cx="12" cy="13.4" r=".65" fill="currentColor" stroke="none"/><circle cx="14.8" cy="13.2" r=".65" fill="currentColor" stroke="none"/>',
    film: '<rect x="3.4" y="6" width="17.2" height="12" rx="2.4"/><path d="M10.4 9.6l4.8 2.4-4.8 2.4z"/>',
    bike: '<circle cx="6.7" cy="16.4" r="3.1"/><circle cx="17.3" cy="16.4" r="3.1"/><path d="M6.7 16.4 10 9.8h4.6l2.7 6.6M10 9.8 8.4 6.8H6M14.6 9.8l1.8-3h2.2"/>',
    bulb: '<path d="M12 3.6a5.6 5.6 0 0 1 3.3 10.1c-.6.5-.9 1.1-.9 1.9h-4.8c0-.8-.3-1.4-.9-1.9A5.6 5.6 0 0 1 12 3.6z"/><path d="M9.9 18.2h4.2M10.6 20.6h2.8"/>',
    chat: '<path d="M12 4.4c-4.6 0-8.4 3-8.4 6.8 0 2.1 1.2 4 3 5.3-.2 1.1-.8 2.2-1.7 3.1 1.8-.3 3.4-1 4.5-2 .9.2 1.7.3 2.6.3 4.6 0 8.4-3 8.4-6.7S16.6 4.4 12 4.4z"/>',
    checkcircle: '<circle cx="12" cy="12" r="8.4"/><path d="M8.4 12.4l2.4 2.4 4.8-5.2"/>',
    lockopen: '<path d="M8 10.6V7.8a4 4 0 0 1 7.9-.9"/><rect x="5.8" y="10.6" width="12.4" height="9" rx="2.2"/>',
    cycle: '<path d="M19.6 12a7.6 7.6 0 1 1-2.2-5.4"/><path d="M19.8 3.4v3.8H16"/>',
    shareup: '<path d="M7.2 16.8 16.8 7.2"/><path d="M9.8 7.2h7v7"/>',
    uturn: '<path d="M8.6 14.8 4.4 10.6 8.6 6.4"/><path d="M4.4 10.6h9.2a5.2 5.2 0 0 1 0 10.4H9.6"/>',
    trash: '<path d="M3.6 6.4h16.8M8.4 6.4V4.6a1 1 0 0 1 1-1h5.2a1 1 0 0 1 1 1v1.8M6 6.4l1 13.6h10l1-13.6"/><path d="M10 11v6M14 11v6"/>',
    drop: '<path d="M12 3.5C9 8 6 11 6 14.5a6 6 0 0 0 12 0C18 11 15 8 12 3.5z"/>',
    flame: '<path d="M12 3.5c.8 2.4 4.5 4.2 4.5 8a4.5 4.5 0 1 1-9 0c0-1.6.7-2.9 1.6-4 .2 1 .8 1.8 1.6 2.2C10.5 7.6 11.3 5.6 12 3.5z"/>',
    sparkle: '<path d="M12 3.2l1.9 5 5 1.9-5 1.9-1.9 5-1.9-5-5-1.9 5-1.9z"/><path d="M18.8 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
    /* 详情操作菜单（随笔：复制 / 长图 / 编辑） */
    copy: '<rect x="8.6" y="8.6" width="11" height="11" rx="2.2"/><path d="M5.4 15.4h-.8a1.6 1.6 0 0 1-1.6-1.6V5.4a1.6 1.6 0 0 1 1.6-1.6h8.4a1.6 1.6 0 0 1 1.6 1.6v.8"/>',
    pencil: '<path d="M4.4 19.6l1-4.2L15.8 5a2 2 0 0 1 2.8 2.8L8.2 18.2z"/><path d="M13.6 7.2l2.8 2.8"/>',
    image: '<rect x="3.6" y="4.6" width="16.8" height="14.8" rx="2.4"/><circle cx="9" cy="9.6" r="1.3"/><path d="M4.6 16.8l4.2-4c.7-.7 1.8-.7 2.5 0l2.6 2.5M13 14.4l1.8-1.7c.7-.7 1.8-.7 2.5 0l2.1 2"/>',
    check: '<path d="M5 12.6l4.4 4.4L19 7.4"/>',
    photoadd: '<rect x="3.4" y="6" width="14" height="13.4" rx="2.4"/><circle cx="7.4" cy="10" r="1.1"/><path d="M4.4 16.2l3-2.8c.6-.6 1.6-.6 2.2 0l2 1.9"/><path d="M10.4 14.2l1.5-1.4c.6-.6 1.5-.6 2.1 0l1.6 1.5"/><path d="M18.6 2.6v4.2M16.5 4.7h4.2"/>',
    timeline: '<path d="M4 6.5h10M4 12h16M4 17.5h7"/><circle cx="18" cy="6.5" r="1.6"/><circle cx="15" cy="17.5" r="1.6"/>',
    bell: '<path d="M12 4.2a5.4 5.4 0 0 1 5.4 5.4c0 3.4.8 4.9 1.6 5.8H5c.8-.9 1.6-2.4 1.6-5.8A5.4 5.4 0 0 1 12 4.2z"/><path d="M10.2 18.6a1.9 1.9 0 0 0 3.6 0"/>',
    more: '<circle cx="5.4" cy="12" r="1.35" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.35" fill="currentColor" stroke="none"/><circle cx="18.6" cy="12" r="1.35" fill="currentColor" stroke="none"/>'
  };

  /* emoji → 图标名。键值已去掉变体选择符（\uFE0F） */
  var E2I = {
    '🥛': 'food', '🍪': 'cookie', '🍞': 'food', '🥣': 'food',
    '💊': 'pill',
    '🧺': 'basket', '🧴': 'spray',
    '🧣': 'shirt', '👟': 'shirt',
    '💻': 'laptop', '❄️': 'laptop', '🫖': 'laptop',
    '⚡️': 'bolt', '⚡': 'bolt',
    '📦': 'box', '🎀': 'tag', '🏷': 'tag', '🎁': 'gift', '🧩': 'tag',
    '🔧': 'wrench', '🧯': 'tag', '🪥': 'tag', '🧸': 'tag',
    '📚': 'book', '🎨': 'palette', '🎵': 'music', '⌚️': 'watch', '⌚': 'watch',
    '🔌': 'plug', '🪴': 'leaf',
    '🌿': 'leaf', '🎬': 'film', '🚲': 'bike', '💡': 'bulb',
    '📁': 'folder', '🗂': 'folder',
    '💬': 'chat', '✅': 'checkcircle',
    '💧': 'drop', '🔥': 'flame',
    '☂️': 'drop', '☂': 'drop'
  };

  /* 流水事件类型 → 图标名 */
  var EV = {
    acquired: 'box', opened: 'lockopen', used: 'checkcircle',
    repaired: 'wrench', replaced: 'cycle', lent: 'shareup',
    returned: 'uturn', disposed: 'trash', reading: 'gauge'
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function svg(name, size, sw) {
    var p = P[name];
    if (!p) return '';
    size = size || 20;
    return '<svg class="qi" viewBox="0 0 24 24" width="' + size + '" height="' + size +
      '" fill="none" stroke="currentColor" stroke-width="' + (sw || 1.7) +
      '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>';
  }

  /* emoji → 图标；映射不到的（用户自定义分类）原样返回 emoji */
  function forEmoji(e, size) {
    if (!window.QYIcon) return esc(e);
    var key = String(e == null ? '' : e).replace(/\uFE0F/g, '').trim();
    var n = E2I[key];
    return n ? svg(n, size) : esc(e);
  }

  function forEvent(type, size) {
    return svg(EV[type] || 'box', size);
  }

  window.QYIcon = { svg: svg, forEmoji: forEmoji, forEvent: forEvent };
})();
