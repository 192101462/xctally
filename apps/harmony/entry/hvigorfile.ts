import { hapTasks } from '@ohos/hvigor-ohos-plugin';

/**
 * entry 模块（HAP）的构建脚本。
 * rawfile/www 里的网页应用由 tools/sync-app-assets.py 从 prototype/ 同步进来。
 */
export default {
  system: hapTasks,  /* 模块级任务：编译 ArkTS、打包资源/hap */
  plugins: []
}
