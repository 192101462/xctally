import fs from '@ohos.file.fs';
import util from '@ohos.util';
import picker from '@ohos.file.picker';
import promptAction from '@ohos.promptAction';
import reminderAgentManager from '@ohos.reminderAgentManager';
import notificationManager from '@ohos.notificationManager';
import photoAccessHelper from '@ohos.file.photoAccessHelper';
import image from '@ohos.multimedia.image';
import { cameraPicker } from '@kit.CameraKit';
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
 * xctally 鸿蒙原生能力桥（网页里是 window.QYHarmony）
 *
 * 注意：@JavaScriptProxy 暴露的方法只接受/返回基本类型（string/number/boolean），
 * 且必须同步返回。所以异步操作（选文件 / 选图）完成后，用 runJavaScript 回调网页：
 *   window.QYPlatform._deliver(id, text)       ← pickFile 的结果
 *   window.QYPlatform._deliverImage(id, dataUrl) ← pickImage 的结果
 *
 * 与安卓壳的 Bridge 一一对应，网页侧 platform.js 无需任何修改。
 */
export class QYBridge {
  private ctx: common.UIAbilityContext | null = null;
  private controller: web_webview.WebviewController | null = null;
  private lastSavedName: string = '';
  private publishedIds: Array<number> = [];
  private lastReminderJson: string = '';   // 同一份清单不重复登记

