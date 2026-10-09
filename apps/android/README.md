# xctally · 安卓壳

把 `prototype/` 里那套已经跑通 54 项自检的网页应用，装进一个**极薄的安卓壳**里。

```
apps/android/
└─ app/src/main/
   ├─ AndroidManifest.xml                  ← 覆盖
   ├─ assets/www/                          ← 脚本同步进来（网页应用本体）
   ├─ java/com/qiyu/xctally/
   │  ├─ MainActivity.kt                   ← 承载 WebView + 原生能力桥
   │  └─ ReminderWorker.kt                 ← 每天检查到期并发系统通知
   └─ res/xml/file_paths.xml               ← 分享备份文件用
```

---

## 为什么是 WebView 而不是重写一遍原生 UI

| 方案 | 工作量 | 结果 |
|---|---|---|
| 重写 Kotlin + ArkTS 两套原生 UI | 极大 | 两套界面要各自维护，改一个功能改两处 |
| **一套网页应用 + 两个原生壳**（本方案） | 小 | UI 与业务逻辑**只有一份**，壳只做"原生才能做的事" |
| Flutter + 鸿蒙分支 | 中 | 要重写全部界面为 Dart，且鸿蒙支持来自社区分支 |

这套 UI 是**已经验收过**的（54 项页内自检），套壳后全部原样复用。
代价是"网页感"——对自用工具来说完全可以接受；将来真要原生体验，再逐屏替换即可，
**数据模型与业务逻辑不用动**。

---

## 一、准备

1. 装 **Android Studio**（自带 JDK 与 SDK）
2. SDK Manager 里确认装了 **Android 13 (API 33)** 或更新的 SDK

## 二、新建项目

`File → New → New Project → Empty Views Activity`

| 项 | 值 |
|---|---|
| Name | `xctally` |
| Package name | `com.qiyu.xctally` |
| Language | **Kotlin** |
| Minimum SDK | **API 26**（Android 8.0，通知渠道需要） |
| Build configuration language | Kotlin DSL |

## 三、把网页应用同步进来

在项目根目录（或本仓库）执行：

```bash
python tools/sync-app-assets.py
```

它会把 `prototype/` 里的 8 个文件复制到 `apps/android/app/src/main/assets/www/`。
**以后每次改完网页应用，重新跑一次这个脚本**，再重新运行 App 即可。

## 四、复制源码进项目（一条命令）

在仓库根目录执行（cmd 或 PowerShell 都行）：

```bat
tools\copy-android.cmd -Project "C:\Users\你\AndroidStudioProjects\xctally"
```

> **不要用 `pwsh` 开头**——那是 PowerShell 7 的命令，Windows 自带的是 PowerShell 5.1，
> 命令叫 `powershell`，直接敲 `pwsh` 会报"无法识别"。用上面这个 `.cmd` 包装脚本就没这问题：
> 它会自动挑可用的 PowerShell，并只为这一次运行绕过脚本执行策略。
>
> 如果 `.cmd` 也被安全策略拦住，等价的手写命令是：
> ```powershell
> powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\copy-into-android-project.ps1 -Project "C:\Users\你\AndroidStudioProjects\xctally"
> ```

脚本会先**校验目标确实是安卓项目**（找不到 `app\src\main\AndroidManifest.xml` 就报错退出），然后自动做完这些：

