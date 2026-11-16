import fs from '@ohos.file.fs';
import util from '@ohos.util';
import picker from '@ohos.file.picker';
import promptAction from '@ohos.promptAction';
import reminderAgentManager from '@ohos.reminderAgentManager';
import notificationManager from '@ohos.notificationManager';
import photoAccessHelper from '@ohos.file.photoAccessHelper';
import image from '@ohos.multimedia.image';
import { cameraPicker } from '@kit.CameraKit';
import camera from '@ohos.multimedia.camera';
import notification from '@ohos.notification';
import bundleManager from '@ohos.bundle.bundleManager';
import common from '@ohos.app.ability.common';
import web_webview from '@ohos.web.webview';
import { window } from '@kit.ArkUI';
import { display } from '@kit.ArkUI';
import { http } from '@kit.NetworkKit';
import Want from '@ohos.app.ability.Want';

/** 网页传过来的待提醒条目 */
interface ReminderItem {
  id: string;
  title: string;
  body: string;
  remindAt: string;   // yyyy-MM-DD
}

/** gitee version.json 的结构（应用内更新用） */
interface VersionInfo {
  versionName: string;
  versionCode: number;
  apkUrl: string;
  notes: string;
}

/** 物品每日提醒条目（与安卓壳 scheduleItemReminders 的清单一致） */
interface ItemReminderItem {
  id: string;
  name: string;
  hour: number;
  minute: number;
  alarm: boolean;     // true = 闹铃（高优先级+声音震动）
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
    this.setupWindow();
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
      const info = bundleManager.getBundleInfoForSelfSync(bundleManager.BundleFlag.GET_BUNDLE_INFO_DEFAULT);
      return info.versionName ?? '';
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
    // API 26：pickCamera 改成 pick，且必须给 PickerProfile（相机位置）
    const profile = new cameraPicker.PickerProfile();
    profile.cameraPosition = camera.CameraPosition.CAMERA_POSITION_BACK;
    cameraPicker.pick(ctx, [cameraPicker.PickerMediaType.PHOTO], profile)
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
      const packOpt: image.PackingOption = { format: 'image/jpeg', quality: 88 };
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

  scheduleReminders(json: string, hour: number): void {
    // 网页每次渲染都会推全量清单，同一份不重复登记
    if (json === this.lastReminderJson) {
      return;
    }
    this.lastReminderJson = json;
    const h = Math.min(23, Math.max(0, Math.floor(hour))) || 9;

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
          hour: h,          // 用户在设置里选的提醒钟点
          minute: 0,
          second: 0
        },
        title: it.title,
        content: it.body,
        notificationId: 1000 + i,
        slotType: notification.SlotType.SOCIAL_COMMUNICATION
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

  /* ---------------- 物品每日提醒（吃药/喝牛奶打卡） ----------------
   * 与到期提醒同一套 reminderAgentManager，但用的是"闹钟型"：
   * ReminderRequestAlarm = 每周指定的几天在固定时分触发 ——
   * 每天都提醒就传 [1..7]。系统托管，App 被杀/重启都不影响，
   * 比安卓壳的 AlarmManager 方案还省心（不用开机广播重排）。 */

  private lastItemReminderJson: string = '';
  private publishedItemIds: Array<number> = [];

