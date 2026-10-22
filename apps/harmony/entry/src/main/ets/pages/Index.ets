import web_webview from '@ohos.web.webview';
import common from '@ohos.app.ability.common';
import { QYBridge } from '../bridge/QYBridge';

/**
 * xctally 鸿蒙壳
 *
 * 用 ArkWeb 装下 rawfile/www/ 里的网页应用（与安卓壳同一份代码）。
 * 返回键交给网页决定：先关面板 → 再回上一层 → 都没有才退出。
 *
 * methodList 是"暴露给网页的方法白名单"——QYBridge 里加新方法时，
 * 这里必须同步加，否则网页调用时是 undefined。
 */
@Entry
@Component
struct Index {
  controller: web_webview.WebviewController = new web_webview.WebviewController();
  private bridge: QYBridge = new QYBridge();

  aboutToAppear(): void {
    const ctx = getContext(this) as common.UIAbilityContext;
    this.bridge.init(ctx);
    this.bridge.setController(this.controller);
  }

  onBackPress(): boolean {
    // 返回值必须是同步的，所以这里总是"我来处理"，
    // 由网页告诉我们是否已经处理完（没处理完就自己退出应用）
    this.controller.runJavaScript(QYBridge.BACK_JS).then((res: string) => {
      if (!res || res.indexOf('handled') < 0) {
        const ctx = getContext(this) as common.UIAbilityContext;
        ctx.terminateSelf();
      }
    }).catch(() => {
      const ctx = getContext(this) as common.UIAbilityContext;
      ctx.terminateSelf();
    });
    return true;
  }

  build() {
    Column() {
      Web({ src: $rawfile('www/index.html'), controller: this.controller })
        .javaScriptAccess(true)
        .domStorageAccess(true)      // localStorage：数据存在这里
        .fileAccess(true)
        .imageAccess(true)
        .databaseAccess(true)
        // 键盘遮挡输入框：交给系统默认避让（窗口为键盘让位、Web 组件缩小，
        // ArkWeb 自己会把聚焦的输入框滚进可视区，网页侧不需要 scrollIntoView）
        // 桥接给网页的原生能力（网页里是 window.QYHarmony）
        .javaScriptProxy({
          object: this.bridge,
          name: 'QYHarmony',
          methodList: ['isApp', 'toast', 'saveFile', 'shareLastFile', 'pickFile', 'pickImage', 'scheduleReminders'],
          controller: this.controller
        })
        .width('100%')
        .height('100%')
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#F2F2F7')
  }
}
