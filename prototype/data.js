/* xcnote · 数据层（原型）
 * ---------------------------------------------------------------
 * 两个核心实体：
 *   Item  —— 我拥有 / 记录的「一样东西」
 *   Event —— 发生在这件东西上的「一件事」（获得/开封/维修/更换/借出/处置/抄表）
 *
 * 设计要点：
 *   1. 「我有什么」是底座，保质期、日均成本、能源都只是挂在 Item 上的可选规则
 *   2. 派生指标（持有天数 / 日均成本 / 单次成本 / 临期天数）全部实时算，不落库
 *   3. 真实持有成本 = 购买价 + 维修 + 配件耗材 - 处置回收，所以需要 Event 流水
 * ---------------------------------------------------------------
 */
(function (global) {
  'use strict';

  const DAY = 86400000;

  /* ---------------- 字典 ---------------- */

  const CATEGORIES = {
    '食品': { emoji: '🥛', g: ['#FFE7C2', '#FFC46B'] },
    '药品': { emoji: '💊', g: ['#FFD9DC', '#FF9AA2'] },
    '日用': { emoji: '🧺', g: ['#D9E8FF', '#9CC2FF'] },
    '服饰': { emoji: '🧣', g: ['#E6DEFF', '#B6A4FF'] },
    '电子': { emoji: '💻', g: ['#D6F3EA', '#84DCC0'] },
    '表具': { emoji: '⚡️', g: ['#FFF1C9', '#FFD666'] },
    '其他': { emoji: '📦', g: ['#ECECF1', '#CFCFD8'] }
  };
  const CATEGORY_NAMES = Object.keys(CATEGORIES);

  const SOURCES = ['商店购买', '网购', '超市', '菜市场', '他人赠送', '中奖获得', '积分兑换', '二手购入', '自制'];

  const STATUSES = ['在用', '闲置', '借出', '已开封', '已用完', '已处置'];

  const UNITS = ['个', '件', '瓶', '盒', '袋', '台', '把', '套', '双', '张'];

  const EVENT_TYPES = {
    acquired: { label: '获得', emoji: '📦' },
    opened: { label: '开封', emoji: '🔓' },
    used: { label: '使用', emoji: '✅' },
    repaired: { label: '维修', emoji: '🔧' },
    replaced: { label: '更换', emoji: '🔁' },
    lent: { label: '借出', emoji: '🤝' },
    returned: { label: '归还', emoji: '↩️' },
    disposed: { label: '处置', emoji: '🗑' },
    reading: { label: '抄表', emoji: '📟' }
  };

  /* ---------------- 日期工具 ---------------- */

  function startOfDay(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }
  function today() {
    return startOfDay(new Date());
  }
  function parseDate(s) {
    if (!s) return null;
    const p = String(s).split('-').map(Number);
    return new Date(p[0], (p[1] || 1) - 1, p[2] || 1);
  }
  function iso(d) {
    const x = startOfDay(d);
    const m = String(x.getMonth() + 1).padStart(2, '0');
    const day = String(x.getDate()).padStart(2, '0');
    return x.getFullYear() + '-' + m + '-' + day;
  }
  function addDays(n) {
    return iso(new Date(today().getTime() + n * DAY));
  }
  function dayDiff(a, b) {
    return Math.round((startOfDay(b) - startOfDay(a)) / DAY);
  }
  function fmtDate(s) {
    return s ? String(s).replace(/-/g, '.') : '—';
  }
  function fmtMonth(m) {
    const p = String(m).split('-');
    return p[0].slice(2) + '.' + p[1];
  }
  function fmtCN(s) {
    const d = parseDate(s);
    return d ? (d.getMonth() + 1) + '月' + d.getDate() + '日' : '—';
  }

  /* ---------------- 格式化 ---------------- */

  function fmtNum(n, digits) {
    if (n == null || isNaN(n)) return '—';
    const d = digits == null ? 1 : digits;
    return Number(n).toFixed(d);
  }
  function fmtMoney(n) {
    if (n == null || isNaN(n)) return '—';
    const abs = Math.abs(n);
    if (abs >= 10000) {
      const w = n / 10000;
      return '¥' + (abs >= 100000 ? w.toFixed(1) : w.toFixed(2)) + '万';
    }
    return '¥' + n.toFixed(2);
  }
  // 日均成本这种小数字用更细的精度
  function fmtRate(n) {
    if (n == null || isNaN(n)) return '—';
    if (Math.abs(n) < 0.1) return '¥' + n.toFixed(3);
    return '¥' + n.toFixed(2);
  }

  /* ---------------- 派生指标 ---------------- */

  function costOf(item, data) {
    let c = item.cost == null ? 0 : Number(item.cost);
    if (data && data.events) {
      data.events.forEach(function (e) {
        if (e.itemId === item.id && (e.type === 'repaired' || e.type === 'replaced') && e.amount) {
          c += Number(e.amount);
        }
        if (e.itemId === item.id && e.type === 'disposed' && e.amount) {
          c -= Number(e.amount);
        }
      });
    }
    return c;
  }
  function heldDays(item) {
    return Math.max(1, dayDiff(parseDate(item.acquiredAt), today()) + 1);
  }
  function perDay(item, data) {
    if (item.cost == null) return null;
    return costOf(item, data) / heldDays(item);
  }
  function daysLeft(item) {
    return item.expiresAt ? dayDiff(today(), parseDate(item.expiresAt)) : null;
  }
  // 提醒分级：0=已过期 1=紧急(<=3天) 2=注意(<=7天) 3=留意(<=30天)
  function expiryLevel(item) {
    const d = daysLeft(item);
    if (d == null) return null;
    if (d < 0) return 0;
    if (d <= 3) return 1;
    if (d <= 7) return 2;
    if (d <= 30) return 3;
    return null;
  }
  function isExpired(item) {
    const d = daysLeft(item);
    return d != null && d < 0 && item.status !== '已处置' && item.status !== '已用完';
  }
  function isActive(item) {
    return item.status !== '已处置' && item.status !== '已用完';
  }
  function iconOf(item) {
    return item.icon || (CATEGORIES[item.category] || CATEGORIES['其他']).emoji;
  }
  function colorOf(item) {
    return (CATEGORIES[item.category] || CATEGORIES['其他']).g;
  }
  function titleOf(item) {
    return item.sub ? item.category + ' · ' + item.sub : item.category;
  }
  function eventsOf(data, itemId) {
    return data.events
      .filter(function (e) { return e.itemId === itemId; })
      .sort(function (a, b) { return a.at < b.at ? 1 : -1; });
  }

  /* ---------------- 首页汇总 ---------------- */

  function summaries(data) {
    const items = data.items;
    const active = items.filter(isActive);

    // 已经浪费掉的钱：过期且未处置的物品成本合计
    const expired = items.filter(isExpired);
    const wasted = expired.reduce(function (s, it) { return s + (it.cost || 0); }, 0);

    // 全部在用物品的日均成本合计
    let daily = 0;
    active.forEach(function (it) {
      const p = perDay(it, data);
      if (p) daily += p;
    });

    // 能源本月支出
    let energy = 0;
    let energyTrend = 0;
    (data.meters || []).forEach(function (m) {
      energy += m.current.cost;
      energyTrend += m.current.trend;
    });
    energyTrend = data.meters && data.meters.length ? energyTrend / data.meters.length : 0;

    // 临期（30 天内，含已过期）
    const expiring = items
      .filter(function (it) { return isActive(it) && expiryLevel(it) != null; })
      .sort(function (a, b) { return daysLeft(a) - daysLeft(b); });

    // 最近添加
    const recent = items.slice().sort(function (a, b) {
      return a.acquiredAt < b.acquiredAt ? 1 : -1;
    }).slice(0, 4);

    return {
      count: active.length,
      wasted: wasted,
      wastedCount: expired.length,
      daily: daily,
      energy: energy,
      energyTrend: energyTrend,
      expiring: expiring,
      recent: recent,
      totalSpend: items.reduce(function (s, it) { return s + (it.cost || 0); }, 0)
    };
  }

  /* ---------------- 种子数据 ---------------- */

  function seed() {
    const D = addDays;
    const items = [
      {
        id: 'it_faqia', name: '发卡', icon: '🎀', category: '日用', sub: '装饰',
        acquiredAt: '2026-03-16', source: '商店购买', cost: 9.9, qty: 1, unit: '个',
        status: '在用', location: '卧室抽屉', expiresAt: null, openedAt: null, warrantyUntil: null, note: ''
      },
      {
        id: 'it_milk', name: '纯牛奶', icon: '🥛', category: '食品', sub: '生鲜',
        acquiredAt: D(-7), source: '超市', cost: 15.9, qty: 2, unit: '瓶',
        status: '在用', location: '冰箱冷藏', expiresAt: D(3), openedAt: null, warrantyUntil: null, note: ''
      },
      {
        id: 'it_ibu', name: '布洛芬缓释胶囊', icon: '💊', category: '药品', sub: '内服',
        acquiredAt: '2026-06-12', openedAt: D(-65), source: '网购', cost: 25.8, qty: 1, unit: '盒',
        status: '已开封', location: '药箱', expiresAt: D(15), warrantyUntil: null,
        note: '开封后建议 6 个月内用完'
      },
      {
        id: 'it_filter', name: '净水器滤芯', icon: '🧴', category: '日用', sub: '耗材',
        acquiredAt: D(-178), source: '网购', cost: 189, qty: 1, unit: '个',
        status: '在用', location: '厨房水槽下', expiresAt: D(21), openedAt: null, warrantyUntil: null, note: ''
      },
      {
        id: 'it_ac', name: '空调', icon: '❄️', category: '电子', sub: '家电',
        acquiredAt: '2025-11-11', source: '网购', cost: 3299, qty: 1, unit: '台',
        status: '在用', location: '客厅', expiresAt: null, openedAt: null, warrantyUntil: '2028-11-11', note: '整机三年'
      },
      {
        id: 'it_mac', name: 'MacBook Air', icon: '💻', category: '电子', sub: '电脑',
        acquiredAt: '2024-06-01', source: '网购', cost: 14999, qty: 1, unit: '台',
        status: '在用', location: '书房', expiresAt: null, openedAt: null, warrantyUntil: null, note: ''
      },
      {
        id: 'it_shoe', name: '跑鞋', icon: '👟', category: '服饰', sub: '鞋',
        acquiredAt: D(-300), source: '商店购买', cost: 699, qty: 1, unit: '双',
        status: '在用', location: '玄关', expiresAt: null, openedAt: null, warrantyUntil: null, note: ''
      },
      {
        id: 'it_tooth', name: '儿童牙刷头', icon: '🪥', category: '日用', sub: '耗材',
        acquiredAt: D(-20), source: '网购', cost: 59, qty: 4, unit: '个',
        status: '在用', location: '卫生间', expiresAt: null, openedAt: null, warrantyUntil: null, note: '3 个月一换'
      },
      {
        id: 'it_umbrella', name: '雨伞', icon: '☂️', category: '日用', sub: '雨具',
        acquiredAt: '2026-07-02', source: '他人赠送', cost: null, qty: 1, unit: '把',
        status: '闲置', location: '玄关', expiresAt: null, openedAt: null, warrantyUntil: null, note: '朋友送的，价格未知'
      },
      {
        id: 'it_kettle', name: '电水壶', icon: '🫖', category: '电子', sub: '小家电',
        acquiredAt: D(-400), source: '超市', cost: 129, qty: 1, unit: '台',
        status: '在用', location: '厨房', expiresAt: null, openedAt: null, warrantyUntil: D(330), note: ''
      },
      {
        id: 'it_yogurt', name: '希腊酸奶', icon: '🥣', category: '食品', sub: '生鲜',
        acquiredAt: D(-11), source: '超市', cost: 12.8, qty: 2, unit: '盒',
        status: '在用', location: '冰箱冷藏', expiresAt: D(-4), openedAt: null, warrantyUntil: null, note: ''
      },
      {
        id: 'it_bread', name: '全麦面包', icon: '🍞', category: '食品', sub: '生鲜',
        acquiredAt: D(-12), source: '超市', cost: 8.9, qty: 1, unit: '袋',
        status: '在用', location: '厨房', expiresAt: D(-9), openedAt: null, warrantyUntil: null, note: ''
      },
      {
        id: 'it_drop', name: '玻璃酸钠滴眼液', icon: '💧', category: '药品', sub: '外用',
        acquiredAt: D(-187), openedAt: D(-187), source: '网购', cost: 16.9, qty: 1, unit: '盒',
        status: '已开封', location: '书桌', expiresAt: D(-157), warrantyUntil: null,
        note: '开封后 30 天失效'
      }
    ];

    const events = [];
    items.forEach(function (it) {
      events.push({
        id: 'ev_acq_' + it.id, itemId: it.id, type: 'acquired',
        at: it.acquiredAt, amount: it.cost, note: it.source
      });
    });
    events.push({ id: 'ev_ac_fix', itemId: 'it_ac', type: 'repaired', at: D(-77), amount: 180, note: '加氟' });
    events.push({ id: 'ev_shoe_fix', itemId: 'it_shoe', type: 'repaired', at: D(-120), amount: 39, note: '换鞋垫' });
    events.push({ id: 'ev_ibu_open', itemId: 'it_ibu', type: 'opened', at: D(-65), amount: null, note: '开封后开始 6 个月倒计时' });
    events.push({ id: 'ev_drop_open', itemId: 'it_drop', type: 'opened', at: D(-187), amount: null, note: '开封' });
    events.push({ id: 'ev_tooth_use', itemId: 'it_tooth', type: 'used', at: D(-6), amount: null, note: '换掉第 1 支' });

    const meters = [
      {
        id: 'm_elec', name: '电表', icon: '⚡️', unit: 'kWh',
        priceLabel: '居民阶梯电价', account: '户号 8102 ****',
        tier: { name: '第二阶梯', range: '181–280 kWh', price: 0.6083, used: 236, cap: 280 },
        history: [
          { m: '2025-11', usage: 142, cost: 79.3 },
          { m: '2025-12', usage: 168, cost: 93.8 },
          { m: '2026-01', usage: 205, cost: 120.1 },
          { m: '2026-02', usage: 188, cost: 108.6 },
          { m: '2026-03', usage: 152, cost: 84.9 },
          { m: '2026-04', usage: 138, cost: 77.1 },
          { m: '2026-05', usage: 176, cost: 98.3 },
          { m: '2026-06', usage: 243, cost: 148.0 },
          { m: '2026-07', usage: 318, cost: 193.6 },
          { m: '2026-08', usage: 296, cost: 178.2 },
          { m: '2026-09', usage: 231, cost: 129.1 }
        ],
        current: { m: '2026-10', usage: 236, cost: 142.3, projected: 318, projectedCost: 191.4, trend: 0.023 }
      },
      {
        id: 'm_water', name: '水表', icon: '💧', unit: '吨',
        priceLabel: '居民阶梯水价（含污水处理费）', account: '户号 3311 ****',
        tier: { name: '第一阶梯', range: '0–180 吨/年', price: 4.5, used: 8.2, cap: 180 },
        history: [
          { m: '2025-11', usage: 7.4, cost: 33.3 },
          { m: '2025-12', usage: 8.1, cost: 36.5 },
          { m: '2026-01', usage: 9.6, cost: 43.2 },
          { m: '2026-02', usage: 8.8, cost: 39.6 },
          { m: '2026-03', usage: 7.2, cost: 32.4 },
          { m: '2026-04', usage: 6.9, cost: 31.1 },
          { m: '2026-05', usage: 8.4, cost: 37.8 },
          { m: '2026-06', usage: 10.2, cost: 45.9 },
          { m: '2026-07', usage: 12.4, cost: 55.8 },
          { m: '2026-08', usage: 11.8, cost: 53.1 },
          { m: '2026-09', usage: 9.1, cost: 41.0 }
        ],
        current: { m: '2026-10', usage: 8.2, cost: 36.9, projected: 10.6, projectedCost: 47.7, trend: 0.17 }
      },
      {
        id: 'm_gas', name: '燃气表', icon: '🔥', unit: 'm³',
        priceLabel: '居民管道天然气', account: '户号 5590 ****',
        tier: { name: '第一阶梯', range: '0–300 m³/年', price: 2.8, used: 3.2, cap: 300 },
        history: [
          { m: '2025-11', usage: 9.8, cost: 27.4 },
          { m: '2025-12', usage: 12.4, cost: 34.7 },
          { m: '2026-01', usage: 16.2, cost: 45.4 },
          { m: '2026-02', usage: 14.8, cost: 41.4 },
          { m: '2026-03', usage: 11.2, cost: 31.4 },
          { m: '2026-04', usage: 8.6, cost: 24.1 },
          { m: '2026-05', usage: 6.4, cost: 17.9 },
          { m: '2026-06', usage: 5.2, cost: 14.6 },
          { m: '2026-07', usage: 4.8, cost: 13.4 },
          { m: '2026-08', usage: 5.1, cost: 14.3 },
          { m: '2026-09', usage: 6.8, cost: 19.0 }
        ],
        current: { m: '2026-10', usage: 3.2, cost: 9.0, projected: 19.8, projectedCost: 55.4, trend: 0.36 }
      }
    ];

    return { version: 1, items: items, events: events, meters: meters };
  }

  /* ---------------- 本地存储 ---------------- */

  const KEY = 'xcnote.prototype.v1';

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return seed();
      const d = JSON.parse(raw);
      if (!d || !d.items) return seed();
      return d;
    } catch (err) {
      return seed();
    }
  }
  function save(data) {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (err) { /* 忽略 */ }
  }
  function reset() {
    try { localStorage.removeItem(KEY); } catch (err) { /* 忽略 */ }
    return seed();
  }
  function uid(prefix) {
    return (prefix || 'id') + '_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
  }

  global.XC = {
    DAY: DAY,
    CATEGORIES: CATEGORIES,
    CATEGORY_NAMES: CATEGORY_NAMES,
    SOURCES: SOURCES,
    STATUSES: STATUSES,
    UNITS: UNITS,
    EVENT_TYPES: EVENT_TYPES,
    today: today,
    iso: iso,
    addDays: addDays,
    parseDate: parseDate,
    dayDiff: dayDiff,
    fmtDate: fmtDate,
    fmtMonth: fmtMonth,
    fmtCN: fmtCN,
    fmtNum: fmtNum,
    fmtMoney: fmtMoney,
    fmtRate: fmtRate,
    costOf: costOf,
    heldDays: heldDays,
    perDay: perDay,
    daysLeft: daysLeft,
    expiryLevel: expiryLevel,
    isExpired: isExpired,
    isActive: isActive,
    iconOf: iconOf,
    colorOf: colorOf,
    titleOf: titleOf,
    eventsOf: eventsOf,
    summaries: summaries,
    seed: seed,
    load: load,
    save: save,
    reset: reset,
    uid: uid
  };
})(window);
