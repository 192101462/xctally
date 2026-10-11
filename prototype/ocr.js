/* 琪遇台账 · 识图导入 + DeepSeek 配置
 * ---------------------------------------------------------------
 * 流程：选图（或拍照）-> 本地压到 1280 -> 交给视觉模型 -> 得到物品 JSON
 *       -> 以【可编辑的预览表】呈现 -> 用户核对/修改/勾选 -> 才写入数据
 *
 * 几条硬规矩：
 *   1. 绝不直接入库。模型会认错数字（满减分摊尤其容易），必须让人过一眼。
 *   2. 读取失败或字段缺失都留着空白，不做任何"帮用户补全"的推断。
 *   3. 到期日留空由用户自己填（订单里本来就没有）。
 *   4. 配置单独存 xctally.ai.v1，不混进业务数据，因此不会进备份。
 */
(function () {
  'use strict';

  function UI() { return window.QYUI; }
  const QY = window.QY;
  const QYA = window.QYA;      // 显式取，不依赖裸全局
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  let draft = null;      // { order:{platform,date,paidTotal}, items:[{include,name,price,qty,category,sub,confidence,note,source}] }
  let busy = false;
  let lastError = '';

  function cfgReady() {
    return !!(window.QYA && QYA.ready());
  }

  /* ---------------- 识别 ---------------- */

  function openOcr() {
    if (!cfgReady()) {
      UI().toast('先在「我的 → DeepSeek 配置」里填 API Key');
      return;
    }
    draft = null;
    busy = false;
    lastError = '';
    UI().openSheet(sheetHtml());
  }

  function sheetHtml() {
    if (busy) {
      return '<div class="sheet"><div class="grabber"></div>' +
        '<h3>正在识别…</h3>' +
        '<p class="hint">截图已压缩后上传，通常 3~10 秒。识别结果会先给你核对，不会直接入库。</p>' +
        '<div class="ocr-busy"><i></i><i></i><i></i></div></div>';
    }
    if (!draft) {
      return '<div class="sheet"><div class="grabber"></div>' +
        '<h3>从截图识别</h3>' +
        '<p class="hint">建议先裁掉收货地址和手机号</p>' +
        (lastError ? '<div class="notice">上次失败：' + esc(lastError) + '</div>' : '') +
        '<div class="group">' +
          '<div class="row" data-action="i-ocr-pick" data-src="gallery">' +
            '<div class="tl-dot">🖼</div>' +
            '<div class="row-main"><div class="row-title">从相册选择截图</div></div>' +
            '<div class="row-side"><span class="chev">›</span></div></div>' +
          '<div class="row" data-action="i-ocr-pick" data-src="camera">' +
            '<div class="tl-dot">📷</div>' +
            '<div class="row-main"><div class="row-title">拍一张小票</div></div>' +
            '<div class="row-side"><span class="chev">›</span></div></div>' +
        '</div>' +
        '<div class="sheet-actions" style="margin-top:14px">' +
          '<button class="btn plain" data-action="i-close">取消</button></div>' +
      '</div>';
    }
    return previewHtml();
  }

  function previewHtml() {
    const rows = draft.items.map(function (x, i) {
      const low = x.confidence === 'low';
      return '<div class="ocr-row' + (low ? ' low' : '') + '">' +
        '<label class="ocr-pick"><input type="checkbox" data-ocr="include" data-i="' + i + '"' +
          (x.include ? ' checked' : '') + ' /></label>' +
        '<div class="ocr-fields">' +
          '<input class="input" data-ocr="name" data-i="' + i + '" value="' + esc(x.name) +
            '" placeholder="商品名" />' +
          '<div class="ocr-line">' +
            '<input class="input" type="number" step="0.01" data-ocr="price" data-i="' + i + '" value="' +
              (x.price == null ? '' : x.price) + '" placeholder="价格" />' +
            '<input class="input ocr-qty" type="number" step="1" data-ocr="qty" data-i="' + i + '" value="' +
              (x.qty || 1) + '" placeholder="数量" />' +
            '<input class="input ocr-cat" data-ocr="category" data-i="' + i + '" value="' + esc(x.category) +
              '" placeholder="分类" />' +
          '</div>' +
          (low || x.note
            ? '<div class="ocr-note">' + (low ? '⚠️ 这条不太确定，请核对 ' : '') + esc(x.note || '') + '</div>'
            : '') +
        '</div></div>';
    }).join('');

    const picked = draft.items.filter(function (x) { return x.include; }).length;
    const total = draft.items.reduce(function (s, x) {
      return s + (x.include && x.price != null ? x.price : 0);
    }, 0);

    return '<div class="sheet"><div class="grabber"></div>' +
      '<h3>核对识别结果</h3>' +
      '<p class="hint">' + draft.items.length + ' 件 · 合计 ¥' + total.toFixed(2) + '</p>' +
      '<div class="group ocr-list">' + (rows || '<div class="empty"><p>没有识别到商品</p></div>') + '</div>' +
      '<div class="sheet-actions" style="margin-top:14px">' +
        '<button class="btn plain" data-action="i-ocr-again">重新识别</button>' +
        '<button class="btn primary" data-action="i-ocr-add">添加 ' + picked + ' 件</button>' +
      '</div></div>';
  }

  function rerender() {
    UI().openSheet(sheetHtml());
  }

  function recognize(source) {
    busy = true;
    lastError = '';
    rerender();
    window.QYV.pickImage(function (dataUrl, info) {
      if (!dataUrl) { busy = false; rerender(); return; }
      const data = UI().data();
      QYA.vision(dataUrl, window.QYP.visionPrompt(data)).then(function (text) {
        let obj;
        try {
          obj = QYA.parseJson(text);
        } catch (err) {
          throw new Error('模型返回的不是合法 JSON');
        }
        if (obj && obj.error) throw new Error('这张图看起来不是订单截图');
        const order = obj.order || {};
        const items = (obj.items || []).map(function (x) {
          return {
            include: true,
            name: x.name || '',
            price: typeof x.price === 'number' ? x.price : null,
            qty: Number(x.qty) || 1,
            category: x.category || '',
            sub: x.sub || '',
            confidence: x.confidence === 'low' ? 'low' : 'high',
            note: [x.note, (x.price == null ? '价格未识别' : '')].filter(Boolean).join(' · '),
            acquiredAt: order.date || QY.iso(QY.today()),
            source: order.platform || '网购'
          };
        });
        if (!items.length) throw new Error('没有识别到任何商品');
        draft = { order: order, items: items };
        busy = false;
        rerender();
      }).catch(function (err) {
        busy = false;
        lastError = (err && err.message) || '识别失败';
        draft = null;
        rerender();
      });
    }, { maxSide: 1280, quality: 0.8, source: source });
  }

  function addAll() {
    const d = UI().data();
    const picked = draft.items.filter(function (x) { return x.include; });
    if (!picked.length) { UI().toast('一件都没勾选'); return; }
    const cats = QY.catList(d).map(function (c) { return c.name; });
    let fellBack = 0;
    picked.forEach(function (x) {
      let cat = String(x.category || '').trim();
      if (cats.indexOf(cat) < 0) { if (cat) fellBack++; cat = '其他'; }
      const item = {
        id: QY.uid('it'),
        icon: '',
        name: String(x.name || '').trim() || '未命名',
        category: cat,
        sub: x.sub || '',
        acquiredAt: x.acquiredAt || QY.iso(QY.today()),
        source: x.source || '网购',
        cost: x.price,
        qty: x.qty || 1,
        unit: '个',
        status: '在用',
        location: '',
        expiresAt: null,
        openedAt: null,
        warrantyUntil: null,
        note: x.note || '',
        photo: null,
        pinned: false,
        archived: false,
        costTrack: QY.catOf(cat, d).costTrack !== false
      };
      d.items.push(item);
      d.events.push({
        id: QY.uid('ev'), itemId: item.id, type: 'acquired',
        at: item.acquiredAt, amount: item.cost, note: item.source
      });
    });
    UI().save();
    UI().closeSheet();
    draft = null;
    UI().mount();
    UI().toast('已添加 ' + picked.length + ' 件' +
      (fellBack ? '（' + fellBack + ' 件分类不在你的分类里，先归到「其他」）' : ''));
  }

  /* ---------------- DeepSeek 配置 ---------------- */

  function openAiConfig() {
    const c = QYA.cfg();
    const raw = (function () { try { return JSON.parse(localStorage.getItem(QYA.KEY) || '{}'); } catch (e) { return {}; } })();
    UI().openSheet('' +
      '<div class="sheet"><div class="grabber"></div>' +
        '<h3>DeepSeek 配置</h3>' +
        '<p class="hint">Key 只存在本机，不会写进备份。</p>' +
        '<label class="check-row"><input type="checkbox" id="ai-enabled"' +
          (c.enabled ? ' checked' : '') + ' />' +
          '<span>启用 AI 功能</span><b>关闭后 App 完全离线</b></label>' +
        '<div class="field"><label>API Key</label>' +
          '<input id="ai-key" class="input" type="password" placeholder="sk-..." value="' +
            esc(raw.key || '') + '" autocomplete="off" /></div>' +
        '<div class="field"><label>模型</label>' +
          '<input id="ai-model" class="input" value="' + esc(raw.model || QYA.DEFAULTS.model) + '" /></div>' +
        '<div class="field"><label>Base URL</label>' +
          '<input id="ai-base" class="input" value="' + esc(raw.baseUrl || QYA.DEFAULTS.baseUrl) + '" /></div>' +
        '<div class="notice" id="ai-test-out" style="display:none"></div>' +
        '<div class="sheet-actions" style="margin-top:14px">' +
          '<button class="btn plain" data-action="i-ai-test">测试连接</button>' +
          '<button class="btn primary" data-action="i-ai-save">保存</button>' +
        '</div>' +
      '</div>');
  }

  function saveAiConfig() {
    const key = (document.getElementById('ai-key').value || '').trim();
    const model = (document.getElementById('ai-model').value || '').trim();
    const baseUrl = (document.getElementById('ai-base').value || '').trim();
    const enabled = document.getElementById('ai-enabled').checked;
    QYA.update({ key: key, model: model, baseUrl: baseUrl, enabled: enabled });
    UI().closeSheet();
    UI().mount();
    UI().toast(key ? '已保存，AI 功能可用' : '已保存（没填 Key，AI 功能隐藏）');
  }

  function testAiConfig() {
    const out = document.getElementById('ai-test-out');
    // 先用输入框里的值测，不要求先保存
    QYA.update({
      key: (document.getElementById('ai-key').value || '').trim(),
      model: (document.getElementById('ai-model').value || '').trim(),
      baseUrl: (document.getElementById('ai-base').value || '').trim()
    });
    if (out) { out.style.display = 'block'; out.textContent = '测试中…'; }
    QYA.test().then(function (reply) {
      if (out) out.textContent = '✅ 连接正常，模型回复：' + reply;
    }).catch(function (err) {
      if (out) out.textContent = '❌ ' + ((err && err.message) || '测试失败');
    });
  }

  /* ---------------- 用量与额度 ---------------- */

  function kvRow(k, v, strong) {
    return '<div class="kv"><span class="k">' + esc(k) + '</span><span class="v"' +
      (strong ? ' style="font-weight:650"' : '') + '>' + v + '</span></div>';
  }

  function priceField(id, label, val) {
    return '<div class="field"><label>' + esc(label) + '</label>' +
      '<input id="' + id + '" class="input" type="number" step="0.01" min="0" value="' +
        (Number(val) || 0) + '" /></div>';
  }

  function openAiUsage() {
    const u = QYA.usage();
    const p = u.prices;
    const n = function (v) { return Number(v || 0).toLocaleString(); };
    UI().openSheet('' +
      '<div class="sheet"><div class="grabber"></div>' +
        '<h3>用量与额度</h3>' +
        '<p class="hint">金额按每次请求发生时的时段计价（高峰 / 空闲）</p>' +
        '<div class="group">' +
          kvRow('调用次数', u.calls + ' 次') +
          kvRow('输入 token', n(u.in)) +
          kvRow('　其中缓存命中', u.cacheHit ? n(u.cacheHit) + '（更便宜）' : '0') +
          kvRow('输出 token', n(u.out)) +
          kvRow('合计 token', n(u.total), true) +
          kvRow('估算费用', u.priced ? '¥' + u.cost.toFixed(4) : '<span style="color:var(--label-3)">未填单价</span>', true) +
        '</div>' +
        '<div class="section"><div class="section-head"><h2>单价设置</h2>' +
          '<span>元 / 百万 token</span></div>' +
          '<div class="section-head" style="margin-top:8px">' +
            '<h2 style="font-size:13px">高峰时段</h2>' +
            '<span>周一至周五 9-12、14-18</span></div>' +
          priceField('price-hit', '百万tokens输入（缓存命中）', p.cacheHit) +
          priceField('price-miss', '百万tokens输入（缓存未命中）', p.in) +
          priceField('price-out', '百万tokens输出', p.out) +
          '<div class="section-head" style="margin-top:10px">' +
            '<h2 style="font-size:13px">空闲时段</h2>' +
            '<span>其余时间，是高峰价的一半</span></div>' +
          priceField('price-hit-off', '百万tokens输入（缓存命中）', p.cacheHitOff) +
          priceField('price-miss-off', '百万tokens输入（缓存未命中）', p.inOff) +
          priceField('price-out-off', '百万tokens输出', p.outOff) +
        '</div>' +
        '<div class="notice" id="ai-balance">账号余额：点「刷新余额」查询（需要该 Key 支持查询）</div>' +
        '<div class="sheet-actions" style="margin-top:14px">' +
          '<button class="btn plain" data-action="i-ai-usage-refresh">刷新余额</button>' +
          '<button class="btn primary" data-action="i-ai-price-save">保存单价</button>' +
        '</div>' +
        '<div class="danger-zone">' +
          '<button class="danger-btn" data-action="i-ai-usage-reset">清空用量统计</button>' +
        '</div>' +
      '</div>');
  }

  function refreshBalance() {
    const box = document.getElementById('ai-balance');
    if (box) box.textContent = '正在查询余额…';
    QYA.balance().then(function (b) {
      if (!box) return;
      box.innerHTML = '账号余额：<b>' + esc(b.currency) + ' ' + esc(b.total) + '</b>' +
        '<br>赠送 ' + esc(b.granted) + ' · 充值 ' + esc(b.toppedUp) +
        (b.available ? '' : '<br><span style="color:var(--red)">账户余额不足</span>');
    }).catch(function (err) {
      if (box) box.textContent = '余额查询失败：' + ((err && err.message) || '未知错误');
    });
  }

  function savePrices() {
    const num = function (id) { return Number(document.getElementById(id).value) || 0; };
    QYA.update({ prices: {
      cacheHit: num('price-hit'),
      in: num('price-miss'),
      out: num('price-out'),
      cacheHitOff: num('price-hit-off'),
      inOff: num('price-miss-off'),
      outOff: num('price-out-off')
    } });
    openAiUsage();
    UI().toast('单价已保存');
  }

  /* ---------------- 动作 & 输入 ---------------- */

  const ACTIONS = ['i-ocr', 'i-ocr-pick', 'i-ocr-again', 'i-ocr-add',
    'i-ai-cfg', 'i-ai-save', 'i-ai-test',
    'i-ai-usage', 'i-ai-usage-refresh', 'i-ai-usage-reset', 'i-ai-price-save'];

  document.addEventListener('click', function (e) {
    const el = e.target.closest && e.target.closest('[data-action]');
    if (!el) return;
    const act = el.getAttribute('data-action');
    if (ACTIONS.indexOf(act) < 0) return;
    e.stopPropagation();
    if (act === 'i-ocr') openOcr();
    else if (act === 'i-ocr-pick') recognize(el.getAttribute('data-src'));
    else if (act === 'i-ocr-again') { draft = null; lastError = ''; rerender(); }
    else if (act === 'i-ocr-add') addAll();
    else if (act === 'i-ai-cfg') openAiConfig();
    else if (act === 'i-ai-save') saveAiConfig();
    else if (act === 'i-ai-test') testAiConfig();
    else if (act === 'i-ai-usage') openAiUsage();
    else if (act === 'i-ai-usage-refresh') refreshBalance();
    else if (act === 'i-ai-usage-reset') { QYA.usageReset(); openAiUsage(); UI().toast('统计已清空'); }
    else if (act === 'i-ai-price-save') savePrices();
  }, true);

  function syncFromInput(t) {
    const key = t.getAttribute && t.getAttribute('data-ocr');
    if (!key || !draft) return;
    const row = draft.items[Number(t.getAttribute('data-i'))];
    if (!row) return;
    if (key === 'include') row.include = !!t.checked;
    else if (key === 'price') row.price = t.value === '' ? null : Number(t.value);
    else if (key === 'qty') row.qty = Number(t.value) || 1;
    else row[key] = t.value;
  }

  document.addEventListener('input', function (e) {
    if (e.target.getAttribute && e.target.getAttribute('data-ocr')) {
      syncFromInput(e.target);
      if (e.target.getAttribute('data-ocr') === 'include') rerender();
      else {
        // 只更新底部按钮/合计，不整体重绘，避免打断输入
        const picked = draft.items.filter(function (x) { return x.include; }).length;
        const btn = document.querySelector('[data-action="i-ocr-add"]');
        if (btn) btn.textContent = '添加 ' + picked + ' 件';
      }
    }
  }, true);

  document.addEventListener('change', function (e) {
    if (e.target.getAttribute && e.target.getAttribute('data-ocr')) syncFromInput(e.target);
  }, true);

  window.QYO = {
    openOcr: openOcr,
    openAiConfig: openAiConfig,
    ready: cfgReady,
    _test: { previewHtml: previewHtml, getDraft: function () { return draft; },
             setDraft: function (d) { draft = d; }, addAll: addAll }
  };
})();
