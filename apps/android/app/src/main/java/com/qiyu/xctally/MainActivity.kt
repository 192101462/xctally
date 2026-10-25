package com.qiyu.xctally

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import android.util.Base64
import android.util.DisplayMetrics
import android.webkit.JavascriptInterface
import android.webkit.JsResult
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

/**
 * xctally 安卓壳
 *
 * 职责只有四件事：
 *   1. 用 WebView 装下 www/ 里的网页应用（UI 与业务逻辑都在那边）
 *   2. 把"导出备份 / 导入备份"接到系统文件能力上（网页做不到）
 *   3. 把到期清单交给 WorkManager，每天检查一次并发系统通知
 *   4. 处理返回键：先关面板、再回上一层、最后才退出
 *
 * 资源通过 WebViewAssetLoader 以 https://appassets.androidplatform.net/ 提供，
 * 而不是 file:// —— 这样 localStorage、canvas、剪贴板的行为与普通网页完全一致，
 * 不会踩 file:// 域名的各种坑。
 *
 * 注意路径：网页应用不在模块里，而是在仓库的 prototype/，
 * 由 app/build.gradle.kts 的 assets.srcDirs("../../prototype") 直接打包，
 * 所以这些文件位于 assets 的【根目录】：URL 是 /assets/index.html，没有 www 这一层。
 * 改动这里时请同步改 app/build.gradle.kts 里的 srcDirs。
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private var pendingPickId: String? = null
    private var pendingSave: Pair<String, String>? = null   // 待保存的备份（文件名, 内容）

    private val assetLoader by lazy {
        WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
    }

    /** 选文件（导入备份） */
    private val pickLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val id = pendingPickId
        pendingPickId = null
        val uri: Uri? = result.data?.data
        val text: String? = if (uri == null) null else try {
            contentResolver.openInputStream(uri)?.use { it.readBytes().toString(Charsets.UTF_8) }
        } catch (e: Exception) {
            null
        }
        if (id != null) deliver(id, text)
        if (text == null) toast("没有读到文件内容")
    }

    /** 通知权限（Android 13+ 需要） */
    private val notifPermLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        toast(if (granted) "到期提醒已开启" else "没有通知权限，到期时不会弹提醒")
    }

    /**
     * 导出备份：弹系统"另存为"，用户自选位置（下载/文档/网盘目录）。
     * 之前写应用私有目录再分享——私有目录在文件选择器里不可见，
     * 换手机导入时"找不到自己导出的文件"，所以改成让用户直接选目的地。
     */
    private val saveLauncher = registerForActivityResult(
        ActivityResultContracts.CreateDocument("application/json")
    ) { uri: Uri? ->
        val pc = pendingSave
        pendingSave = null
        if (uri == null || pc == null) {
            toast("已取消导出")
            return@registerForActivityResult
        }
        try {
            contentResolver.openOutputStream(uri)?.use {
                it.write(pc.second.toByteArray(Charsets.UTF_8))
            }
            toast("备份已保存：${pc.first}")
        } catch (e: Exception) {
            toast("保存失败：${e.message}")
        }
    }

    private var pendingImageId: String? = null
    private var cameraUri: Uri? = null

    /**
     * 选图片：拍照或从相册选择，返回 dataURL 给网页。
     * 网页里直接写 <input type="file"> 在 WebView 里是没反应的（宿主必须实现
     * onShowFileChooser），所以图片一律走这个原生入口。
     */
    private val imageLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val id = pendingImageId
        pendingImageId = null
        val fromCamera = cameraUri
        cameraUri = null
        if (id == null) return@registerForActivityResult
        if (result.resultCode != RESULT_OK) {
            deliverImage(id, null)
            return@registerForActivityResult
        }
        val uri = fromCamera ?: result.data?.data
        if (uri == null) {
            deliverImage(id, null)
            return@registerForActivityResult
        }
        val dataUrl = try {
            readImageAsDataUrl(uri)
        } catch (e: Exception) {
            null
        }
        if (dataUrl == null) toast("读不出这张图片")
        deliverImage(id, dataUrl)
    }

    private fun launchCamera(id: String) {
        try {
            val dir = File(cacheDir, "camera").apply { mkdirs() }
            val file = File(dir, "shot_${System.currentTimeMillis()}.jpg")
            val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", file)
            cameraUri = uri
            imageLauncher.launch(
                Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
                    putExtra(MediaStore.EXTRA_OUTPUT, uri)
                    addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
                }
            )
        } catch (e: Exception) {
            pendingImageId = null
            deliverImage(id, null)
            toast("打不开相机：${e.message}")
        }
    }

    private fun launchGallery(id: String) {
        try {
            imageLauncher.launch(
                Intent(Intent.ACTION_GET_CONTENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = "image/*"
                }
            )
        } catch (e: Exception) {
            pendingImageId = null
            deliverImage(id, null)
            toast("打不开相册：${e.message}")
        }
    }

    /**
     * 读图 -> 缩到长边 1600 -> JPEG 88 -> dataURL。
     * 原生必须先缩一道：原图直传会产生几 MB 的 base64 字符串，
     * 过 WebView 桥又慢又容易 OOM，而网页侧反正还要再压一次。
     * GIF 例外：解码会毁掉动画，所以原样透传。
     */
    private fun readImageAsDataUrl(uri: Uri): String? {
        val mime = contentResolver.getType(uri) ?: "image/jpeg"
        if (mime == "image/gif") {
            val raw = contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: return null
            return "data:image/gif;base64," + Base64.encodeToString(raw, Base64.NO_WRAP)
        }

        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

        val opts = BitmapFactory.Options().apply {
            inSampleSize = sampleSizeFor(bounds.outWidth, bounds.outHeight, 1600)
        }
        var bmp = contentResolver.openInputStream(uri)?.use {
            BitmapFactory.decodeStream(it, null, opts)
        } ?: return null

        val longSide = maxOf(bmp.width, bmp.height)
        if (longSide > 1600) {
            val ratio = 1600f / longSide
            val scaled = Bitmap.createScaledBitmap(
                bmp,
                maxOf(1, (bmp.width * ratio).toInt()),
                maxOf(1, (bmp.height * ratio).toInt()),
                true
            )
            if (scaled !== bmp) {
                bmp.recycle()
                bmp = scaled
            }
        }

        val out = ByteArrayOutputStream()
        bmp.compress(Bitmap.CompressFormat.JPEG, 88, out)
        bmp.recycle()
        if (out.size() == 0) return null
        return "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    }

    private fun sampleSizeFor(w: Int, h: Int, target: Int): Int {
        var size = 1
        var longSide = maxOf(w, h)
        while (longSide / 2 >= target) {
            longSide /= 2
            size *= 2
        }
        return size
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true          // localStorage：数据就存在这里
            // 所有资源都走 WebViewAssetLoader 的 https 域，WebView 本身用不到
            // file:// 和 content://，关掉这两个开关纯属收窄攻击面
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.mediaPlaybackRequiresUserGesture = false
            settings.textZoom = 100                     // 不跟随系统字体缩放，避免布局错乱
            webViewClient = object : WebViewClientCompat() {
                override fun shouldInterceptRequest(
                    view: WebView,
                    request: WebResourceRequest
                ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)
            }
            // WebView 默认【不显示】JS 对话框：不设 WebChromeClient 时 window.confirm()
            // 直接返回 false，window.alert() 什么也不做。后果很隐蔽——"点删除没反应"、
            // "点清空没反应"全是因为它。这里放行，保证 confirm/alert 至少能用。
            // 更好看的做法是网页自己做确认框（物品模块已经改用 confirmSheet 了）。
            webChromeClient = object : WebChromeClient() {
                override fun onJsConfirm(
                    view: WebView?,
                    url: String?,
                    message: String?,
                    result: JsResult?
                ): Boolean {
                    AlertDialog.Builder(this@MainActivity)
                        .setMessage(message)
                        .setPositiveButton(android.R.string.ok) { _, _ -> result?.confirm() }
                        .setNegativeButton(android.R.string.cancel) { _, _ -> result?.cancel() }
                        .setOnCancelListener { result?.cancel() }
                        .show()
                    return true
                }

                override fun onJsAlert(
                    view: WebView?,
                    url: String?,
                    message: String?,
                    result: JsResult?
                ): Boolean {
                    AlertDialog.Builder(this@MainActivity)
                        .setMessage(message)
                        .setPositiveButton(android.R.string.ok) { _, _ -> result?.confirm() }
                        .setOnCancelListener { result?.cancel() }
                        .show()
                    return true
                }
            }
            addJavascriptInterface(Bridge(), "QYAndroid")
            loadUrl("https://appassets.androidplatform.net/assets/index.html")
        }
        // WebView 装进 FrameLayout：键盘弹出时用【底部边距】缩小 WebView。
        // 边距改变的是视图真实尺寸 → 网页整体重排 → WebView 自带的
        // "聚焦输入框滚进可视区"就能工作。（给 WebView 加 padding 没用：
        // WebView 不按 padding 裁剪内容，之前试过"完全没变化"。）
        val root = android.widget.FrameLayout(this)
        root.addView(webView, android.widget.FrameLayout.LayoutParams(
            android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
            android.widget.FrameLayout.LayoutParams.MATCH_PARENT
        ))
        setContentView(root)

        // 键盘遮挡输入框：走统一的 edge-to-edge 方案。
        //
        // 走过三次弯路，结论记在这里：
        //   1. manifest 的 adjustResize：targetSdk 35+（安卓 15 起）强制全面屏，
        //      setDecorFitsSystemWindows(true) 会被无视，窗口不再为键盘缩小 ——
        //      卓易通一直如此，安卓 15/16 的真机也一样，输入框就被键盘压住。
        //   2. 给 WebView 加 padding：WebView 不按 padding 裁剪内容，无效。
        //   3. 正解：全面屏 + 监听 ime insets，给 WebView 设底部边距。
        //      键盘弹起 → WebView 变矮 → 底部的输入行自然在键盘上方；
        //      状态栏/导航栏的重叠量继续走 --safe-top/--safe-bottom（pushInsets）。
        WindowCompat.setDecorFitsSystemWindows(window, false)

        ViewCompat.requestApplyInsets(webView)

        // 系统栏重叠实测（卓易通等兼容层不报 env()，只能原生量）；
        // 键盘开着时跳过重算——那时的"底部重叠"其实是键盘，不该算进安全区
        ViewCompat.setOnApplyWindowInsetsListener(webView) { _, insets ->
            val imeBottom = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
            applyImeMargin(imeBottom)
            if (imeBottom == 0) pushInsets()
            insets
        }
        webView.post { pushInsets() }   // 有的兼容层不派发 insets，布局后主动量一次

        // 返回键：先关面板 → 再回上一层 → 都没有才退出
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                webView.evaluateJavascript(BACK_JS) { result ->
                    if (result == null || !result.contains("handled")) finish()
                }
            }
        })

        askNotificationPermission()
        ReminderWorker.schedule(this)
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }

    /* ---------------- 应用内更新 ----------------
     * 版本清单放在仓库里（gitee raw 直链，无需服务器）：
     *   { "versionCode": 2, "versionName": "1.1", "apkUrl": "...", "notes": "..." }
     * 发版流程见 apps/android/README.md。
     * 检查与下载都走原生（HttpURLConnection），不经过 WebView —— 没有跨域问题。
     *
     * 下载也自己做，不用系统 DownloadManager：兼容层（如卓易通）上它的进度
     * 通知经常不显示，完成广播也可能送不到 NOT_EXPORTED 接收器 —— 用户看到的
     * 就是"说好看通知栏，通知栏却什么都没有，下完了也没反应"。自己下、自己
     * 发进度通知、下完直接唤起安装器，行为在哪个设备上都一致。
     */

    private val downloading = AtomicBoolean(false)   // 防止重复点"下载并安装"

    /** 唤起系统安装器（APK 在应用外部私有目录，走 FileProvider 授权） */
    private fun installApk(file: File) {
        try {
            val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", file)
            val install = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            startActivity(install)
        } catch (e: Exception) {
            // 多半是"安装未知应用"权限没授予：系统会引导用户去开，这里提示一下位置
            toast("无法弹出安装界面：${e.message}\n请在 系统设置 → 应用 → 琪遇台账 里允许\"安装未知应用\"")
        }
    }

    private fun updateApkFile(): File =
        File(File(getExternalFilesDir(null), "update"), "xctally-update.apk")

    /** 拉取远端版本清单并和本地 versionCode 比较，结果回调给网页 QYUpd.onResult */
    private fun checkUpdateInternal() {
        thread {
            var result = JSONObject()
            try {
                val conn = URL(VERSION_URL).openConnection() as HttpURLConnection
                conn.connectTimeout = 10000
                conn.readTimeout = 10000
                val body = conn.inputStream.bufferedReader().use { it.readText() }
                conn.disconnect()
                val remote = JSONObject(body)
                val latest = remote.optInt("versionCode", -1)
                val pi = packageManager.getPackageInfo(packageName, 0)
                val current = if (Build.VERSION.SDK_INT >= 28) pi.longVersionCode else pi.versionCode.toLong()
                result = when {
                    latest > current -> JSONObject().put("code", "update")
                        .put("versionName", remote.optString("versionName"))
                        .put("notes", remote.optString("notes"))
                        .put("apkUrl", remote.optString("apkUrl"))
                        .put("current", current.toString())
                    else -> JSONObject().put("code", "latest")
                        .put("versionName", remote.optString("versionName", ""))
                }
            } catch (e: Exception) {
                result = JSONObject().put("code", "error").put("message", e.message ?: "网络错误")
            }
            val payload = result.toString()
            runOnUiThread {
                webView.evaluateJavascript(
                    "window.QYUpd && window.QYUpd.onResult(${JSONObject.quote(payload)})", null
                )
            }
        }
    }

    /** 自己下载 APK：进度发自己的通知（gitee 直链会 302 到 CDN，HttpURLConnection 自动跟随），
     *  下完落盘改名、直接唤起安装器。整个过程不依赖任何系统组件的可选实现。 */
    private fun downloadUpdateInternal(url: String) {
        if (!downloading.compareAndSet(false, true)) {
            toast("已经在下载了，稍等一下")
            return
        }
        val file = updateApkFile()
        val notifId = 2001
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        runOnUiThread {
            if (Build.VERSION.SDK_INT >= 26) {
                nm.createNotificationChannel(
                    NotificationChannel("update", "应用更新", NotificationManager.IMPORTANCE_LOW)
                )
            }
            if (!nm.areNotificationsEnabled()) {
                toast("没开通知权限看不到进度，但不影响下载，完成后会直接弹安装")
            }
            toast("开始下载，进度看通知栏")
        }
        thread {
            try {
                val notifyProgress = { pct: Int, text: String ->
                    val nb = NotificationCompat.Builder(this, "update")
                        .setSmallIcon(android.R.drawable.stat_sys_download)
                        .setContentTitle("琪遇台账 · 正在下载更新")
                        .setContentText(text)
                        .setProgress(100, if (pct < 0) 0 else pct, pct < 0)
                        .setOngoing(true)
                        .setOnlyAlertOnce(true)
                        .build()
                    nm.notify(notifId, nb)
                }
                notifyProgress(-1, "连接中…")
                val conn = URL(url).openConnection() as HttpURLConnection
                conn.connectTimeout = 15000
                conn.readTimeout = 60000
                conn.inputStream.use { input ->
                    file.parentFile?.mkdirs()
                    // 先写 .part 再改名：半截文件不会被当成完整安装包
                    val tmp = File(file.parentFile, file.name + ".part")
                    FileOutputStream(tmp).use { out ->
                        val total = conn.contentLengthLong   // -1 = 服务器没报长度
                        val buf = ByteArray(64 * 1024)
                        var done = 0L
                        var lastPct = -1
                        var lastMb = -1L
                        while (true) {
                            val n = input.read(buf)
                            if (n < 0) break
                            out.write(buf, 0, n)
                            done += n
                            if (total > 0) {
                                val pct = (done * 100 / total).toInt()
                                if (pct != lastPct) {
                                    lastPct = pct
                                    notifyProgress(pct, "$pct%（${"%.1f".format(done / 1048576f)} MB）")
                                }
                            } else {
                                val mb = done shr 20
                                if (mb != lastMb) {
                                    lastMb = mb
                                    notifyProgress(-1, "已下载 ${"%.1f".format(done / 1048576f)} MB")
                                }
                            }
                        }
                        if (done == 0L) throw IllegalStateException("下载内容为空")
                    }
                    if (tmp != file && !tmp.renameTo(file)) {
                        file.delete()
                        if (!tmp.renameTo(file)) throw IllegalStateException("保存安装包失败")
                    }
                }
                conn.disconnect()
                val doneNote = NotificationCompat.Builder(this, "update")
                    .setSmallIcon(android.R.drawable.stat_sys_download_done)
                    .setContentTitle("琪遇台账 · 下载完成")
                    .setContentText("正在弹出安装…")
                    .setAutoCancel(true)
                    .build()
                nm.notify(notifId, doneNote)
                runOnUiThread { installApk(file) }
            } catch (e: Exception) {
                toast("下载失败：${e.message}")
            } finally {
                downloading.set(false)
            }
        }
    }

    private fun askNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        val ok = ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        if (!ok) notifPermLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
    }

    /** 把选到的文件内容回传给网页里的 await 回调 */
    private fun deliver(id: String, text: String?) {
        val js = "window.QYPlatform && window.QYPlatform._deliver(" +
            JSONObject.quote(id) + "," +
            (if (text == null) "null" else JSONObject.quote(text)) + ")"
        runOnUiThread { webView.evaluateJavascript(js, null) }
    }

    /** 把选到的图片（dataURL）回传给网页 */
    private fun deliverImage(id: String, dataUrl: String?) {
        val js = "window.QYPlatform && window.QYPlatform._deliverImage(" +
            JSONObject.quote(id) + "," +
            (if (dataUrl == null) "null" else JSONObject.quote(dataUrl)) + ")"
        runOnUiThread { webView.evaluateJavascript(js, null) }
    }

    private fun toast(msg: String) {
        runOnUiThread { Toast.makeText(this, msg, Toast.LENGTH_SHORT).show() }
    }

    /* ---------------- 系统栏重叠量 ----------------
     * 返回 (topPx, bottomPx)：WebView 边缘伸进系统栏区域的像素数。
     * 让位正常时都是 0；被兼容层忽略时 top = 状态栏高、bottom = 导航栏高。
     */

    private var lastTopCss = 0.0
    private var lastBottomCss = 0.0

    private fun realScreenHeight(): Int = if (Build.VERSION.SDK_INT >= 30) {
        windowManager.currentWindowMetrics.bounds.height()
    } else {
        val dm = DisplayMetrics()
        @Suppress("DEPRECATION")
        webView.display.getRealMetrics(dm)
        dm.heightPixels
    }

    /** 只能在 UI 线程调（要读 View 位置和 rootWindowInsets） */
    private fun measureBarOverlap(): Pair<Int, Int> {
        return try {
            val root = webView.rootWindowInsets
                ?: return Pair(0, 0)
            val bars = WindowInsetsCompat.toWindowInsetsCompat(root).getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
            )
            val loc = IntArray(2)
            webView.getLocationOnScreen(loc)
            val top = (bars.top - loc[1]).coerceIn(0, bars.top)
            val bottom = (loc[1] + webView.height - (realScreenHeight() - bars.bottom))
                .coerceIn(0, bars.bottom)
            Pair(top, bottom)
        } catch (e: Exception) {
            Pair(0, 0)
        }
    }

    private fun cssRound(px: Int): Double {
        val d = resources.displayMetrics.density
        return Math.round(px / d * 10.0) / 10.0
    }

    /** 键盘弹起/收起时给 WebView 设底部边距（真实缩小视图，网页随之重排） */
    private fun applyImeMargin(imeBottom: Int) {
        val lp = webView.layoutParams as? android.widget.FrameLayout.LayoutParams ?: return
        if (lp.bottomMargin == imeBottom) return
        lp.bottomMargin = imeBottom
        webView.layoutParams = lp
    }

    /** 量一遍重叠量，变了就推给网页（网页没起来时静默跳过，开机时会自己拉） */
    private fun pushInsets() {
        val (topPx, bottomPx) = measureBarOverlap()
        val top = cssRound(topPx)
        val bottom = cssRound(bottomPx)
        if (top == lastTopCss && bottom == lastBottomCss) return
        lastTopCss = top
        lastBottomCss = bottom
        webView.evaluateJavascript(
            "window.QYPlatform && QYPlatform._applyInsets && QYPlatform._applyInsets($top,$bottom)",
            null
        )
    }

    /**
     * 暴露给网页的原生能力（网页里是 window.QYAndroid）
     * 注意：@JavascriptInterface 的方法参数只允许基本类型与字符串。
     */
    inner class Bridge {

        @JavascriptInterface
        fun isApp(): Boolean = true

        // 必须写成块体 + this@MainActivity 显式限定：
        // 内部类里同名成员会遮蔽外部类的 toast，写成 `= toast(msg)` 就是自己调自己。
        @JavascriptInterface
        fun toast(msg: String) {
            this@MainActivity.toast(msg)
        }

        /** 导出备份：弹"另存为"让用户自选位置（私有目录在文件选择器里不可见） */
        @JavascriptInterface
        fun saveFile(name: String, content: String) {
            // 文件名收一道白名单，防 "../" 之类越界
            val safe = name.substringAfterLast('/')
                .substringAfterLast('\\')
                .filter { it.isLetterOrDigit() || it == '.' || it == '-' || it == '_' }
            pendingSave = Pair(if (safe.isBlank()) "backup.json" else safe, content)
            runOnUiThread {
                try {
                    saveLauncher.launch(if (safe.isBlank()) "backup.json" else safe)
                } catch (e: Exception) {
                    pendingSave = null
                    toast("打不开保存面板：${e.message}")
                }
            }
        }

        /** 兼容保留：导出已改为自选位置保存，不再需要"分享"这一步 */
        @JavascriptInterface
        fun shareLastFile() {
            // no-op（platform.js 会无条件调用）
        }

        /** 导入备份：打开系统文件选择器（偏向 json，但不限死） */
        @JavascriptInterface
        fun pickFile(id: String) {
            runOnUiThread {
                pendingPickId = id
                try {
                    pickLauncher.launch(
                        Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                            addCategory(Intent.CATEGORY_OPENABLE)
                            type = "*/*"
                            // 备份是 json：给选择器一个类型提示，json 排前面更好找
                            putExtra(
                                Intent.EXTRA_MIME_TYPES,
                                arrayOf("application/json", "application/octet-stream", "text/plain")
                            )
                        }
                    )
                } catch (e: Exception) {
                    pendingPickId = null
                    deliver(id, null)
                    toast("打不开文件选择器：${e.message}")
                }
            }
        }

        /**
         * 选图片。source 是网页侧已经选好的来源（camera / gallery / 空），
         * 网页用自己的底部面板问过用户了，这里不再弹安卓原生对话框——
         * 那种原生弹窗和 App 的设计完全不搭。
         */
        @JavascriptInterface
        fun pickImage(id: String, source: String) {
            runOnUiThread {
                pendingImageId = id
                when (source) {
                    "camera" -> launchCamera(id)
                    "gallery" -> launchGallery(id)
                    else -> launchGallery(id)      // 没指定就默认相册
                }
            }
        }

        /** 网页把到期清单交过来（hour = 每天几点提醒），交给 WorkManager 排班 */
        @JavascriptInterface
        fun scheduleReminders(json: String, hour: Int) {
            ReminderWorker.save(this@MainActivity, json, hour)
        }

        /** 设置页「发条测试通知」：立即验证通知链路 */
        @JavascriptInterface
        fun testReminder() {
            ReminderWorker.postTest(this@MainActivity)
        }

        /** 检查更新：结果通过 window.QYUpd.onResult(json) 回调给网页 */
        @JavascriptInterface
        fun checkUpdate() {
            checkUpdateInternal()
        }

        /** 下载并安装更新（apkUrl 来自检查结果的回传） */
        @JavascriptInterface
        fun downloadUpdate(url: String) {
            if (url.isBlank()) {
                toast("下载地址为空：请先把 APK 传到 gitee Release 并填进 version.json")
                return
            }
            downloadUpdateInternal(url)
        }

        /**
         * 系统栏重叠量（css px），开机时网页拉一次做初始布局；
         * 之后若有变化（旋转、折叠）由 pushInsets 主动推 _applyInsets。
         * 读的是 UI 线程量好缓存的值，桥线程直接返回。
         */
        @JavascriptInterface
        fun insets(): String =
            JSONObject().put("top", lastTopCss).put("bottom", lastBottomCss).toString()

        /** 当前安装版本（versionName），网页"检查更新"一行显示用 */
        @JavascriptInterface
        fun appVersion(): String = try {
            packageManager.getPackageInfo(packageName, 0).versionName ?: ""
        } catch (e: Exception) {
            ""
        }

        /**
         * 主题切换时同步系统栏和 WebView 底色：
         * 兼容层没让网页铺满屏幕时，露出来的边缘用主题色兜底，不会再露白条。
         */
        @JavascriptInterface
        fun setSystemBars(dark: Boolean) {
            runOnUiThread {
                val bg = if (dark) 0xFF000000.toInt() else 0xFFF2F2F7.toInt()
                try {
                    @Suppress("DEPRECATION")
                    window.statusBarColor = bg
                    @Suppress("DEPRECATION")
                    window.navigationBarColor = bg
                } catch (e: Exception) {
                    // Android 15+ 上这两个是空操作，忽略
                }
                webView.setBackgroundColor(bg)
                window.decorView.setBackgroundColor(bg)
            }
        }
    }

    companion object {
        /** 版本清单：发版时更新它（见 apps/android/README.md 的发版流程） */
        private const val VERSION_URL =
            "https://gitee.com/qiyu_server/xctally/raw/main/apps/android/version.json"
        /**
         * 网页里统一的"返回上一层"逻辑，按层级从最上层往下试：
         *   1. 选择器 / 确认框这类覆盖层
         *   2. 底部面板（新增物品、设置项、回收站…）
         *   3. 设置页（先回上一级，再退出设置）
         *   4. 详情页
         * 都没东西可退时才返回 'exit'，让系统退出应用。
         *
         * 注意：这里避免在常量字符串里写 `$`，所以关闭按钮都是显式列举的，
         * 而不是用 CSS 的 [data-action$="-close"] 结尾匹配。
         */
        private const val BACK_JS = """
        (function () {
          try {
            var el;
            // 1) 覆盖层：分类/来源选择器、确认框
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
            // 2) 底部面板
            var sheet = document.getElementById('sheet-root');
            if (sheet && sheet.classList.contains('open')) {
              var scrim = sheet.querySelector('.scrim');
              if (scrim) { scrim.click(); return 'handled'; }
              var close = sheet.querySelector('[data-action="c-close"],[data-action="b-close"],[data-action="close-sheet"]');
              if (close) { close.click(); return 'handled'; }
            }
            // 3) 设置：先回上一级，再退出设置
            var s1 = document.querySelector('[data-action="set-back"]');
            if (s1) { s1.click(); return 'handled'; }
            var s2 = document.querySelector('[data-action="set-close"]');
            if (s2) { s2.click(); return 'handled'; }
            // 4) 详情页
            var back = document.querySelector('[data-action="i-back"],[data-action="back"],[data-action="c-back"]');
            if (back) { back.click(); return 'handled'; }
            return 'exit';
          } catch (e) { return 'exit'; }
        })()
        """
    }
}
