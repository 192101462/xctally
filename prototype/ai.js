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
    enabled: true
  };

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
      ball: c.ball || {},
      usage: c.usage || { calls: 0, in: 0, out: 0, cacheHit: 0 },
      prices: Object.assign({}, DEFAULT_PRICES, c.prices || {})
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
    const cur = loadRaw().usage || { calls: 0, in: 0, out: 0, cacheHit: 0 };
    cur.calls = (cur.calls || 0) + 1;
    cur.in = (cur.in || 0) + (u.prompt_tokens || 0);
    cur.out = (cur.out || 0) + (u.completion_tokens || 0);
    // DeepSeek 会额外给缓存命中量，命中部分便宜很多
    cur.cacheHit = (cur.cacheHit || 0) + (u.prompt_cache_hit_tokens || 0);
    update({ usage: cur });
  }

  function usage() {
    const c = cfg();
    const u = c.usage;
    const p = c.prices;
    const missIn = Math.max(0, (u.in || 0) - (u.cacheHit || 0));
    const cost = (missIn * p.in + (u.cacheHit || 0) * p.cacheHit + (u.out || 0) * p.out) / 1e6;
    return {
      calls: u.calls || 0,
      in: u.in || 0,
      out: u.out || 0,
      cacheHit: u.cacheHit || 0,
      missIn: missIn,
      total: (u.in || 0) + (u.out || 0),
      cost: cost,
      priced: !!(p.in || p.out || p.cacheHit),
      prices: p
    };
  }

  function usageReset() {
    update({ usage: { calls: 0, in: 0, out: 0, cacheHit: 0 } });
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
    friendly: friendly,
    usage: usage,
    usageReset: usageReset,
    balance: balance
  };
})();
