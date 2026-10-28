package com.qiyu.xctally

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONArray
import java.util.Calendar
import java.util.concurrent.TimeUnit

/**
 * 物品每日提醒：吃药 / 喝牛奶这类每天到点的打卡提醒。
 *
 * 和到期提醒（ReminderWorker）是两码事：
 *   - 那边是"每天扫一遍，到期的弹一次"
 *   - 这边是"每条物品各自固定时刻，每天弹"，还分普通通知 / 闹铃两种
 *
 * 排班策略：单个 OneTimeWork 自链——醒来时把"当前小时匹配"的条目发掉，
 * 然后把下一次唤醒排到清单里最近的钟点。物品增删改后网页会推全量清单
 * 重新 schedule，所以清单变化不会漂。
 *
 * 闹铃：单独一条 high importance + 系统闹钟音效的 channel
 * （吃漏药比看漏通知严重，值得响铃）；普通提醒走默认 channel。
 */
class ItemReminderWorker(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {

    override fun doWork(): Result {
        val ctx = applicationContext
        val list = load(ctx)
        val now = Calendar.getInstance()
        val nowMin = now.get(Calendar.HOUR_OF_DAY) * 60 + now.get(Calendar.MINUTE)
        val todayKey = todayKey(now)

        for (i in 0 until list.length()) {
            val o = list.optJSONObject(i) ?: continue
            val target = o.optInt("hour", 9) * 60 + o.optInt("minute", 0)
            // WorkManager 有分钟级误差：醒在目标 ±5 分钟内都算到点
            if (Math.abs(nowMin - target) > 5) continue
            // 一天只弹一次：done 标记 = "日期#时分"
            if (o.optString("done") == "$todayKey#$target") continue
            val name = o.optString("name")
            val alarm = o.optBoolean("alarm", false)
            notify(ctx, o.optString("id"), name, alarm)
            o.put("done", "$todayKey#$target")
        }
        prefs(ctx).edit().putString(KEY, list.toString()).apply()
        schedule(ctx)
        return Result.success()
    }

    companion object {
        private const val PREFS = "xctally"
        private const val KEY = "item_reminders"
        private const val WORK = "xctally_item_reminders"
        private const val CHANNEL = "xctally_daily"
        private const val CHANNEL_ALARM = "xctally_daily_alarm"

        private fun todayKey(cal: Calendar): String {
            return String.format(
                java.util.Locale.US, "%04d-%02d-%02d",
                cal.get(Calendar.YEAR), cal.get(Calendar.MONTH) + 1, cal.get(Calendar.DAY_OF_MONTH)
            )
        }

        private fun channel(ctx: Context, alarm: Boolean): String {
            val mgr = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (alarm) {
                    val ch = NotificationChannel(CHANNEL_ALARM, "每日提醒（闹铃）", NotificationManager.IMPORTANCE_HIGH)
                    ch.description = "吃药 / 喝牛奶这类打卡提醒，带闹铃声"
                    ch.setSound(
                        RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM),
                        AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_ALARM)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                            .build()
                    )
                    ch.enableVibration(true)
                    mgr.createNotificationChannel(ch)
                } else {
                    val ch = NotificationChannel(CHANNEL, "每日提醒", NotificationManager.IMPORTANCE_DEFAULT)
                    ch.description = "物品的每日打卡提醒"
                    mgr.createNotificationChannel(ch)
                }
            }
            return if (alarm) CHANNEL_ALARM else CHANNEL
        }

        private fun notify(ctx: Context, id: String, name: String, alarm: Boolean) {
            val open = PendingIntent.getActivity(
                ctx, 1,
                Intent(ctx, MainActivity::class.java),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
            )
            val body = if (alarm) "该「$name」啦（闹钟提醒）" else "别忘了今天的「$name」"
            val n = NotificationCompat.Builder(ctx, channel(ctx, alarm))
                .setSmallIcon(android.R.drawable.ic_popup_reminder)
                .setContentTitle("琪遇台账 · 每日提醒")
                .setContentText(body)
                .setStyle(NotificationCompat.BigTextStyle().bigText(body))
                .setAutoCancel(true)
                .setContentIntent(open)
                .setCategory(if (alarm) NotificationCompat.CATEGORY_ALARM else NotificationCompat.CATEGORY_REMINDER)
                .setPriority(if (alarm) NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT)
                .build()
            try {
                NotificationManagerCompat.from(ctx).notify(("daily" + id).hashCode(), n)
            } catch (e: SecurityException) {
                // 没有通知权限，安静失败
            }
        }

        private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

        fun load(ctx: Context): JSONArray {
            val raw = prefs(ctx).getString(KEY, "[]") ?: "[]"
            return try { JSONArray(raw) } catch (e: Exception) { JSONArray() }
        }

        /** 网页推全量清单（开 / 关 / 改时间都会推），保存后立刻重排到最近的钟点 */
        fun save(ctx: Context, json: String) {
            val arr = try { JSONArray(json) } catch (e: Exception) { return }
            prefs(ctx).edit().putString(KEY, arr.toString()).apply()
            schedule(ctx)
        }

        /** 下一次唤醒 = 清单里最近的未来时刻（时:分，分钟级）；清单空则取消排班 */
        fun schedule(ctx: Context) {
            val list = load(ctx)
            val targets = HashSet<Int>()   // 当日分钟数（0-1439）
            for (i in 0 until list.length()) {
                val o = list.optJSONObject(i) ?: continue
                targets.add(o.optInt("hour", 9).coerceIn(0, 23) * 60 + o.optInt("minute", 0).coerceIn(0, 59))
            }
            if (targets.isEmpty()) {
                WorkManager.getInstance(ctx).cancelUniqueWork(WORK)
                return
            }
            val req = OneTimeWorkRequestBuilder<ItemReminderWorker>()
                .setInitialDelay(millisToNearest(targets), TimeUnit.MILLISECONDS)
                .build()
            WorkManager.getInstance(ctx).enqueueUniqueWork(WORK, ExistingWorkPolicy.REPLACE, req)
        }

        private fun millisToNearest(targets: Set<Int>): Long {
            val now = Calendar.getInstance()
            var best = Long.MAX_VALUE
            for (m in targets) {
                val t = Calendar.getInstance().apply {
                    set(Calendar.HOUR_OF_DAY, m / 60)
                    set(Calendar.MINUTE, m % 60)
                    set(Calendar.SECOND, 0)
                    set(Calendar.MILLISECOND, 0)
                    if (before(now)) add(Calendar.DAY_OF_YEAR, 1)
                }
                if (t.timeInMillis - now.timeInMillis < best) best = t.timeInMillis - now.timeInMillis
            }
            return best
        }
    }
}
