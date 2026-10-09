import fs from '@ohos.file.fs';
import util from '@ohos.util';
import picker from '@ohos.file.picker';
import promptAction from '@ohos.promptAction';
import reminderAgentManager from '@ohos.reminderAgentManager';
import notificationManager from '@ohos.notificationManager';
import common from '@ohos.app.ability.common';
import web_webview from '@ohos.web.webview';

/** 网页传过来的待提醒条目 */
interface ReminderItem {
  id: string;
  title: string;
  body: string;
  remindAt: string;   // yyyy-MM-dd
}

/**
 * xctally 鸿蒙原生能力桥
 *
 * 注意：@JavaScriptProxy 暴露的方法只接受/返回基本类型（string/number/boolean），
 * 且必须同步返回。所以异步操作（选文件）完成后，用 runJavaScript 回调网页。
 *
 * ⚠️ 这些代码没有在真机上验证过（我这边没有 DevEco 环境）。
 *    如果某个 API 的签名与你 SDK 里的不一致，DevEco 会直接报错并给出正确签名，
 *    按提示调整即可；实在不行先注释掉对应方法，App 其余功能不受影响。
 */
export class QYBridge {
  private ctx: common.UIAbilityContext | null = null;
  private controller: web_webview.WebviewController | null = null;
  private lastSavedPath: string = '';
  private publishedIds: Array<number> = [];

  static readonly BACK_JS: string = `
    (function () {
      var sheet = document.getElementById('sheet-root');
      if (sheet && sheet.classList.contains('open')) {
        var close = sheet.querySelector('[data-action="c-close"],[data-action="b-close"]');
        if (close) { close.click(); return 'handled'; }
      }
      var back = document.querySelector('[data-action="back"],[data-action="c-back"]');
      if (back) { back.click(); return 'handled'; }
      if (location.hash && location.hash !== '#home') { location.hash = '#home'; return 'handled'; }
      return 'exit';
    })()
  `;

  init(ctx: common.UIAbilityContext): void {
    this.ctx = ctx;
  }

  setController(c: web_webview.WebviewController): void {
    this.controller = c;
  }

  /* ---------------- 基础 ---------------- */

  isApp(): boolean {
    return true;
  }

  toast(msg: string): void {
    promptAction.showToast({ message: msg, duration: 2000 });
  }

  /* ---------------- 备份导出 / 导入 ---------------- */

  /** 写进应用私有目录，再唤起系统分享，把文件发给自己 */
  saveFile(name: string, content: string): void {
    const ctx = this.ctx;
    if (!ctx) {
      return;
    }
    try {
      const path = ctx.filesDir + '/' + name;
      const file = fs.openSync(path, fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE | fs.OpenMode.TRUNC);
      fs.writeSync(file.fd, content);
      fs.closeSync(file);
      this.lastSavedPath = path;
      this.toast('备份已导出');
    } catch (e) {
      this.toast('导出失败：' + JSON.stringify(e));
    }
  }

  /** 把刚导出的备份分享出去（微信 / 邮件 / 网盘） */
  shareLastFile(): void {
    if (!this.lastSavedPath) {
      return;
    }
    // HarmonyOS 的系统分享：@ohos.systemShare 的 ShareController
    // 不同 SDK 版本 API 略有差异，这里给出最小可用写法：
    //   import systemShare from '@ohos.systemShare';
    //   const data = new systemShare.SharedData({ utd: 'general.json', content: this.lastSavedPath });
    //   new systemShare.ShareController(data).show(context, { selectionMode: systemShare.SelectionMode.SINGLE });
    // 未在真机验证，先只提示文件位置，避免报错影响其它功能。
    this.toast('备份已保存：' + this.lastSavedPath);
  }

  /** 选一个备份文件读回来（异步，完成后回调网页） */
  pickFile(id: string): void {
    const documentPicker = new picker.DocumentViewPicker();
    const options = new picker.DocumentSelectOptions();
    options.maxSelectNumber = 1;

    documentPicker.select(options).then((uris: Array<string>) => {
      if (!uris || uris.length === 0) {
        this.deliver(id, null);
        return;
      }
      try {
        const file = fs.openSync(uris[0], fs.OpenMode.READ_ONLY);
        const stat = fs.statSync(file.fd);
        const buf = new ArrayBuffer(stat.size);
        fs.readSync(file.fd, buf);
        fs.closeSync(file);
        const decoder = util.TextDecoder.create('utf-8');
        const text = decoder.decodeWithStream(new Uint8Array(buf), { stream: false });
        this.deliver(id, text);
      } catch (e) {
        this.toast('读取失败：' + JSON.stringify(e));
        this.deliver(id, null);
      }
    }).catch(() => {
      this.deliver(id, null);
    });
  }

  private deliver(id: string, text: string | null): void {
    const c = this.controller;
    if (!c) {
      return;
    }
    const payload = text === null ? 'null' : JSON.stringify(text);
    c.runJavaScript(
      'window.QYPlatform && window.QYPlatform._deliver(' + JSON.stringify(id) + ',' + payload + ')'
    );
  }

  /* ---------------- 到期提醒 ----------------
   * 用系统代理提醒（reminderAgentManager），到点由系统弹通知，
   * 不需要应用常驻后台 —— 这是鸿蒙上最省电也最可靠的做法。
   * 需要在 module.json5 声明 ohos.permission.PUBLISH_AGENT_REMINDER。
   */

  scheduleReminders(json: string): void {
    let list: Array<ReminderItem> = [];
    try {
      list = JSON.parse(json) as Array<ReminderItem>;
    } catch (e) {
      return;
    }

    // 先撤掉上一次登记的，避免重复提醒
    for (let i = 0; i < this.publishedIds.length; i++) {
      try {
        reminderAgentManager.cancelReminder(this.publishedIds[i]);
      } catch (e) {
        // 忽略
      }
    }
    this.publishedIds = [];

    // 系统对单个应用的代理提醒数量有上限（约 30 条），超出部分不登记
    const cap = Math.min(list.length, 20);
    for (let i = 0; i < cap; i++) {
      const it = list[i];
      const parts = it.remindAt.split('-');
      if (parts.length !== 3) {
        continue;
      }
      const req: reminderAgentManager.ReminderRequestCalendar = {
        reminderType: reminderAgentManager.ReminderType.REMINDER_TYPE_CALENDAR,
        dateTime: {
          year: Number.parseInt(parts[0], 10),
          month: Number.parseInt(parts[1], 10),
          day: Number.parseInt(parts[2], 10),
          hour: 9,
          minute: 0,
          second: 0
        },
        title: it.title,
        content: it.body,
        notificationId: 1000 + i,
        slotType: notificationManager.SlotType.SOCIAL_COMMUNICATION
      };
      try {
        const publishedId = reminderAgentManager.publishReminder(req);
        this.publishedIds.push(publishedId);
      } catch (e) {
        // 单条失败不影响其它
      }
    }
  }
}
