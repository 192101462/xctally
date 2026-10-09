package com.xcnote.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import org.json.JSONObject
import java.io.File

/**
 * xcnote 安卓壳
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
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private var pendingPickId: String? = null
    private var lastSaved: File? = null

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

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true          // localStorage：数据就存在这里
            settings.databaseEnabled = true
            settings.allowFileAccess = true
            settings.allowContentAccess = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.textZoom = 100                     // 不跟随系统字体缩放，避免布局错乱
            webViewClient = object : WebViewClientCompat() {
                override fun shouldInterceptRequest(
                    view: WebView,
                    request: WebResourceRequest
                ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)
            }
            addJavascriptInterface(Bridge(), "XCAndroid")
            loadUrl("https://appassets.androidplatform.net/assets/www/index.html")
        }
        setContentView(webView)

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

    private fun askNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        val ok = ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        if (!ok) notifPermLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
    }

    /** 把选到的文件内容回传给网页里的 await 回调 */
    private fun deliver(id: String, text: String?) {
        val js = "window.XCPlatform && window.XCPlatform._deliver(" +
            JSONObject.quote(id) + "," +
            (if (text == null) "null" else JSONObject.quote(text)) + ")"
        runOnUiThread { webView.evaluateJavascript(js, null) }
    }

    private fun toast(msg: String) {
        runOnUiThread { Toast.makeText(this, msg, Toast.LENGTH_SHORT).show() }
    }

    /**
     * 暴露给网页的原生能力（网页里是 window.XCAndroid）
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

        /** 导出备份：写入 App 外部私有目录，随后可分享出去 */
        @JavascriptInterface
        fun saveFile(name: String, content: String) {
            try {
                val dir = File(getExternalFilesDir(null), "backups")
                if (!dir.exists()) dir.mkdirs()
                val f = File(dir, name)
                f.writeText(content, Charsets.UTF_8)
                lastSaved = f
            } catch (e: Exception) {
                toast("保存失败：${e.message}")
            }
        }

        /** 唤起系统分享，把刚导出的备份发给自己（微信/邮件/网盘都行） */
        @JavascriptInterface
        fun shareLastFile() {
            val f = lastSaved ?: return
            runOnUiThread {
                try {
                    val uri = FileProvider.getUriForFile(
                        this@MainActivity, "$packageName.fileprovider", f
                    )
                    val send = Intent(Intent.ACTION_SEND).apply {
                        type = "application/json"
                        putExtra(Intent.EXTRA_STREAM, uri)
                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    }
                    startActivity(Intent.createChooser(send, "把备份发到…"))
                } catch (e: Exception) {
                    toast("分享失败：${e.message}\n文件位置：${f.absolutePath}")
                }
            }
        }

        /** 导入备份：打开系统文件选择器 */
        @JavascriptInterface
        fun pickFile(id: String) {
            runOnUiThread {
                pendingPickId = id
                try {
                    pickLauncher.launch(
                        Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                            addCategory(Intent.CATEGORY_OPENABLE)
                            type = "*/*"
                        }
                    )
                } catch (e: Exception) {
                    pendingPickId = null
                    deliver(id, null)
                    toast("打不开文件选择器：${e.message}")
                }
            }
        }

        /** 网页把到期清单交过来，交给 WorkManager 每天检查 */
        @JavascriptInterface
        fun scheduleReminders(json: String) {
            ReminderWorker.save(this@MainActivity, json)
        }
    }

    companion object {
        /**
         * 网页里统一的"返回上一层"逻辑。
         * 注意：这里避免在常量字符串里写 `$`，所以关闭按钮是显式列举的，
         * 而不是用 CSS 的 [data-action$="-close"] 结尾匹配。
         */
        private const val BACK_JS = """
        (function () {
          var sheet = document.getElementById('sheet-root');
          if (sheet && sheet.classList.contains('open')) {
            var close = sheet.querySelector('[data-action="c-close"],[data-action="b-close"]');
            if (close) { close.click(); return 'handled'; }
          }
          var back = document.querySelector('[data-action="back"],[data-action="c-back"]');
          if (back) { back.click(); return 'handled'; }
          if (location.hash && location.hash !== '#home') { location.hash = '#home'; return 'handled'; }
          return 'exit';
        })()
        """
    }
}
