# xctally · 鸿蒙壳

纯血鸿蒙（HarmonyOS NEXT）**不能安装 APK**，所以这个 HAP 是鸿蒙手机上唯一的途径。
它和安卓壳共用**同一份网页应用**，只是把 WebView 换成 ArkWeb、把原生能力换成鸿蒙的 API。

```
apps/harmony/entry/src/main/
├─ module.json5                              ← 覆盖（多了一条代理提醒权限）
├─ ets/
│  ├─ pages/Index.ets                        ← 承载 ArkWeb + 挂载原生桥
│  └─ bridge/QYBridge.ets                    ← 导出/导入备份、到期提醒
└─ resources/rawfile/www/                    ← 脚本同步进来（网页应用本体）
```

---

## 一、准备

1. 装 **DevEco Studio 5.x**（下载时选 HarmonyOS NEXT 版本）
2. 首次启动会提示下载 **SDK**，让它下完（选 API 12 或更高）
3. 注册并登录**华为开发者账号**（签名要用，个人账号即可，免费）

## 二、新建项目

`File → New → Create Project → Application → Empty Ability`

| 项 | 值 |
|---|---|
| Project name | `xctally` |
| Bundle name | `com.qiyu.xctally` |
| Compatible SDK | **API 12** 或更高 |
| Module name | `entry` |
| Device type | Phone + Tablet |
| Language | **ArkTS** |

## 三、把网页应用同步进来

```bash
python tools/sync-app-assets.py
```

会把 8 个文件复制到 `apps/harmony/entry/src/main/resources/rawfile/www/`。
**以后每次改完网页应用，重新跑一次再重新运行 App。**

## 四、复制源码进项目（一条命令）

在仓库根目录执行（cmd 或 PowerShell 都行）：

```bat
tools\copy-harmony.cmd -Project "D:\DevEcoProjects\xctally"
```

> **不要用 `pwsh` 开头**——那是 PowerShell 7 的命令；Windows 自带的是 PowerShell 5.1，
> 命令叫 `powershell`。用这个 `.cmd` 包装脚本不用管这些，它会自动挑可用的 PowerShell
> 并绕过脚本执行策略。
>
> 等价的手写命令：
> ```powershell
> powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\copy-into-harmony-project.ps1 -Project "D:\DevEcoProjects\xctally"
> ```

脚本会先**校验目标确实是鸿蒙项目**（找不到 `entry\src\main` 就报错退出），然后：

1. 把 `prototype/` 的 8 个网页文件复制到 `entry/src/main/resources/rawfile/www/`
2. 复制 `Index.ets` 与 `bridge/QYBridge.ets`
3. **往 `string.json` 里补一条 `reason_reminder`**（走 JSON 解析再写回，保证格式合法，并留 `.bak`）
4. 打印出唯一还需要手动改的一处（`module.json5` 的权限块）

**它不会覆盖 `module.json5`** —— 模板生成的字段名可能和我写的不完全一致，
整份覆盖有踩坑风险，所以改成让你把权限那一段粘进去。

> 脚本是**纯 ASCII、无 BOM** 的：中文 Windows 上 PowerShell 读无 BOM 的 `.ps1`
> 会按 GBK 解释，中文字节会吞掉后面的引号导致语法错误。

<details>
<summary>不想用脚本的话，手动复制的对应关系是这些（点开）</summary>

| 本仓库文件 | 复制到鸿蒙项目里的位置 |
|---|---|
| `apps/harmony/entry/src/main/ets/pages/Index.ets` | `entry/src/main/ets/pages/Index.ets`（覆盖模板的） |
| `apps/harmony/entry/src/main/ets/bridge/QYBridge.ets` | 同路径新建 `bridge` 目录 |
| `prototype/{index.html,styles.css,platform.js,data.js,collect.js,backup.js,selftest.js,app.js}` | `entry/src/main/resources/rawfile/www/` |

`EntryAbility.ets` 和 `main_pages.json` **不用改**，用模板生成的即可。

</details>

## 五、字符串资源（脚本已自动加好）

`module.json5` 会引用 `$string:reason_reminder`，**这条资源不存在会直接编译失败**，
所以脚本会自动补进 `entry/src/main/resources/base/element/string.json`：

```json
{ "name": "reason_reminder", "value": "Reminder for item expiry dates" }
```

它是走 `ConvertFrom-Json` → 追加 → `ConvertTo-Json` 写回的，所以不会破坏 JSON 格式
（原有条目全部保留，并留一份 `string.json.bak`）。重复运行也不会重复插入。

## 六、配置签名（必须，否则装不上真机）

`File → Project Structure → Signing Configs` → 勾选 **Automatically generate signature** →
登录华为账号，让 DevEco 自动生成证书与 profile。

> 这一步是鸿蒙开发最容易卡住的地方。如果自动签名失败，通常是：
> 账号没实名 / 网络不通 / 需要先在 AppGallery Connect 里创建一个应用。
> 个人开发者自用的话，自动签名就够。

## 七、运行与打包

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
| 导出备份 | 写入 `context.filesDir` |
| 导入备份 | `DocumentViewPicker.select()` → 读文件 → 回调网页 → 走"对比后合并" |
| 到期提醒 | `reminderAgentManager` 系统代理提醒（**不占后台**，到点由系统弹） |
| 返回键 | `onBackPress` 里问网页：先关面板 → 再回上一层 → 都没有才退出 |

### 为什么用系统"代理提醒"而不是后台任务

鸿蒙对后台常驻和自启管得很严，自己起定时任务既费电又容易被系统回收。
`reminderAgentManager` 是把提醒登记给系统，到点由系统弹通知——
这是鸿蒙上做"到期提醒"的标准做法（日历、待办类应用都这么干）。
上限约 30 条，超出部分会被忽略，代码里限制在 20 条。

---

## ⚠️ 我没有验证的部分（重要）

**我这边没有 DevEco 环境，无法编译这个 HAP**，以下几处需要你在真机确认：

1. **`reminderAgentManager.publishReminder` 的签名**
   不同 SDK 版本可能是同步返回 `number`，也可能返回 `Promise<number>`。
   DevEco 会直接报错并提示正确签名，按提示改一行即可。
   实在调不通就先**注释掉 `scheduleReminders` 方法体**，App 其余功能完全不受影响
   （只是没有系统提醒）。
2. **`shareLastFile` 目前只弹了一句提示**，没有真正调系统分享。
   鸿蒙的分享 API（`@ohos.systemShare`）各版本差异较大，
   我留了注释说明怎么写，没有写成可能报错的代码。
   备份文件在应用私有目录 `filesDir`，导出后可以用 `hdc file recv` 取出来。
3. **`util.TextDecoder.create('utf-8')`** 在不同 API 版本里方法名可能是
   `decodeToString` 或 `decodeWithStream`，按 DevEco 提示选一个。
4. **`onBackPress` 里用 Promise 判断是否退出**：返回值得是同步的，
   这里固定返回 `true`（自己处理），再根据网页的回答决定是否 `terminateSelf()`。
   如果发现返回键行为异常，先改成 `return false`（交给系统处理）。

建议顺序：**先让它跑起来、能记一条、数据能留住**，再逐个接原生能力。

---

## 换图标

`AppScope/resources/base/media/` 下的图标资源替换成 `design/icon-1024.png` 生成的尺寸即可
（DevEco 右键 `New → Image Asset` 可以按尺寸生成）。
