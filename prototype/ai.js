/* 琪遇台账 · AI 客户端
 * ---------------------------------------------------------------
 * 通用 OpenAI 兼容接口，所以 DeepSeek 和千问（百炼）都能用，
 * 切服务商只需要改设置里的 Base URL + 模型名。
 *
 * 配置单独存一个 localStorage 键（xctally.ai.v1），【故意不放进业务数据里】：
 *   - 备份只导出 xctally.prototype.v1 / xctally.collect.v1，
 *     所以 API Key 天然不会被写进备份文件（不然你把备份发出去就等于泄露 key）
 *   - 清空业务数据也不会顺手把配置清掉
 */
(function () {
  'use strict';

  const KEY = 'xctally.ai.v1';
  const DEFAULTS = {
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-flash',
    visionModel: '',            // 留空表示和 model 用同一个
    key: '',
    enabled: true,
    // 联网搜索：默认博查（bochaai.com，支持跨域、中文结果好）。
    // 只在设置里打开开关并填了搜索 Key 才会启用，关闭时行为与从前完全一致。
    webSearch: false,
    searchKey: '',
    searchUrl: 'https://api.bochaai.com/v1/web-search'
  };

  /* 单价：DeepSeek 分高峰/空闲两套价（空闲价 = 高峰价的一半）。
     in/out/cacheHit 沿用为高峰价，*Off 为空闲价。
     默认值取自官网（deepseek-flash），可在设置里改。 */
  const PRICE_OFF_DEFAULTS = { inOff: 1, outOff: 4, cacheHitOff: 0.02 };

  /* 高峰时段：北京时间周一至周五 9:00-12:00、14:00-18:00
     （不含法定节假日 —— 这里没有节假日表，节假日会按高峰算，偏高一点） */
  function isPeakNow() {
    const bj = new Date(Date.now() + (new Date().getTimezoneOffset() + 480) * 60000);
    const day = bj.getDay();
    if (day === 0 || day === 6) return false;
    const h = bj.getHours() + bj.getMinutes() / 60;
    return (h >= 9 && h < 12) || (h >= 14 && h < 18);
  }

  function loadRaw() {
    try {
      return JSON.parse(localStorage.getItem(KEY) || '{}') || {};
    } catch (err) {
      return {};
    }
  }

  function saveRaw(c) {
    try {
      localStorage.setItem(KEY, JSON.stringify(c));
      return true;
    } catch (err) {
      return false;
    }
  }

  // 单价默认 0：官方价格会调整，与其内置一个可能过期的数字，不如让你按官网填。
  // 填了才会显示估算费用；token 数是接口原样给的，永远准确。
  const DEFAULT_PRICES = { in: 0, out: 0, cacheHit: 0 };

  function cfg() {
    const c = loadRaw();
    // 注意：这里必须把配置里的【其它字段】一起透传（ball / usage / prices）。
    // 之前只返回白名单字段，把悬浮球的位置和开关过滤掉了，
    // 导致"关不掉悬浮球、切页面位置跳回原位"。
    return Object.assign({}, DEFAULTS, c, {
      baseUrl: String(c.baseUrl || DEFAULTS.baseUrl).replace(/\/+$/, ''),
      model: c.model || DEFAULTS.model,
      visionModel: c.visionModel || c.model || DEFAULTS.model,
      key: c.key || '',
      enabled: c.enabled !== false,
      webSearch: c.webSearch === true,
      searchKey: c.searchKey || '',
      searchUrl: String(c.searchUrl || DEFAULTS.searchUrl).replace(/\/+$/, ''),
      ball: c.ball || {},
      usage: c.usage || { calls: 0, in: 0, out: 0, cacheHit: 0 },
      prices: Object.assign({}, DEFAULT_PRICES, PRICE_OFF_DEFAULTS, c.prices || {})
    });
  }

  function update(patch) {
    const c = loadRaw();
    Object.keys(patch || {}).forEach(function (k) { c[k] = patch[k]; });
    return saveRaw(c);
  }

  /* 配好了才显示识图 / 助手入口 */
  function ready() {
    const c = cfg();
    return !!(c.enabled && c.key);
  }

  function friendly(err) {
    const m = String((err && err.message) || err || '');
    if (/Failed to fetch|NetworkError|network/i.test(m)) {
      return '连不上服务器：检查网络，以及 Base URL 是否写对';
    }
    if (/abort/i.test(m)) return '请求超时，稍后再试';
    if (/401|invalid.*key|Unauthorized/i.test(m)) return 'API Key 不对或已失效';
    if (/402|insufficient|balance/i.test(m)) return '账户余额不足';
    if (/404|model/i.test(m) && /not.*exist|not.*found/i.test(m)) {
      return '模型名不对：到设置里改成正确的模型 id';
    }
    if (/429/.test(m)) return '调用太频繁，等一会儿再试';
    return m;
  }

  /* ---------------- 用量统计 ----------------
   * 只记 token（接口原样给的），金额在展示时按单价现算 —— 这样改单价不用重算历史。
   * 存在 xctally.ai.v1 里，和 Key 同一个键，所以【不会进备份】。
   */
  function addUsage(u) {
    if (!u) return;
    const p = cfg().prices;
    const cur = loadRaw().usage || { calls: 0, in: 0, out: 0, cacheHit: 0, cost: 0 };
    const hit = u.prompt_cache_hit_tokens || 0;
    const miss = Math.max(0, (u.prompt_tokens || 0) - hit);
    const out = u.completion_tokens || 0;
    // 按【这一次请求发生时的时段】计价：高峰/空闲价不同，
    // 事后再按总量估算是算不准的，所以直接把钱累加进去
    const peak = isPeakNow();
    const unit = peak
      ? { hit: p.cacheHit, miss: p.in, out: p.out }
      : { hit: p.cacheHitOff, miss: p.inOff, out: p.outOff };
    cur.calls = (cur.calls || 0) + 1;
    cur.in = (cur.in || 0) + (u.prompt_tokens || 0);
    cur.out = (cur.out || 0) + out;
    cur.cacheHit = (cur.cacheHit || 0) + hit;
    cur.cost = (cur.cost || 0) + (miss * unit.miss + hit * unit.hit + out * unit.out) / 1e6;
    if (peak) cur.peakCalls = (cur.peakCalls || 0) + 1;
    update({ usage: cur });
  }

  function usage() {
    const c = cfg();
    const u = c.usage;
    const p = c.prices;
    const missIn = Math.max(0, (u.in || 0) - (u.cacheHit || 0));
    const est = (missIn * p.in + (u.cacheHit || 0) * p.cacheHit + (u.out || 0) * p.out) / 1e6;
    return {
      calls: u.calls || 0,
      in: u.in || 0,
      out: u.out || 0,
      cacheHit: u.cacheHit || 0,
      missIn: missIn,
      total: (u.in || 0) + (u.out || 0),
      // 有累计值就用累计值（按时段算过），老记录退回按高峰价估算
      cost: typeof u.cost === 'number' ? u.cost : est,
      estimated: typeof u.cost !== 'number',
      peakCalls: u.peakCalls || 0,
      priced: !!(p.in || p.out || p.cacheHit || p.inOff || p.outOff || p.cacheHitOff),
      prices: p
    };
  }

  function usageReset() {
    update({ usage: { calls: 0, in: 0, out: 0, cacheHit: 0, cost: 0, peakCalls: 0 } });
  }

  /* 查询账号余额：GET /user/balance（余额、赠送、充值、币种） */
  async function balance() {
    const c = cfg();
    if (!c.key) throw new Error('还没填 API Key');
    let res;
    try {
      res = await fetch(c.baseUrl + '/user/balance', {
        headers: { 'Authorization': 'Bearer ' + c.key }
      });
    } catch (err) {
      throw new Error(friendly(err));
    }
    const text = await res.text();
    if (!res.ok) {
      throw new Error(res.status === 404
        ? '这个 Key（或代理地址）不支持查询余额'
        : friendly(new Error('HTTP ' + res.status + ' ' + text.slice(0, 200))));
    }
    let j;
    try { j = JSON.parse(text); } catch (err) { throw new Error('余额接口返回的不是 JSON'); }
    const info = (j.balance_infos && j.balance_infos[0]) || {};
    return {
      available: j.is_available !== false,
      currency: info.currency || 'CNY',
      total: info.total_balance,
      granted: info.granted_balance,
      toppedUp: info.topped_up_balance
    };
  }

  /* 一次 chat/completions 调用，返回助手回复的纯文本（同时记账） */
  async function call(messages, opts) {
    const c = cfg();
    if (!c.enabled) throw new Error('AI 功能已关闭');
    if (!c.key) throw new Error('还没填 API Key');
    opts = opts || {};

    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(function () { ctrl.abort(); }, opts.timeout || 60000) : null;

    let res;
    try {
      res = await fetch(c.baseUrl + '/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + c.key
        },
        body: JSON.stringify({
          model: opts.vision ? c.visionModel : c.model,
          messages: messages,
          temperature: opts.temperature == null ? 0 : opts.temperature,
          max_tokens: opts.maxTokens || 2000
        }),
        signal: ctrl ? ctrl.signal : undefined
      });
    } catch (err) {
      if (timer) clearTimeout(timer);
      throw new Error(friendly(err));
    }
    if (timer) clearTimeout(timer);

    const text = await res.text();
    if (!res.ok) {
      let detail = '';
      try {
        const j = JSON.parse(text);
        detail = (j.error && (j.error.message || j.error.type)) || j.message || '';
      } catch (err) { /* 非 JSON 错误体 */ }
      throw new Error(friendly(new Error('HTTP ' + res.status + (detail ? ' ' + detail : ''))));
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      throw new Error('服务器返回的不是 JSON');
    }
    const msg = data.choices && data.choices[0] && data.choices[0].message;
    const content = msg && msg.content;
    if (content == null) throw new Error('返回里没有内容');
    addUsage(data.usage);          // 记账：token 由接口原样给出
    return String(content);
  }

  /* 图片理解：dataUrl 走 base64 内联 */
  function vision(dataUrl, prompt) {
    return call([{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: dataUrl } }
      ]
    }], { vision: true, timeout: 120000, maxTokens: 4000 });
  }

  /* 模型偶尔会包 ```json 或加一句废话，这里尽量把它剥出来 */
  function parseJson(text) {
    let s = String(text == null ? '' : text).trim();
    s = s.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '').trim();
    const i = s.indexOf('{');
    const j = s.lastIndexOf('}');
    if (i >= 0 && j > i) s = s.slice(i, j + 1);
    return JSON.parse(s);
  }

  /* 连通性测试，设置页用 */
  async function test() {
    const out = await call([{ role: 'user', content: '回复两个字：可用' }], { timeout: 30000, maxTokens: 20 });
    return out.trim();
  }

  /* 联网搜索（博查 API）：返回 [{name, url, snippet}]，失败抛错由调用方降级 */
  async function webSearch(query) {
    const c = cfg();
    if (!c.webSearch || !c.searchKey) return [];
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 15000) : null;
    let res;
    try {
      res = await fetch(c.searchUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + c.searchKey
        },
        body: JSON.stringify({ query: String(query || '').slice(0, 100), summary: true, count: 5 }),
        signal: ctrl ? ctrl.signal : undefined
      });
    } catch (err) {
      if (timer) clearTimeout(timer);
      throw new Error(friendly(err));
    }
    if (timer) clearTimeout(timer);
    if (!res.ok) throw new Error('搜索接口返回 ' + res.status);
    const data = await res.json();
    // 博查结构 data.webPages.value[]；其它兼容结构兜底：data.results[]
    const list = (data && data.data && data.data.webPages && data.data.webPages.value) ||
      (data && data.webPages && data.webPages.value) || (data && data.results) || [];
    return list.slice(0, 5).map(function (x) {
      return { name: String(x.name || x.title || ''), url: String(x.url || ''), snippet: String(x.summary || x.snippet || '') };
    }).filter(function (x) { return x.name || x.snippet; });
  }

  window.QYA = {
    KEY: KEY,
    DEFAULTS: DEFAULTS,
    DEFAULT_PRICES: DEFAULT_PRICES,
    cfg: cfg,
    update: update,
    ready: ready,
    call: call,
    vision: vision,
    parseJson: parseJson,
    test: test,
    webSearch: webSearch,
    friendly: friendly,
    usage: usage,
    usageReset: usageReset,
    balance: balance
  };
})();
