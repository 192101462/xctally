import { appTasks } from '@ohos/hvigor-ohos-plugin';

/**
 * 鸿蒙壳的根构建脚本。这个工程由网页原型手工搭起，
 * hvigorfile 是命令行/IDE 构建的必需文件（标准 DevEco 工程自带）。
 */
export default {
  system: appTasks,  /* 工程级任务：签名配置、产物聚合 */
  plugins: []        /* 想扩展构建流程（比如把 prototype/ 同步进 rawfile）时加这里 */
}