  scheduleItemReminders(json: string): void {
    if (json === this.lastItemReminderJson) {
      return;
    }
    this.lastItemReminderJson = json;

    let list: Array<ItemReminderItem> = [];
    try {
      list = JSON.parse(json) as Array<ItemReminderItem>;
    } catch (e) {
      return;
    }

    // 撤掉上一轮登记的，全量重排
    const olds = this.publishedItemIds;
    this.publishedItemIds = [];
    for (let i = 0; i < olds.length; i++) {
      reminderAgentManager.cancelReminder(olds[i]).catch(() => {
      });
    }

    this.ensureNotificationEnabled();

    // 系统对单个应用的代理提醒数量有上限（约 30，还要给到期提醒留名额），这里封 8 条
    const cap = Math.min(list.length, 8);
    for (let i = 0; i < cap; i++) {
      const it = list[i];
      const hour = Math.min(23, Math.max(0, Math.floor(it.hour))) || 0;
      const minute = Math.min(59, Math.max(0, Math.floor(it.minute))) || 0;
      const req: reminderAgentManager.ReminderRequestAlarm = {
        reminderType: reminderAgentManager.ReminderType.REMINDER_TYPE_ALARM,
        hour: hour,
        minute: minute,
        daysOfWeek: [1, 2, 3, 4, 5, 6, 7],   // 每天都提醒
        title: '琪遇台账 · 每日提醒',
        content: it.alarm ? '该「' + it.name + '」啦（闹钟提醒）' : '别忘了今天的「' + it.name + '」',
        notificationId: 2000 + i,
        // 闹铃用社交通信槽（带声音震动、高优先级），普通提醒用服务信息槽（安静）
        slotType: it.alarm
          ? notification.SlotType.SOCIAL_COMMUNICATION
          : notification.SlotType.SERVICE_INFORMATION
      };
      reminderAgentManager.publishReminder(req).then((publishedId: number) => {
        this.publishedItemIds.push(publishedId);
      }).catch(() => {
        // 单条失败不影响其它（多半是通知开关没开 / 条数到上限）
      });
    }
  }

  /* ---------------- 通知链路状态（网页提醒面板顶部的红字提示用） ---------------- */

  /** 通知通不通：总开关没开，提醒到点也弹不出来 */
  notifOn(): boolean {
    try {
      return notificationManager.isNotificationEnabledSync();
    } catch (e) {
      return true;   // 查询本身失败就按"没问题"处理，不挡用户操作
    }
  }

  /** 去开通知：优先弹系统授权框；被拒过弹不出来就提示手动去设置 */
  openNotifSettings(): void {
    const ctx = this.ctx;
    if (!ctx) {
      return;
    }
    notificationManager.isNotificationEnabled().then((enabled: boolean) => {
      if (enabled) {
        return;
      }
      notificationManager.requestEnableNotification(ctx).then(() => {
      }).catch(() => {
        // 用户以前拒过两次，系统不再弹框：只能去 设置 → 通知 手动开
        this.toast('请在 设置 → 通知 里开启「琪遇台账」的通知');
      });
    }).catch(() => {
    });
  }

  /* ---------------- 测试通知（设置页「发条测试通知」） ----------------
   * 两条通道各发一条：服务信息（普通）+ 社交通信（带声音震动），
   * 发完就知道链路通不通。 */

  testReminder(): void {
    const send = (id: number, slot: notificationManager.SlotType,
                  title: string, text: string): void => {
      const req: notificationManager.NotificationRequest = {
        id: id,
        notificationSlotType: slot,
        content: {
          notificationContentType: notificationManager.ContentType.NOTIFICATION_CONTENT_BASIC_TEXT,
          normal: {
            title: title,
            text: text,
            additionalText: '琪遇台账'
          }
        }
      };
      notificationManager.publish(req).catch(() => {
        this.toast('通知没发出去：通知开关可能没开');
      });
    };
    send(9001, notificationManager.SlotType.SERVICE_INFORMATION,
      '琪遇台账 · 测试通知（普通）', '普通提醒通道是通的');
    send(9002, notificationManager.SlotType.SOCIAL_COMMUNICATION,
      '琪遇台账 · 测试通知（闹铃）', '闹铃通道是通的（带声音震动）');
  }

  /* ---------------- 选视频（随笔内嵌短片） ----------------
   * 与安卓壳同契约：不转码、2.5MB 内原样回传 dataURL，超限提示。 */