1. 把 `prototype/` 的 8 个网页文件复制到 `app/src/main/assets/www/`
2. 复制 `AndroidManifest.xml` / `MainActivity.kt` / `ReminderWorker.kt` / `file_paths.xml`
3. 删掉模板生成的示例 `.kt`（只保留 `com\qiyu\xctally\` 下的，避免两份 MainActivity）
4. **往 `app/build.gradle.kts` 里加那三行依赖**（会先存一份 `.bak` 备份）
5. **检查 `strings.xml`**：已有 `app_name` 就不动；没有就补一条；文件不存在就创建一个
6. **检查 `minSdk`**：低于 23 会提示你改（模板默认 24，一般不用管）
7. 重复运行是安全的（幂等），不会重复插入

**跑完直接回 Android Studio 点 `Sync Now` 就行，不需要手动改任何文件。**

> 脚本是**纯 ASCII、无 BOM** 的。这不是偷懒：中文 Windows 上 PowerShell 读无 BOM 的 `.ps1`
> 会按 GBK 解释，中文字节会吞掉后面的引号导致语法错误；而部分 pwsh 又不会剥离 BOM。
> ASCII + 无 BOM 是唯一在 PowerShell 5.1 和 7 上都稳的组合。

<details>
<summary>不想用脚本的话，手动复制的对应关系是这些（点开）</summary>

| 本仓库文件 | 复制到 Android 项目里的位置 |
|---|---|
| `apps/android/app/src/main/AndroidManifest.xml` | `app/src/main/AndroidManifest.xml`（**覆盖**） |
| `apps/android/app/src/main/java/com/qiyu/xctally/MainActivity.kt` | `app/src/main/java/com/qiyu/xctally/MainActivity.kt`（覆盖模板的，并删掉模板原来那个） |
| `apps/android/app/src/main/java/com/qiyu/xctally/ReminderWorker.kt` | 同目录 |
| `apps/android/app/src/main/res/xml/file_paths.xml` | `app/src/main/res/xml/file_paths.xml`（新建 `xml` 目录） |
| `prototype/{index.html,styles.css,platform.js,data.js,collect.js,backup.js,selftest.js,app.js}` | `app/src/main/assets/www/` |

</details>

## 五、Gradle 依赖（脚本已自动加好，这里是备查）

```kotlin
dependencies {
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.webkit:webkit:1.12.1")          // WebViewAssetLoader
    implementation("androidx.work:work-runtime-ktx:2.9.1")   // 每日提醒
}
```

> 复制脚本会把这三行插到 `dependencies {` 后面，并留一份 `build.gradle.kts.bak`。
> 它靠**库坐标**（如 `androidx.webkit:webkit`）判断是否已存在，所以版本号被 Studio 改过也不会重复插入。
> 模板用的是版本目录（`libs.androidx.appcompat`）也没关系——两种写法 Gradle 都接受。

**`minSdk` 保持模板默认的 24 就行**，不需要改成 26。
我刚核对过：代码里用到的最低版本 API 是 `PendingIntent.FLAG_IMMUTABLE`（API 23），
通知渠道那段已经用 `Build.VERSION.SDK_INT >= O` 包住了。

## 六、`strings.xml`（脚本已自动处理）

这个文件**不在本仓库里**——它是 Android Studio 新建项目时自动生成的，位置在：

```
<你的项目>\app\src\main\res\values\strings.xml
```

在 Android Studio 的 **Android 视图**下它显示为 `app → res → values → strings.xml`；
如果看不到，把左上角的视图从 **Android** 切成 **Project**，就变成
`app/src/main/res/values/strings.xml`。

三种情况脚本都处理了：

| 情况 | 脚本行为 |
|---|---|
| 已有 `app_name`（模板默认生成的就是这个） | **不动它**，只是提示一句 |
| 文件存在但没有 `app_name` | 在 `</resources>` 前插一条，并留 `.bak` |
| 文件不存在（极少见） | 用仓库里的 `apps/android/app/src/main/res/values/strings.xml` 创建一份 |

所以就算你找不到这个文件，也不用管——**跑一遍脚本它就在了**。

## 七、运行 / 打包

- **调试**：连上手机（开 USB 调试），点绿三角运行
- **出 APK**：`Build → Build Bundle(s) / APK(s) → Build APK(s)`
  产物在 `app/build/outputs/apk/debug/app-debug.apk`
- **正式包**（可选）：`Build → Generate Signed App Bundle / APK`，自己建一个签名文件即可
- 把 APK 传到手机安装（首次要允许"安装未知来源应用"）

---

## 这个壳做了什么

| 能力 | 实现 |
|---|---|
| 装下网页应用 | `WebViewAssetLoader` 以 `https://appassets.androidplatform.net/` 提供资源 |
| 数据持久化 | WebView 的 `localStorage`（开启 `domStorageEnabled`） |
| 导出备份 | 写入 `getExternalFilesDir/backups/`，然后**唤起系统分享**，发给新手机 |
| 导入备份 | `ACTION_OPEN_DOCUMENT` 选文件 → 内容回传给网页 → 走原有的"对比后合并"流程 |
| 到期提醒 | `WorkManager` 每天 9 点跑一次，把当天该提醒的条目弹成系统通知 |
| 返回键 | 先关面板 → 再回上一层 → 都没有才退出 |

### 为什么用 `https://appassets...` 而不是 `file://`

`file://` 域名下 `localStorage`、`canvas.toDataURL`、剪贴板都有各种限制和怪癖。
`WebViewAssetLoader` 给网页一个**正常的 https 源**，行为与浏览器完全一致——
这一点很关键，因为我们的数据全在 `localStorage` 里，图片压缩和长图导出依赖 canvas。

### 关于权限

`AndroidManifest.xml` 里**只申请了通知权限，没有申请 INTERNET**。
这个 App 完全离线，连网络权限都没有——这也是"纯本地"这个卖点最硬的证明。

---

## ⚠️ 我没有验证的部分

**我这边没有 Android 环境，无法编译，所以以下都需要你实机确认**：

1. **第一次编译**：Gradle 依赖版本可能需要 Studio 自动调整
2. **通知**：需要真机等到提醒日期，或临时把 `remindAt` 改成今天来验证
3. **分享备份**：`FileProvider` 的 authority 用的是 `${applicationId}.fileprovider`，
   如果你的包名不是 `com.qiyu.xctally`，`MainActivity` 里那行会自动跟随 `packageName`，无需改
4. **大备份传输**：`evaluateJavascript` 回传超大字符串（几 MB）可能有上限。
   原型阶段数据量小没问题；将来图片改成文件存储后，备份会变成 zip，这条就绕开了

先跑通"能打开、能记一条、能导出"这三步，其余功能逐个验证。

---

## 换图标

模板生成的图标可以直接换：`design/icon-1024.png` →
Android Studio 里 `res → New → Image Asset`，选它，自动生成各尺寸。