  /**
   * 网页里统一的"返回上一层"逻辑，按层级从最上层往下试。
   * 与安卓壳 MainActivity.BACK_JS 保持一致 —— 两边改一处要同步另一处。
   */
  static readonly BACK_JS: string = `
    (function () {
      try {
        var el;
        var layer = document.getElementById('picker-layer');
        if (layer) {
          var lb = layer.querySelector('[data-action="i-pick-close"],[data-action="i-photo-cancel"]');
          if (lb) { lb.click(); } else { layer.remove(); }
          return 'handled';
        }
        var cf = document.getElementById('qy-confirm');
        if (cf) {
          var cb = cf.querySelector('[data-c="0"]');
          if (cb) { cb.click(); } else { cf.remove(); }
          return 'handled';
        }
        var dm = document.querySelector('.seg-dd-menu');
        if (dm) { dm.remove(); return 'handled'; }
        var zen = document.getElementById('zen-root');
        if (zen) {
          var zd = zen.querySelector('[data-action="c-zen-done"]');
          if (zd) { zd.click(); return 'handled'; }
          zen.remove(); return 'handled';
        }
        var fp = document.getElementById('fp-root');
        if (fp && fp.classList.contains('open')) {
          var fb = fp.querySelector('[data-action="fp-back"]');
          if (fb) { fb.click(); return 'handled'; }
        }
        var sheet = document.getElementById('sheet-root');
        if (sheet && sheet.classList.contains('open')) {
          var scrim = sheet.querySelector('.scrim');
          if (scrim) { scrim.click(); return 'handled'; }
          var close = sheet.querySelector('[data-action="c-close"],[data-action="b-close"],[data-action="close-sheet"]');
          if (close) { close.click(); return 'handled'; }
        }
        var s1 = document.querySelector('[data-action="set-back"]');
        if (s1) { s1.click(); return 'handled'; }
        var s2 = document.querySelector('[data-action="set-close"]');
        if (s2) { s2.click(); return 'handled'; }
        var back = document.querySelector('[data-action="i-back"],[data-action="back"],[data-action="c-back"]');
        if (back) { back.click(); return 'handled'; }
        return 'exit';
      } catch (e) { return 'exit'; }
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

  /** 当前安装的版本号：网页"检查更新"一行展示用（鸿蒙侧更新走应用市场） */
  appVersion(): string {
    try {
      const ctx = this.ctx;
      if (!ctx) {
        return '';
      }
      return ctx.applicationInfo.versionName ?? '';
    } catch (e) {
      return '';
    }
  }

  toast(msg: string): void {
    promptAction.showToast({ message: msg, duration: 2000 });
  }

  /* ---------------- 备份导出 / 导入 ---------------- */

  /**
   * 导出备份：弹系统"保存"面板，用户自己选位置（下载 / 文档 / 网盘目录）。
   * 不像安卓那样先写私有目录再分享 —— 鸿蒙的应用私有目录用户根本看不到，
   * 直接让用户选目的地是最诚实也最少坑的做法。
   */
  saveFile(name: string, content: string): void {
    const ctx = this.ctx;
    if (!ctx) {
      return;
    }
    // 文件名收一道白名单，与安卓壳保持一致，防 "../" 之类越界
    const safe = name.split('/').pop()!.split('\\').pop()!
      .replace(/[^0-9A-Za-z.\-_]/g, '');
    const fileName = safe.length ? safe : 'backup.json';

    const docPicker = new picker.DocumentViewPicker(ctx);
    const opt = new picker.DocumentSaveOptions();
    opt.newFileNames = [fileName];
    docPicker.save(opt).then((uris: Array<string>) => {
      if (!uris || uris.length === 0) {
        this.toast('已取消导出');
        return;
      }
      try {
        const file = fs.openSync(uris[0], fs.OpenMode.READ_WRITE | fs.OpenMode.TRUNC);
        fs.writeSync(file.fd, content);
        fs.closeSync(file);
        this.lastSavedName = fileName;
        this.toast('备份已保存：' + fileName);
      } catch (e) {
        this.toast('保存失败：' + JSON.stringify(e));
      }
    }).catch(() => {
      this.toast('已取消导出');
    });
  }

  /**
   * 安卓壳里这一步是"唤起系统分享"；鸿蒙壳导出时用户已经选好了目的地，
   * 没有再分享一次的必要 —— 提示一下存到了哪里即可（platform.js 会无条件调用）。
   */
  shareLastFile(): void {
    if (this.lastSavedName) {
      this.toast('备份已保存：' + this.lastSavedName);
    }
  }

  /** 选一个备份文件读回来（异步，完成后回调网页） */
  pickFile(id: string): void {
    const ctx = this.ctx;
    if (!ctx) {
      this.deliver(id, null);
      return;
    }
    const documentPicker = new picker.DocumentViewPicker(ctx);
    const options = new picker.DocumentSelectOptions();
    options.maxSelectNumber = 1;

    documentPicker.select(options).then((uris: Array<string>) => {
      if (!uris || uris.length === 0) {
        this.deliver(id, null);
        return;
      }
      try {
        const text = this.readTextFromUri(uris[0]);
        this.deliver(id, text);
      } catch (e) {
        this.toast('读取失败：' + JSON.stringify(e));
        this.deliver(id, null);
      }
    }).catch(() => {
      this.deliver(id, null);
    });
  }

  private readTextFromUri(uri: string): string {
    const file = fs.openSync(uri, fs.OpenMode.READ_ONLY);
    try {
      const stat = fs.statSync(file.fd);
      const buf = new ArrayBuffer(stat.size);
      fs.readSync(file.fd, buf);
      const decoder = util.TextDecoder.create('utf-8');
      return decoder.decodeWithStream(new Uint8Array(buf), { stream: false });
    } finally {
      fs.closeSync(file);
    }
  }

  /* ---------------- 选图（拍照 / 相册） ----------------
   * 网页里 <input type="file"> 在 ArkWeb 里同样没反应，
   * 图片一律走原生入口，压缩成长边 1600 的 JPEG dataURL 再回传，
   * 与安卓壳 readImageAsDataUrl 的参数一致。GIF 原样透传（解码会毁掉动画）。
   */

  pickImage(id: string, source: string): void {
    if (source === 'camera') {
      this.pickImageFromCamera(id);
    } else {
      // ''（未指定）与 'gallery' 都走相册
      this.pickImageFromGallery(id);
    }
  }

  private pickImageFromGallery(id: string): void {
    const ctx = this.ctx;
    if (!ctx) {
      this.deliverImage(id, null);
      return;
    }
    const photoPicker = new photoAccessHelper.PhotoViewPicker();
    const opt = new photoAccessHelper.PhotoSelectOptions();
    opt.MIMEType = photoAccessHelper.PhotoViewMIMETypes.IMAGE_TYPE;
    opt.maxSelectNumber = 1;
    photoPicker.select(opt).then((result: photoAccessHelper.PhotoSelectResult) => {
      if (!result.photoUris || result.photoUris.length === 0) {
        this.deliverImage(id, null);
        return;
      }
      this.uriToDataUrl(result.photoUris[0]).then((dataUrl: string | null) => {
        if (!dataUrl) {
          this.toast('读不出这张图片');
        }
        this.deliverImage(id, dataUrl);
      }).catch(() => {
        this.deliverImage(id, null);
      });
    }).catch(() => {
      this.deliverImage(id, null);
    });
  }

  private pickImageFromCamera(id: string): void {
    const ctx = this.ctx;
    if (!ctx) {
      this.deliverImage(id, null);
      return;
    }
    // 系统"拍照 Picker"：全屏相机界面，拍完返回 URI，不需要自己申请相机权限
    cameraPicker.pickCamera(ctx, [cameraPicker.PickerMediaType.PHOTO])
      .then((result: cameraPicker.PickerResult) => {
      if (result.resultCode !== 0 || !result.resultUri) {
        this.deliverImage(id, null);
        return;
      }
      this.uriToDataUrl(result.resultUri).then((dataUrl: string | null) => {
        if (!dataUrl) {
          this.toast('读不出这张图片');
        }
        this.deliverImage(id, dataUrl);
      }).catch(() => {
        this.deliverImage(id, null);
      });
    }).catch(() => {
      // 相机不可用（模拟器 / 平板无摄像头等）：退回相册，别让用户卡死
      this.pickImageFromGallery(id);
    });
  }

  /** 图片 URI -> 长边 1600 的 JPEG dataURL；GIF 原样透传 */
  private async uriToDataUrl(uri: string): Promise<string | null> {
    const file = fs.openSync(uri, fs.OpenMode.READ_ONLY);
    try {
      // GIF：解码会毁掉动画，读原始字节直接透传
      const head = new ArrayBuffer(4);
      fs.readSync(file.fd, head, { offset: 0, length: 4 });
      const magic = new Uint8Array(head);
      if (magic[0] === 0x47 && magic[1] === 0x49 && magic[2] === 0x46 && magic[3] === 0x38) {
        const stat = fs.statSync(file.fd);
        const raw = new ArrayBuffer(stat.size);
        fs.readSync(file.fd, raw);
        const b64 = new util.Base64Helper().encodeToStringSync(new Uint8Array(raw));
        return 'data:image/gif;base64,' + b64;
      }

      const source = image.createImageSource(file.fd);
      const info = await source.getImageInfo();
      const w = info.size.width;
      const h = info.size.height;
      const longSide = Math.max(w, h);
      let targetW = w;
      let targetH = h;
      if (longSide > 1600) {
        const ratio = 1600 / longSide;
        targetW = Math.max(1, Math.round(w * ratio));
        targetH = Math.max(1, Math.round(h * ratio));
      }
      const decodeOpt: image.DecodingOptions = {
        desiredSize: { width: targetW, height: targetH }
      };
      const pixelMap = await source.createPixelMap(decodeOpt);
      const packer = image.createImagePacker();
      const packOpt: image.PackingOptions = { format: 'image/jpeg', quality: 88 };
      const packed = await packer.packing(pixelMap, packOpt);
      packer.release();
      pixelMap.release();
      source.release();
      if (packed.byteLength === 0) {
        return null;
      }
      const b64 = new util.Base64Helper().encodeToStringSync(new Uint8Array(packed));
      return 'data:image/jpeg;base64,' + b64;
    } finally {
      fs.closeSync(file);
    }
  }

  /* ---------------- 到期提醒 ----------------
   * 用系统代理提醒（reminderAgentManager），到点由系统弹通知，
   * 不需要应用常驻后台 —— 鸿蒙对后台常驻管得很严，这是标准做法。
   * 注意 publishReminder / cancelReminder 都是异步 API（返回 Promise）。
   */

  scheduleReminders(json: string): void {
    // 网页每次渲染都会推全量清单，同一份不重复登记
    if (json === this.lastReminderJson) {
      return;
    }
    this.lastReminderJson = json;

    let list: Array<ReminderItem> = [];
    try {
      list = JSON.parse(json) as Array<ReminderItem>;
    } catch (e) {
      return;
    }

    // 先撤掉上一次登记的，避免重复提醒
    const olds = this.publishedIds;
    this.publishedIds = [];
    for (let i = 0; i < olds.length; i++) {
      reminderAgentManager.cancelReminder(olds[i]).catch(() => {
      });
    }

    this.ensureNotificationEnabled();

    // 系统对单个应用的代理提醒数量有上限（约 30 条），超出部分不登记；
    // 已经过期的日期也不登记（日历提醒对过去时间不会响）
    const today = this.todayStr();
    const valid = list.filter((it: ReminderItem) => it.remindAt >= today);
    const cap = Math.min(valid.length, 20);
    for (let i = 0; i < cap; i++) {
      const it = valid[i];
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
          hour: 9,          // 与安卓壳一致：当天上午 9 点
          minute: 0,
          second: 0
        },
        title: it.title,
        content: it.body,
        notificationId: 1000 + i,
        slotType: notificationManager.SlotType.SOCIAL_COMMUNICATION
      };
      reminderAgentManager.publishReminder(req).then((publishedId: number) => {
        this.publishedIds.push(publishedId);
      }).catch(() => {
        // 单条失败不影响其它（多半是通知开关没开，见 ensureNotificationEnabled）
      });
    }
  }

  /** 通知总开关没开的话提醒发不出来，引导用户打开（只引导一次） */
  private notifAsked: boolean = false;
  private ensureNotificationEnabled(): void {
    if (this.notifAsked) {
      return;
    }
    notificationManager.isNotificationEnabled().then((enabled: boolean) => {
      if (enabled) {
        return;
      }
      const ctx = this.ctx;
      if (!ctx) {
        return;
      }
      notificationManager.requestEnableNotification(ctx).then(() => {
        this.notifAsked = true;
      }).catch(() => {
        this.notifAsked = true;   // 用户拒绝就不再打扰
      });
    }).catch(() => {
    });
  }

  private todayStr(): string {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  /* ---------------- 回调网页 ---------------- */

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

  private deliverImage(id: string, dataUrl: string | null): void {
    const c = this.controller;
    if (!c) {
      return;
    }
    const payload = dataUrl === null ? 'null' : JSON.stringify(dataUrl);
    c.runJavaScript(
      'window.QYPlatform && window.QYPlatform._deliverImage(' + JSON.stringify(id) + ',' + payload + ')'
    );
  }
}
