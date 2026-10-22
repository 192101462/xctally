# xctally · 鸿蒙壳

纯血鸿蒙（HarmonyOS NEXT）**不能安装 APK**，所以这个 HAP 是鸿蒙手机上唯一的途径。
它和安卓壳共用**同一份网页应用**（`prototype/`），只是把 WebView 换成 ArkWeb、
把原生能力换成鸿蒙的 API。

**这里已经是一个完整的 DevEco Studio 工程**，不再需要"新建项目再复制文件"——
clone 仓库后直接打开 `apps/harmony` 即可，和 `apps/android` 的用法一致。

```
apps/harmony/
├─ AppScope/                     应用级配置（bundleName / 图标 / 名称）
├─ build-profile.json5           工程构建配置（SDK 版本 / 模块列表）
├─ hvigor/                       构建系统配置
├─ oh-package.json5
└─ entry/                        唯一的模块
   ├─ build-profile.json5
   └─ src/main/
      ├─ module.json5            能力声明 + 代理提醒权限
      ├─ ets/
      │  ├─ entryability/EntryAbility.ets   入口：把 Index 页挂到窗口
      │  ├─ pages/Index.ets                 ArkWeb + 挂载原生桥
      │  └─ bridge/QYBridge.ets             备份 / 选图 / 代理提醒 / 返回键
      └─ resources/
         ├─ rawfile/www/        ← 网页应用本体（脚本从 prototype/ 同步进来）
         └─ base/               字符串 / 颜色 / 图标 / 页面注册
```

---

## 一、准备

1. 装 **DevEco Studio 5.x**（下载时选 HarmonyOS NEXT 版本）
2. 首次启动让它把 **SDK** 下完（本工程按 **API 12** 编译，装 API 12 或更高的 SDK）
3. 注册并登录**华为开发者账号**（签名要用，个人账号即可，免费）

## 二、打开工程

`File → Open` 选择仓库里的 **`apps/harmony`** 目录（不是仓库根目录）。

首次打开时 DevEco 会做一次工程 Sync：

- 提示 **hvigor / modelVersion 需要迁移**时，点它给出的 **Fix / Sync** 按钮即可
  （工程按 hvigor modelVersion 5.0.x 建立，DevEco 小版本不同时会自动适配）；
- Sync 完成没有红色报错就可以跑了。

## 三、改网页应用后同步

网页代码在仓库的 `prototype/`（唯一一份），改完执行：

```bash
python tools/sync-app-assets.py
```

会把全部网页文件复制到 `entry/src/main/resources/rawfile/www/`，再重新运行 App 即可。
**忘了跑这个，App 里看到的还是旧页面**（安卓壳没有这一步，它直接从 prototype 打包）。

## 四、配置签名（必须，否则装不上真机）

`File → Project Structure → Signing Configs` → 勾选 **Automatically generate signature** →
登录华为账号，让 DevEco 自动生成证书与 profile。

> 这一步是鸿蒙开发最容易卡住的地方。如果自动签名失败，通常是：
> 账号没实名 / 网络不通 / 需要先在 AppGallery Connect 里创建一个应用。
> 个人开发者自用的话，自动签名就够。

## 五、运行与打包

- **调试**：手机开"开发者模式 + USB 调试"，数据线连上，点绿三角
- **出 HAP**：`Build → Build Hap(s)/APP(s) → Build Hap(s)`
  产物在 `entry/build/default/outputs/default/entry-default-signed.hap`
- **命令行安装**：
  ```bash
  hdc install entry/build/default/outputs/default/entry-default-signed.hap
  ```
  （`hdc` 在 SDK 的 `toolchains` 目录下）

---

## 这个壳做了什么

| 能力 | 实现 |
|---|---|
| 装下网页应用 | `Web` 组件加载 `$rawfile('www/index.html')` |
| 数据持久化 | ArkWeb 的 `localStorage`（`domStorageAccess(true)`） |
| 导出备份 | 系统"保存"面板（`DocumentViewPicker.save`），用户自选目的地 |
| 导入备份 | `DocumentViewPicker.select()` → 读文件 → 回调网页 → 走"对比后合并" |
| 拍照 / 选图 | 相机用系统 `cameraPicker`，相册用 `PhotoViewPicker`；原生压到长边 1600 的 JPEG dataURL 再回传（GIF 原样透传） |
| 到期提醒 | `reminderAgentManager` 系统代理提醒（**不占后台**，到点由系统弹）；通知总开关没开时引导用户打开 |
| 返回键 | `onBackPress` 里问网页：覆盖层 → 面板 → 设置 → 详情页，逐层回退 |

### 与安卓壳的对应关系

网页侧 `platform.js` 只认 `window.QYAndroid` / `window.QYHarmony` 两个名字，
两边的方法签名一一对应（`saveFile / pickFile / pickImage / toast / scheduleReminders`），
所以网页代码完全不用改。两处差异是有意的：

1. **导出备份**：安卓写私有目录后唤起分享；鸿蒙私有目录用户看不到，
   直接弹"保存"面板让用户选位置，一步到位。
2. **到期提醒**：安卓用 WorkManager 每天检查；鸿蒙后台常驻管得严，
   改为把提醒登记给系统（代理提醒），到点由系统弹通知。

### 为什么用系统"代理提醒"而不是后台任务

鸿蒙对后台常驻和自启管得很严，自己起定时任务既费电又容易被系统回收。
`reminderAgentManager` 是把提醒登记给系统，到点由系统弹通知——
这是鸿蒙上做"到期提醒"的标准做法（日历、待办类应用都这么干）。
上限约 30 条，代码里限制在 20 条并跳过已过期日期。

---

## ⚠️ 我没有验证的部分

**本仓库没有鸿蒙构建环境，以下需要你在 DevEco / 真机上确认**：

1. **首次 Sync**：hvigor modelVersion 与你 DevEco 版本不匹配时按提示自动迁移
2. **API 签名**：`cameraPicker` / `requestEnableNotification` 等 API 按 API 12 文档编写，
   个别 SDK 小版本签名可能有出入，DevEco 会直接报错并给出正确写法
3. **拍照**：`cameraPicker`（系统相机 Picker）需要真机验证；不可用时会自动退回相册
4. **代理提醒**：需要真机等到提醒日期，或临时把 `remindAt` 改成今天
