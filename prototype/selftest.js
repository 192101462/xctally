/* xctally · 页内自检
 * ---------------------------------------------------------------
 * 打开 prototype/index.html#selftest 即会运行，把断言结果渲染成一张报告。
 * 也可以用命令行抓结果：
 *   chrome --headless --dump-dom --virtual-time-budget=6000 \
 *          "file:///.../prototype/index.html#selftest" | grep -E "SELFTEST|FAIL"
 *
 * 这些断言覆盖的是"容易悄悄算错"的地方：富文本净化、图片压缩、
 * 编辑往返（更新而不是新增）、冲突保护、图文顺序、日均成本。
 * ---------------------------------------------------------------
 */
(function () {
  'use strict';
  // 注意：必须在本文件加载时立刻读 hash —— app.js 的 mount() 会用 replaceState
  // 把地址改写成 #home，之后就读不到 selftest 标志了。
  const FLAG = (location.hash || '').indexOf('selftest') >= 0;
  if (!FLAG) return;

  const results = [];
  function ok(name, cond, detail) {
    results.push({ name: name, pass: !!cond, detail: detail == null ? '' : String(detail) });
  }
  function eq(name, got, want) {
    ok(name, got === want, 'got=' + got + ' / want=' + want);
  }

  // 造一张 1800×1350 的"照片"（随机噪声，PNG 压不动），用来验证压缩
  function bigPhoto() {
    return new Promise(function (resolve) {
      const c = document.createElement('canvas');
      c.width = 1800;
      c.height = 1350;
      const g = c.getContext('2d');
      const img = g.createImageData(1800, 1350);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        d[i] = (Math.random() * 255) | 0;
        d[i + 1] = (Math.random() * 255) | 0;
        d[i + 2] = (Math.random() * 255) | 0;
        d[i + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      c.toBlob(function (b) {
        resolve(new File([b], 'photo.png', { type: 'image/png' }));
      }, 'image/png');
    });
  }

  // 检查 dataURL 的二进制里有没有 EXIF 标记
  function hasExifMarker(dataUrl) {
    try {
      const bin = atob(String(dataUrl).slice(String(dataUrl).indexOf(',') + 1));
      return bin.indexOf('Exif') >= 0;
    } catch (e) {
      return true;
    }
  }

  function run() {
    const QY = window.QY;
    const QYV = window.QYV;
    const QYB = window.QYB;
    const QYUI = window.QYUI;

    ok('模块加载 QY / QYV / QYB / QYUI', !!(QY && QYV && QYB && QYUI));
    if (!(QY && QYV && QYB)) return Promise.resolve();
    const T = QYV._test;

    /* ---------- 1. 富文本净化 ---------- */
    const dirty =
      '<p onclick="alert(1)">a<script>bad()</script><strong>b</strong></p>' +
      '<img src="data:image/png;base64,AAA" onerror="alert(1)">' +
      '<img src="https://evil.example/x.png">' +
      '<div style="color:red">c</div><!-- 注释 -->';
    const clean = T.sanitize(dirty);
    ok('净化：script 标签被整块删除', clean.indexOf('script') < 0, clean.slice(0, 80));
    ok('净化：script 内容不会变成正文', clean.indexOf('bad()') < 0, clean.slice(0, 80));
    ok('净化：去掉 onclick / onerror', clean.indexOf('onclick') < 0 && clean.indexOf('onerror') < 0);
    ok('净化：去掉 style 属性', clean.indexOf('style=') < 0);
    ok('净化：去掉注释', clean.indexOf('<!--') < 0);
    ok('净化：保留 strong', clean.indexOf('<strong>') >= 0);
    ok('净化：保留 p', clean.indexOf('<p') >= 0);
    ok('净化：丢弃非 data: 的图片', clean.indexOf('evil.example') < 0);
    ok('净化：保留 data: 图片', clean.indexOf('data:image/png') >= 0);
    ok('净化：div 被拆成纯文本', clean.indexOf('<div') < 0 && clean.indexOf('c') >= 0);

    /* ---------- 2. 图文顺序 ---------- */
    const blocks = T.blocksOf('<p>第一段</p><img src="data:image/png;base64,AAA"><p>第二段</p>');
    eq('图文顺序：块数量', blocks.length, 3);
    eq('图文顺序：第 1 块是文字', blocks[0] && blocks[0].t, 'p');
    eq('图文顺序：第 2 块是图片', blocks[1] && blocks[1].t, 'img');
    eq('图文顺序：第 3 块是文字', blocks[2] && blocks[2].t, 'p');

    /* ---------- 3. 复制文案 ---------- */
    const txt = T.shareText({
      title: '标题', cat: '生活', date: '2026-01-02', tags: ['咖啡'],
      plugins: [{ k: 'rating', v: 4 }, { k: 'price', v: 12.9 }],
      bodyHtml: '<p>正文一句</p><img src="data:image/png;base64,AAA">'
    });
    ok('复制文案：图片转成［图片］占位', txt.indexOf('［图片］') >= 0, txt.replace(/\n/g, ' | '));
    ok('复制文案：带星级与价格', txt.indexOf('★★★★') >= 0 && txt.indexOf('¥12.90') >= 0);
    ok('复制文案：带标签', txt.indexOf('#咖啡') >= 0);

    /* ---------- 4. 图片压缩 ---------- */
    return bigPhoto().then(function (file) {
      ok('测试用大图已生成（>1MB PNG）', file.size > 1024 * 1024, T.humanSize(file.size));
      return T.compressImage(file).then(function (r) {
        ok('压缩：体积至少减半', r.after < file.size * 0.5,
          T.humanSize(r.before) + ' → ' + T.humanSize(r.after));
        ok('压缩：长边限制到 1600', r.kept === 'original' || Math.max(r.w, r.h) === 1600,
          r.w + '×' + r.h + ' kept=' + r.kept);
        ok('压缩：重编码为 JPEG', r.kept === 'original' || r.dataUrl.indexOf('data:image/jpeg') === 0);
        ok('压缩：输出不含 Exif 标记（元数据被丢弃）', !hasExifMarker(r.dataUrl));
      });
    }).then(function () {
      // 动图必须原样保留，否则动画丢失
      const gifBytes = new Uint8Array([71, 73, 70, 56, 57, 97, 1, 2, 3]);
      const gif = new File([gifBytes], 'anim.gif', { type: 'image/gif' });
      return T.compressImage(gif).then(function (r) {
        ok('动图：走原样通道，标记为 gif', r.gif === true);
        ok('动图：保持 image/gif 不被重编码', r.dataUrl.indexOf('data:image/gif') === 0);
      });
    }).then(function () {
      /* ---------- 5. 编辑往返（必须是更新，不是新增） ---------- */
      const first = QYV.recent(1)[0];
      ok('存在一条随笔可用于编辑测试', !!first);
      const before = QYV.count();
      const originalTitle = first.title;

      // 走真实点击路径：切到收藏标签 → 点开这一条 → 点编辑
      const tabBtn = document.querySelector('[data-action="tab"][data-tab="collect"]');
      ok('底部标签栏有「收藏」', !!tabBtn);
      if (tabBtn) tabBtn.click();
      const row = document.querySelector('[data-action="c-detail"][data-id="' + first.id + '"]');
      ok('收藏列表里能找到这条随笔', !!row);
      if (row) row.click();

      const editBtn = document.querySelector('[data-action="c-edit"]');
      ok('详情页存在「编辑」按钮', !!editBtn);
      if (!editBtn) return;

      editBtn.click();
      const titleEl = document.getElementById('c-title');
      const bodyEl = document.getElementById('c-body');
      ok('编辑：标题已预填', titleEl && titleEl.value === originalTitle, titleEl && titleEl.value);
      ok('编辑：正文已预填（含图片）', bodyEl && bodyEl.innerHTML.indexOf('<img') >= 0);
      eq('编辑：插件字段已预填数量', document.querySelectorAll('#plugin-fields .plugin-field').length,
        (T.get(first.id).plugins || []).length);

      // 改标题，并往正文里塞一段脏 HTML，验证保存时会净化
      titleEl.value = 'SELFTEST-EDIT-OK';
      bodyEl.innerHTML = '<p>改过的正文</p><script>alert(1)</script><img src="https://evil.example/x.png">';
      document.querySelector('[data-action="c-save"]').click();

      eq('编辑保存：条数不变（是更新不是新增）', QYV.count(), before);
      const saved = T.get(first.id);
      eq('编辑保存：标题已更新', saved.title, 'SELFTEST-EDIT-OK');
      ok('编辑保存：脏脚本被净化', String(saved.bodyHtml).indexOf('script') < 0, saved.bodyHtml);
      ok('编辑保存：外链图片被丢弃', String(saved.bodyHtml).indexOf('evil.example') < 0);
      ok('编辑保存：正文文字保留', String(saved.bodyHtml).indexOf('改过的正文') >= 0);

      // 复原，别污染演示数据（收藏数据要存 xctally.collect.v1，不是 app 数据）
      saved.title = originalTitle;
      QYV.save();
    }).then(function () {
      /* ---------- 6. 备份与冲突保护 ---------- */
      const pkg = QYB.buildBackup();
      eq('备份：格式标识', pkg.format, 'xctally.backup');
      ok('备份：包含物品', pkg.app.items.length > 0, pkg.app.items.length);
      ok('备份：包含随笔', pkg.collect.entries.length > 0, pkg.collect.entries.length);
      ok('备份：包含能源表具', pkg.app.meters.length > 0, pkg.app.meters.length);

      const target = QYV.recent(1)[0];
      const original = T.get(target.id).title;
      const remoteOld = JSON.parse(JSON.stringify(T.get(target.id)));
      remoteOld.title = 'BACKUP-OLD-TITLE';

      const r1 = QYV.merge({ entries: [remoteOld], cats: [] }, false);
      eq('冲突：默认判定为冲突', r1.conflict, 1);
      eq('冲突：本地版本未被覆盖', T.get(target.id).title, original);

      const r2 = QYV.merge({ entries: [JSON.parse(JSON.stringify(remoteOld))], cats: [] }, true);
      eq('冲突：选择对方版本时执行更新', r2.updated, 1);
      eq('冲突：已采用对方版本', T.get(target.id).title, 'BACKUP-OLD-TITLE');

      // 复原
      T.get(target.id).title = original;
      QYV.save();
    }).then(function () {
      /* ---------- 7. 物品成本计算 ---------- */
      const d = QY.load();
      const faqia = d.items.filter(function (i) { return i.id === 'it_faqia'; })[0];
      ok('成本：找到发卡这条记录', !!faqia);
      if (faqia) {
        ok('成本：持有天数大于 200 天', QY.heldDays(faqia) > 200, QY.heldDays(faqia));
        const expect = 9.9 / QY.heldDays(faqia);
        ok('成本：日均成本 = 总价 ÷ 持有天数',
          Math.abs(QY.perDay(faqia, d) - expect) < 1e-9,
          QY.perDay(faqia, d).toFixed(4));
        ok('成本：未过期的牛奶不会计入浪费',
          d.items.filter(function (i) { return i.id === 'it_milk'; })[0] &&
          !QY.isExpired(d.items.filter(function (i) { return i.id === 'it_milk'; })[0]));
      }
      const s = QY.summaries(d);
      ok('汇总：已浪费金额等于三条过期物品之和',
        Math.abs(s.wasted - 38.6) < 0.01, s.wasted);
      ok('汇总：持有成本合计为正常数值', s.daily > 1 && s.daily < 500, s.daily.toFixed(2));

      /* ---------- 7b. 物品模块：日均成本开关 / 归档 / 分类 ---------- */
      const food = d.items.filter(function (i) { return i.category === '食品'; })[0];
      const drug = d.items.filter(function (i) { return i.category === '药品'; })[0];
      const durable = d.items.filter(function (i) { return i.category === '电子'; })[0];
      ok('成本开关：食品默认不计入日均成本', !!food && QY.tracksCost(food, d) === false);
      ok('成本开关：药品默认不计入日均成本', !!drug && QY.tracksCost(drug, d) === false);
      ok('成本开关：电子默认计入日均成本', !!durable && QY.tracksCost(durable, d) === true);
      ok('成本开关：物品上的显式设置优先于分类默认值',
        QY.tracksCost({ category: '食品', costTrack: true }, d) === true);
      ok('汇总：日均合计只统计计入的物品', s.dailyCount > 0 && s.dailyCount < s.count,
        s.dailyCount + '/' + s.count);

      ok('归档：已处置算归档', QY.isArchived({ status: '已处置' }) === true);
      ok('归档：已用完算归档', QY.isArchived({ status: '已用完' }) === true);
      ok('归档：在用不算归档', QY.isArchived({ status: '在用' }) === false);
      ok('归档：改回在用即可还原', QY.isActive({ status: '已处置' }) === false &&
        QY.isActive({ status: '在用' }) === true);

      ok('缩略图：无图片时取名称首字', QY.thumbChar({ name: '发卡' }) === '发');
      ok('缩略图：有图片时走 background-image', QY.thumbStyle({ photo: 'data:image/png;base64,AAA' })
        .indexOf('background-image') >= 0);
      ok('分类：未知分类回退为未分类', QY.catOf('不存在', d).name === '未分类');
      ok('分类：分类列表来自数据（可自定义）', QY.catList(d).length === d.itemCats.length);
      ok('物品模块已加载 QYI', !!window.QYI);
    }).then(function () {
      /* ---------- 8. 存储占用（信息项） ---------- */
      const imgBytes = QYV.imageBytes();
      ok('存储：随笔图片占用已统计', imgBytes > 0, QYUI ? '' : '');
      results.push({ name: '存储：随笔图片合计', pass: true, detail: T.humanSize(imgBytes) });
      results.push({ name: '存储：localStorage 合计', pass: true, detail: T.humanSize(
        (localStorage.getItem('xctally.prototype.v1') || '').length +
        (localStorage.getItem('xctally.collect.v1') || '').length) });
    });
  }

  function render() {
    const pass = results.filter(function (r) { return r.pass; }).length;
    const fail = results.length - pass;
    // 失败项置顶，保证一屏之内先看到问题
    const sorted = results.slice().sort(function (a, b) {
      return (a.pass === b.pass) ? 0 : (a.pass ? 1 : -1);
    });
    const row = function (r) {
      return '<div class="t ' + (r.pass ? 'ok' : 'bad') + '">' +
        (r.pass ? '' : '<b>FAIL</b> ') + r.name +
        (r.detail ? '<i>' + r.detail + '</i>' : '') + '</div>';
    };
    document.body.innerHTML =
      '<div class="selftest">' +
        '<button class="back-app" onclick="location.hash=\'\';location.reload()">← 返回应用</button>' +
        '<h1>SELFTEST ' + (fail === 0 ? 'ALL PASSED' : 'FAILED') + ' · ' + pass + '/' + results.length + '</h1>' +
        '<p class="sub">琪遇台账 页内自检 · ' + new Date().toLocaleString() +
          ' · 失败项已置顶，通过的只列名称</p>' +
        sorted.map(row).join('') +
        '<style>' +
        'body{background:#0b0f14;color:#e6edf3;font:13px/1.5 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;margin:0}' +
        '.selftest{padding:20px 26px;max-width:1000px}' +
        '.back-app{background:#21262d;color:#58a6ff;border:1px solid #30363d;border-radius:8px;' +
        'padding:6px 14px;font:13px inherit;cursor:pointer;margin-bottom:14px}' +
        'h1{font-size:20px;margin:0 0 3px}' +
        '.sub{color:#7d8590;margin:0 0 14px;font-size:12px}' +
        '.t{padding:4px 11px;border-radius:7px;margin-bottom:3px;background:#161b22;border-left:3px solid #238636}' +
        '.t.bad{background:#2d1418;border-left-color:#f85149;padding:8px 11px}' +
        '.t b{font-size:11px;font-weight:700;letter-spacing:.06em;margin-right:8px;color:#f85149}' +
        '.t.ok{color:#8b949e}' +
        '.t i{display:block;color:#7d8590;font-style:normal;font-size:11.5px;margin-top:2px;word-break:break-all}' +
        '.t.bad i{color:#ffa198}' +
        '</style>' +
      '</div>';
  }

  // 本文件在 app.js 之前加载，所以延后到所有脚本执行完、应用初始化之后再跑
  setTimeout(function () {
    try {
      Promise.resolve(run()).then(render, function (err) {
        ok('自检本身没有抛异常', false, err && err.message);
        render();
      });
    } catch (err) {
      ok('自检本身没有抛异常', false, err && err.message);
      render();
    }
  }, 0);
})();
