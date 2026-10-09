package com.qiyu.xctally

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.Worker
import androidx.work.WorkerParameters
import androidx.work.WorkManager
import org.json.JSONArray
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.concurrent.TimeUnit

/**
 * 到期提醒：每天检查一次，把今天该提醒的条目弹成系统通知。
 *
 * 为什么不用 AlarmManager 精确定时：
 *   - 家用场景只需要"当天早上提醒一次"，精确到秒没有意义
 *   - 精确定时需要 SCHEDULE_EXACT_ALARM 权限，国内 ROM 还会额外拦截
 *   - WorkManager 会自己处理重启、Doze、后台限制，省心且够用
 *
 * 提醒清单由网页在每次渲染时交过来（QYAndroid.scheduleReminders），
 * 存进 SharedPreferences，这个 Worker 只负责按 remindAt 到期就弹通知。
 */
class ReminderWorker(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {

    override fun doWork(): Result {
        val ctx = applicationContext
        val list = load(ctx)
        val today = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
        var posted = 0

        for (i in 0 until list.length()) {
            val o = list.optJSONObject(i) ?: continue
            if (o.optBoolean("done", false)) continue
            val at = o.optString("remindAt")
            if (at.isEmpty() || at > today) continue          // ISO 日期字符串可直接比较
            notify(ctx, o.optString("id"), o.optString("title"), o.optString("body"))
            o.put("done", true)
            posted++
        }

        if (posted > 0) {
            prefs(ctx).edit().putString(KEY, list.toString()).apply()
        }
        return Result.success()
    }

    private fun notify(ctx: Context, id: String, title: String, body: String) {
        val mgr = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(CHANNEL, "到期提醒", NotificationManager.IMPORTANCE_DEFAULT)
            ch.description = "物品保质期 / 保修到期的提醒"
            mgr.createNotificationChannel(ch)
        }

        val open = PendingIntent.getActivity(
            ctx, 0,
            Intent(ctx, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val n = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_popup_reminder)
            .setContentTitle(title.ifEmpty { "xctally 提醒" })
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setContentIntent(open)
            .build()

        try {
            NotificationManagerCompat.from(ctx)
                .notify(Math.abs(id.hashCode()), n)
        } catch (e: SecurityException) {
            // 没有通知权限，安静失败即可
        }
    }

    companion object {
        private const val PREFS = "xctally"
        private const val KEY = "reminders"
        private const val CHANNEL = "xctally_due"
        private const val WORK = "xctally_reminders"

        private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

        fun save(ctx: Context, json: String) {
            // 网页每次都会推全量清单；旧的"已提醒"标记按 id 保留，避免同一天重复弹
            val old = load(ctx)
            val done = HashSet<String>()
            for (i in 0 until old.length()) {
                val o = old.optJSONObject(i) ?: continue
                if (o.optBoolean("done", false)) done.add(o.optString("id"))
            }
            val fresh = JSONArray()
            try {
                val arr = JSONArray(json)
                for (i in 0 until arr.length()) {
                    val o = arr.optJSONObject(i) ?: continue
                    if (done.contains(o.optString("id"))) o.put("done", true)
                    fresh.put(o)
                }
            } catch (e: Exception) {
                return
            }
            prefs(ctx).edit().putString(KEY, fresh.toString()).apply()
            schedule(ctx)
        }

        fun load(ctx: Context): JSONArray {
            val raw = prefs(ctx).getString(KEY, "[]") ?: "[]"
            return try {
                JSONArray(raw)
            } catch (e: Exception) {
                JSONArray()
            }
        }

        /** 每天上午 9 点左右跑一次 */
        fun schedule(ctx: Context) {
            val req = PeriodicWorkRequestBuilder<ReminderWorker>(1, TimeUnit.DAYS)
                .setInitialDelay(millisToNextMorning(), TimeUnit.MILLISECONDS)
                .build()
            WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(
                WORK, ExistingPeriodicWorkPolicy.UPDATE, req
            )
        }

        private fun millisToNextMorning(): Long {
            val now = Calendar.getInstance()
            val next = Calendar.getInstance().apply {
                set(Calendar.HOUR_OF_DAY, 9)
                set(Calendar.MINUTE, 0)
                set(Calendar.SECOND, 0)
                set(Calendar.MILLISECOND, 0)
                if (before(now)) add(Calendar.DAY_OF_YEAR, 1)
            }
            return next.timeInMillis - now.timeInMillis
        }
    }
}
