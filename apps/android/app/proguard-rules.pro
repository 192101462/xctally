# ---------------------------------------------------------------------------
# xctally / 琪遇台账 的 R8 保留规则
#
# 为什么需要这个文件：
#   这是个 WebView 壳应用，Java/Kotlin 侧绝大多数方法不是被 Kotlin 代码调用的，
#   而是被【网页里的 JS】通过 @JavascriptInterface 反射调用的。
#   R8 看不到这些调用点，就会把它们当成死代码删掉 ——
#   debug 包不压缩所以看不出来，release 包一启动就崩。
#
# 现在 release 没有开启压缩（见 build.gradle.kts），这份规则是"以后要开压缩时"的底线。
# ---------------------------------------------------------------------------

# 1) 所有 @JavascriptInterface 方法必须保留（JS 调用的入口）
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# 2) JS 桥接类本身：类名和方法名都不能改（网页里写死了名字，例如 QYPlatform）
-keep class com.qiyu.xctally.** { *; }
-keepclassmembers class com.qiyu.xctally.** { *; }

# 3) WebView 相关的子类：名字被系统/反射用到
-keep class * extends android.webkit.WebViewClient { *; }
-keep class * extends android.webkit.WebChromeClient { *; }
-keep class * extends android.webkit.WebView { *; }
-keep class androidx.webkit.** { *; }

# 4) 枚举/注解/内部类等常规保护
-keepattributes *Annotation*, InnerClasses, EnclosingMethod, Signature
-keepclassmembers enum * {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}
-keep class * implements android.os.Parcelable {
    public static final android.os.Parcelable$Creator *;
}

# 5) 崩溃时保留行号，方便定位（release 也能看懂堆栈）
-keepattributes SourceFile, LineNumberTable
-renamesourcefileattribute SourceFile