  pickVideo(id: string): void {
    const ctx = this.ctx;
    if (!ctx) {
      this.deliverVideo(id, null);
      return;
    }
    const videoPicker = new photoAccessHelper.PhotoViewPicker();
    const opt = new photoAccessHelper.PhotoSelectOptions();
    opt.MIMEType = photoAccessHelper.PhotoViewMIMETypes.VIDEO_TYPE;
    opt.maxSelectNumber = 1;
    videoPicker.select(opt).then((result: photoAccessHelper.PhotoSelectResult) => {
      if (!result.photoUris || result.photoUris.length === 0) {
        this.deliverVideo(id, null);
        return;
      }
      this.videoUriToDataUrl(result.photoUris[0]).then((dataUrl: string | null) => {
        if (dataUrl) {
          this.deliverVideo(id, dataUrl);
        } else {
          this.deliverVideo(id, null);
        }
      }).catch(() => {
        this.deliverVideo(id, null);
      });
    }).catch(() => {
      this.deliverVideo(id, null);
    });
  }

  /** 视频 URI -> dataURL（2.5MB 上限，超限 toast 并返回 null） */
  private async videoUriToDataUrl(uri: string): Promise<string | null> {
    const file = fs.openSync(uri, fs.OpenMode.READ_ONLY);
    try {
      const stat = fs.statSync(file.fd);
      if (stat.size <= 0) {
        return null;
      }
      if (stat.size > 2500000) {
        this.toast('视频太大（' + (stat.size / 1048576).toFixed(1) + 'MB）：只能内嵌 2.5MB 内的短片');
        return null;
      }
      const raw = new ArrayBuffer(stat.size);
      fs.readSync(file.fd, raw);
      const b64 = new util.Base64Helper().encodeToStringSync(new Uint8Array(raw));
      return 'data:video/mp4;base64,' + b64;
    } finally {
      fs.closeSync(file);
    }
  }

  /* ---------------- 沉浸式系统栏（与安卓壳 pushInsets 同一套思路） ----------------
   * 窗口铺满全屏，状态栏/导航条重叠量推给网页（--safe-top/--safe-bottom），
   * 主题切换时同步状态栏图标颜色。 */

  private mainWindow: window.Window | null = null;
  private insetsCache: string = '{"top":0,"bottom":0}';

