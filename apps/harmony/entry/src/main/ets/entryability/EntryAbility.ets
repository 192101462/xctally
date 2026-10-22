import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';

/**
 * xctally 鸿蒙壳 · 入口 Ability
 *
 * 只做一件事：把 pages/Index（ArkWeb + 原生桥）挂到窗口上。
 * 键盘避让用系统默认行为（adjustResize 语义）——
 * ArkWeb 自己会把聚焦的输入框滚进可视区，与安卓壳的处理保持一致：
 * 网页侧【故意不做】scrollIntoView，避免和系统滚动打架。
 */
export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
  }

  onDestroy(): void {
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    windowStage.loadContent('pages/Index', (err) => {
      if (err.code) {
        console.error(`[xctally] Failed to load content. Code:${err.code} message:${err.message}`);
        return;
      }
      console.info('[xctally] content loaded');
    });
  }

  onWindowStageDestroy(): void {
  }

  onForeground(): void {
  }

  onBackground(): void {
  }
}
