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
    model: 'deepseek-v4.1-flash',
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

  function cfg() {
    const c = loadRaw();
    return {
      baseUrl: String(c.baseUrl || DEFAULTS.baseUrl).replace(/\/+$/, ''),
      model: c.model || DEFAULTS.model,
      visionModel: c.visionModel || c.model || DEFAULTS.model,
      key: c.key || '',
      enabled: c.enabled !== false
    };
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

  /* 一次 chat/completions 调用，返回助手回复的纯文本 */
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
    cfg: cfg,
    update: update,
    ready: ready,
    call: call,
    vision: vision,
    parseJson: parseJson,
    test: test,
    friendly: friendly
  };
})();