  private async setupWindow(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || this.mainWindow) {
      return;
    }
    try {
      const w = await window.getLastWindow(ctx);
      this.mainWindow = w;
      await w.setWindowLayoutFullScreen(true);
      let density = 3.5;
      try {
        density = display.getDefaultDisplaySync().densityPixels || 3.5;
      } catch (e) { /* 用默认密度 */ }
      const push = (topPx: number, bottomPx: number): void => {
        const t = Math.round(topPx / density);
        const b = Math.round(bottomPx / density);
        this.insetsCache = '{"top":' + t + ',' + '"bottom":' + b + '}';
        const c = this.controller;
        if (c) {
          c.runJavaScript('window.QYPlatform && window.QYPlatform._applyInsets(' + t + ',' + b + ')');
        }
      };
      // 初始量一次；之后（旋转/手势导航变化）由系统回调推
      let topPx = 0;
      let botPx = 0;
      const bar = w.getWindowAvoidArea(window.AvoidAreaType.TYPE_SYSTEM);
      const nav = w.getWindowAvoidArea(window.AvoidAreaType.TYPE_NAVIGATION_INDICATOR);
      topPx = bar.topRect.height;
      botPx = nav.bottomRect.height;
      push(topPx, botPx);
      // 新版回调按避让区类型逐个触发：{ type, area }
      w.on('avoidAreaChange', (data: window.AvoidAreaOptions) => {
        if (data.type === window.AvoidAreaType.TYPE_SYSTEM) {
          topPx = data.area.topRect.height;
        }
        if (data.type === window.AvoidAreaType.TYPE_NAVIGATION_INDICATOR) {
          botPx = data.area.bottomRect.height;
        }
        push(topPx, botPx);
      });
    } catch (e) {
      // 拿不到窗口就维持 0：网页会退回 env() 兜底
    }
  }

  /** 系统栏与 Web 的重叠量（css px）。启动时网页会拉一次，之后变化由原生推 _applyInsets */
  insets(): string {
    return this.insetsCache;
  }

  /** 主题变化时让状态栏图标跟着换色（深色主题用白图标） */
  setSystemBars(dark: boolean): void {
    const w = this.mainWindow;
    if (!w) {
      return;
    }
    try {
      w.setWindowSystemBarProperties({
        statusBarContentColor: dark ? '#FFFFFF' : '#000000'
      });
    } catch (e) { /* 部分兼容层不支持就跳过 */ }
  }

  /* ---------------- 应用内更新（鸿蒙版） ----------------
   * 检查逻辑与安卓壳一致：拉 gitee 上的 version.json 对比版本号，
   * 结果回调 window.QYUpd.onResult(json)。区别在"安装"环节：
   * 鸿蒙不允许应用内静默装包，立即更新 = 打开系统浏览器去下载页。 */

  private static readonly VERSION_URL: string =
    'https://gitee.com/qiyu_server/xctally/raw/main/apps/android/version.json';

  checkUpdate(): void {
    const client = http.createHttp();
    client.request(QYBridge.VERSION_URL, { connectTimeout: 8000, readTimeout: 8000 })
      .then((resp: http.HttpResponse) => {
        client.destroy();
        if (resp.responseCode !== 200 || !resp.result) {
          this.deliverUpdateResult('{"code":"error","message":"HTTP ' + resp.responseCode + '"}');
          return;
        }
        try {
          const v = JSON.parse(String(resp.result)) as VersionInfo;
          const cur = this.appVersion();
          if (v.versionName && this.versionNewer(v.versionName, cur)) {
            this.deliverUpdateResult(JSON.stringify({
              code: 'update', versionName: v.versionName, notes: v.notes || '', apkUrl: v.apkUrl || ''
            }));
          } else {
            this.deliverUpdateResult('{"code":"latest"}');
          }
        } catch (e) {
          this.deliverUpdateResult('{"code":"error","message":"版本信息解析失败"}');
        }
      })
      .catch((e: Error) => {
        client.destroy();
        this.deliverUpdateResult('{"code":"error","message":"网络错误"}');
      });
  }

  /** 打开下载页（鸿蒙不能静默装包，交给浏览器/文件管理器） */
  downloadUpdate(url: string): void {
    const ctx = this.ctx;
    if (!ctx || !url) {
      this.toast('下载地址为空');
      return;
    }
    ctx.openLink(url).catch(() => {
      // 老系统没有 openLink：退回通用 Want 打开方式
      const want: Want = {
        action: 'ohos.want.action.sendData',
        uri: url,
        type: 'text/plain'
      };
      ctx.startAbility(want).catch(() => {
        this.toast('打不开下载页，请复制链接到浏览器：' + url);
      });
    });
  }

  /** 版本号比较：a > b 才提示更新（"1.13.1" > "1.9"） */
  private versionNewer(a: string, b: string): boolean {
    const pa = a.split('.').map((x: string): number => Number.parseInt(x, 10) || 0);
    const pb = b.split('.').map((x: string): number => Number.parseInt(x, 10) || 0);
    for (let i = 0; i < 3; i++) {
      const x = pa[i] || 0;
      const y = pb[i] || 0;
      if (x > y) {
        return true;
      }
      if (x < y) {
        return false;
      }
    }
    return false;
  }

  private deliverUpdateResult(json: string): void {
    const c = this.controller;
    if (!c) {
      return;
    }
    c.runJavaScript('window.QYUpd && window.QYUpd.onResult(' + JSON.stringify(json) + ')');
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

  private deliverVideo(id: string, dataUrl: string | null): void {
    const c = this.controller;
    if (!c) {
      return;
    }
    const payload = dataUrl === null ? 'null' : JSON.stringify(dataUrl);
    c.runJavaScript(
      'window.QYPlatform && window.QYPlatform._deliverVideo(' + JSON.stringify(id) + ',' + payload + ')'
    );
  }
}
