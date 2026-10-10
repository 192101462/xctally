/* xctally · 数据层（原型）
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

  /* ---------------- 分类（用户可自定义，存在数据里） ---------------- */

  // 默认分类。costTrack 决定"这个分类下的物品默认是否算日均成本"：
  // 食物、药品是消耗品，按天摊价格没有意义；耐用品才有意义。
  // statuses：这个分类下物品会经历哪些阶段。归档是独立标记，不在这里。
  // 方案②：状态里【不放"已过期"】—— 过期由到期日自动算并显示红标，
  // 否则会出现"东西过期了但状态还写着已开封"这种自相矛盾。
  const DEFAULT_CATS = [
    { name: '食品', emoji: '🥛', g: ['#FFE7C2', '#FFC46B'], costTrack: false, statuses: ['未开封', '已开封', '已吃完'] },
    { name: '药品', emoji: '💊', g: ['#FFD9DC', '#FF9AA2'], costTrack: false, statuses: ['未开封', '已开封', '已用完'] },
    { name: '日用', emoji: '🧺', g: ['#D9E8FF', '#9CC2FF'], costTrack: true, statuses: ['未开封', '使用中', '已用完'] },
    { name: '服饰', emoji: '🧣', g: ['#E6DEFF', '#B6A4FF'], costTrack: true, statuses: ['新购', '穿着中', '闲置', '已丢弃'] },
    { name: '电子', emoji: '💻', g: ['#D6F3EA', '#84DCC0'], costTrack: true, statuses: ['新购', '使用中', '已损坏', '已丢弃'] },
    { name: '表具', emoji: '⚡️', g: ['#FFF1C9', '#FFD666'], costTrack: true, statuses: ['正常', '停用'] },
    { name: '其他', emoji: '📦', g: ['#ECECF1', '#CFCFD8'], costTrack: true, statuses: ['未开封', '使用中', '已用完'] }
  ];
  const FALLBACK_STATUSES = ['未开封', '使用中', '已用完'];
  const FALLBACK_CAT = { name: '未分类', emoji: '📦', g: ['#ECECF1', '#CFCFD8'], costTrack: true };
  const EMOJI_POOL = ['📦', '🏷', '🎁', '🧩', '🔧', '🧴', '🪥', '🧸', '📚', '🎨', '🎵', '⌚️', '🔌', '🪴', '🧯'];
  const GRAD_POOL = [
    ['#FFE7C2', '#FFC46B'], ['#FFD9DC', '#FF9AA2'], ['#D9E8FF', '#9CC2FF'],
    ['#E6DEFF', '#B6A4FF'], ['#D6F3EA', '#84DCC0'], ['#FFF1C9', '#FFD666'],
    ['#FFE3EA', '#F2A6BC'], ['#DCE4FF', '#93A6F0'], ['#E7ECF5', '#C9D6E8']
  ];

  function catList(data) {
    if (data && data.itemCats && data.itemCats.length) return data.itemCats;
    return DEFAULT_CATS;
  }
  function catOf(name, data) {
    const list = catList(data);
    for (let i = 0; i < list.length; i++) if (list[i].name === name) return list[i];
    return FALLBACK_CAT;
  }
  function nextCatStyle(data) {
    const n = catList(data).length;
    return { emoji: EMOJI_POOL[n % EMOJI_POOL.length], g: GRAD_POOL[n % GRAD_POOL.length] };
  }

  // 某个分类下物品可用的状态词
  function catStatuses(name, data) {
    const list = catOf(name, data).statuses;
    return (list && list.length) ? list : FALLBACK_STATUSES;
  }

  // 老数据的状态词迁移：在用/闲置/借出/已开封/已用完/已处置 -> 新词表
  function migrateStatus(old, list) {
    if (!old) return list[0];
    if (list.indexOf(old) >= 0) return old;                 // 已经是新词表里的词
    const pick = function (kw) {
      for (let i = 0; i < list.length; i++) if (list[i].indexOf(kw) >= 0) return list[i];
      return null;
    };
    const second = function () { return list[Math.min(1, list.length - 1)]; };
    if (/吃完|食用|用完/.test(old)) return pick('吃完') || pick('用完') || list[list.length - 1];
    if (/处置|丢弃|损坏|报废/.test(old)) return pick('丢弃') || list[list.length - 1];
    if (/过期/.test(old)) return pick('用完') || list[list.length - 1];
    if (/开封/.test(old)) return pick('开封') || second();
    if (/闲置/.test(old)) return pick('闲置') || second();
    if (/借出|外借/.test(old)) return second();
    return pick('使用中') || pick('穿着中') || second();
  }

  // 是否计算日均成本：物品上的开关优先，否则跟随分类默认值
  function tracksCost(item, data) {
    if (item && typeof item.costTrack === 'boolean') return item.costTrack;
    return catOf(item && item.category, data).costTrack !== false;
  }

  /* ---------------- 归档 ----------------
   * 归档是【独立于物品状态】的一个标记：东西用完了/处理掉了，但记录要留着回看。
   * 所以归档不再改动物品状态（status 描述的是物品本身处在什么阶段）。
   * 兼容老数据：过去把"已处置/已用完"当状态用，这里认出它们并升级成归档标记。
   */
  const LEGACY_ARCHIVED_STATUS = { '已用完': 1, '已处置': 1 };
  function isArchived(item) {
    if (!item) return false;
    if (typeof item.archived === 'boolean') return item.archived;
    return !!LEGACY_ARCHIVED_STATUS[item.status];
  }
  function isActive(item) { return !isArchived(item); }

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
    return d != null && d < 0 && !isArchived(item);
  }
  function iconOf(item, data) {
    return item.icon || catOf(item.category, data).emoji;
  }
  function colorOf(item, data) {
    return catOf(item.category, data).g;
  }
  function titleOf(item) {
    return item.sub ? item.category + ' · ' + item.sub : item.category;
  }
  // 列表/详情用的方形缩略图：有照片用照片，否则用中性底 + 名称首字（不再是 emoji 图标）
  function thumbStyle(item) {
    if (item.photo) {
      return 'background-image:url(' + item.photo + ');background-size:cover;background-position:center';
    }
    return '';
  }
  function thumbChar(item) {
    return String(item.name || '?').trim().charAt(0) || '?';
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

    // 已经浪费掉的钱：过期且未归档的物品成本合计
    const expired = items.filter(isExpired);
    const wasted = expired.reduce(function (s, it) { return s + (it.cost || 0); }, 0);

    // 持有成本合计：只统计"计入日均成本"的物品（食品、药品这类不算）
    let daily = 0;
    let dailyCount = 0;
    active.forEach(function (it) {
      if (!tracksCost(it, data)) return;
      const p = perDay(it, data);
      if (p) { daily += p; dailyCount++; }
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
      archived: items.length - active.length,
      wasted: wasted,
      wastedCount: expired.length,
      daily: daily,
      dailyCount: dailyCount,
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

    return { version: 2, itemCats: DEFAULT_CATS.map(function (c) { return { name: c.name, emoji: c.emoji, g: c.g.slice(), costTrack: c.costTrack }; }), items: items, events: events, meters: meters };
  }

  /* ---------------- 本地存储 ---------------- */

  const KEY = 'xctally.prototype.v1';

  /* ---------------- 回收站 ----------------
   * 删除不直接抹掉：物品和它的时间线一起进回收站，保留 30 天，
   * 期间可以恢复，也可以手动清空。过期条目在每次加载时自动清理。
   */
  const TRASH_DAYS = 30;

  function purgeTrash(d) {
    const cutoff = Date.now() - TRASH_DAYS * DAY;
    const before = (d.trash || []).length;
    d.trash = (d.trash || []).filter(function (t) {
      const ts = new Date(t.deletedAt).getTime();
      return !isNaN(ts) && ts >= cutoff;
    });
    return before - d.trash.length;
  }

  function trashDaysLeft(entry) {
    const ts = new Date(entry && entry.deletedAt).getTime();
    if (isNaN(ts)) return 0;
    return Math.max(0, TRASH_DAYS - Math.floor((Date.now() - ts) / DAY));
  }

  function load() {
    let d = null;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) d = JSON.parse(raw);
    } catch (err) {
      d = null;
    }
    if (!d || !d.items) {
      // 首次安装：【不要示例内容】，只保留结构（分类配置、表具定义）。
      // 表具本身留着（目前没有"新增表具"的界面），但读数清零，
      // 免得首屏出现"本月能源 ¥188.20"这种假数字。
      d = seed();
      d.items = [];
      d.events = [];
      d.trash = [];
      (d.meters || []).forEach(function (m) {
        m.history = [];
        m.current = {
          m: iso(today()).slice(0, 7), usage: 0, cost: 0,
          projected: 0, projectedCost: 0, trend: 0
        };
      });
    }

    // 迁移：老数据没有 itemCats（分类原本是写死的），补上默认分类
    if (!d.itemCats || !d.itemCats.length) {
      d.itemCats = DEFAULT_CATS.map(function (c) {
        return { name: c.name, emoji: c.emoji, g: c.g.slice(), costTrack: c.costTrack, statuses: c.statuses.slice() };
      });
    } else {
      // 已有分类的老数据：补 statuses 字段（按同名默认分类，找不到给通用词表）
      d.itemCats.forEach(function (c) {
        if (!c.statuses || !c.statuses.length) {
          const def = DEFAULT_CATS.filter(function (x) { return x.name === c.name; })[0];
          c.statuses = (def ? def.statuses : FALLBACK_STATUSES).slice();
        }
      });
    }

    // 归一化：补齐新字段，避免各处判空
    d.items.forEach(function (it) {
      if (it.photo === undefined) it.photo = null;
      if (it.sub === undefined) it.sub = '';
      if (it.status === undefined) it.status = '在用';
      if (it.archived === undefined) it.archived = !!LEGACY_ARCHIVED_STATUS[it.status];
      if (it.pinned === undefined) it.pinned = false;
      // 状态词迁移到该分类的新词表（老数据是全局的 在用/闲置/借出/已开封/已用完/已处置）
      it.status = migrateStatus(it.status, catStatuses(it.category, d));
    });
    // 回收站：补字段 + 清掉超过 30 天的
    if (!d.trash) d.trash = [];
    purgeTrash(d);
    return d;
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

  global.QY = {
    DAY: DAY,
    DEFAULT_CATS: DEFAULT_CATS,
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
    isArchived: isArchived,
    TRASH_DAYS: TRASH_DAYS,
    purgeTrash: purgeTrash,
    trashDaysLeft: trashDaysLeft,
    catList: catList,
    catOf: catOf,
    catStatuses: catStatuses,
    migrateStatus: migrateStatus,
    FALLBACK_STATUSES: FALLBACK_STATUSES,
    nextCatStyle: nextCatStyle,
    tracksCost: tracksCost,
    iconOf: iconOf,
    colorOf: colorOf,
    thumbStyle: thumbStyle,
    thumbChar: thumbChar,
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
