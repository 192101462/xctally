package com.qiyu.xctally

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONArray
import java.util.Calendar

/**
 * 物品每日提醒的"闹钟"接收器：AlarmManager 到点叫醒这里 → 发通知 → 排下一个闹钟。
 *
 * 为什么从 WorkManager 换成 AlarmManager：
 *   - WorkManager 的 OneTimeWork 在部分兼容层（卓易通）上随 App 进程被杀就不再跑，
 *     用户只能在打开 App 时收到积压提醒；
 *   - setAndAllowWhileIdle 即使进程被杀、Doze 中也会被系统叫醒。
 */
class ItemAlarmReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val ctx = context.applicationContext
        if (intent.action == Intent.ACTION_BOOT_COMPLETED ||
            intent.action == Intent.ACTION_MY_PACKAGE_REPLACED
        ) {
            // 开机 / 覆盖安装：按存的清单重新排下一个闹钟
            ItemReminders.schedule(ctx)
            return
        }
        // 正常到点：发"当前时刻 ±5 分钟"匹配的条目，然后排下一个
        val list = ItemReminders.load(ctx)
        val now = Calendar.getInstance()
        val nowMin = now.get(Calendar.HOUR_OF_DAY) * 60 + now.get(Calendar.MINUTE)
        val todayKey = String.format(
            java.util.Locale.US, "%04d-%02d-%02d",
            now.get(Calendar.YEAR), now.get(Calendar.MONTH) + 1, now.get(Calendar.DAY_OF_MONTH)
        )
        for (i in 0 until list.length()) {
            val o = list.optJSONObject(i) ?: continue
            val target = o.optInt("hour", 9) * 60 + o.optInt("minute", 0)
            if (Math.abs(nowMin - target) > 5) continue
            if (o.optString("done") == "$todayKey#$target") continue
            ItemReminders.notify(
                ctx, o.optString("id"), o.optString("name"),
                o.optBoolean("alarm", false)
            )
            o.put("done", "$todayKey#$target")
        }
        ItemReminders.saveRaw(ctx, list)
        ItemReminders.schedule(ctx)
    }
}

/**
 * 每日提醒的存取与排班（AlarmManager 版）。网页通过 QYAndroid.scheduleItemReminders 推全量清单。
 */
object ItemReminders {
    private const val PREFS = "xctally"
    private const val KEY = "item_reminders"
    private const val CHANNEL = "xctally_daily"
    private const val CHANNEL_ALARM = "xctally_daily_alarm"

    fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun load(ctx: Context): JSONArray {
        val raw = prefs(ctx).getString(KEY, "[]") ?: "[]"
        return try { JSONArray(raw) } catch (e: Exception) { JSONArray() }
    }

    fun saveRaw(ctx: Context, list: JSONArray) {
        prefs(ctx).edit().putString(KEY, list.toString()).apply()
    }

    /** 网页推全量清单（开/关/改时间都会推），保存后立刻排最近的闹钟 */
    fun save(ctx: Context, json: String) {
        val arr = try { JSONArray(json) } catch (e: Exception) { return }
        prefs(ctx).edit().putString(KEY, arr.toString()).apply()
        schedule(ctx)
    }

    /** 下一个闹钟 = 清单里最近的未来时刻；清单空则取消 */
    fun schedule(ctx: Context) {
        val list = load(ctx)
        val targets = HashSet<Int>()    // 当日分钟数
        for (i in 0 until list.length()) {
            val o = list.optJSONObject(i) ?: continue
            targets.add(o.optInt("hour", 9).coerceIn(0, 23) * 60 + o.optInt("minute", 0).coerceIn(0, 59))
        }
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as android.app.AlarmManager
        val pi = pending(ctx)
        if (targets.isEmpty()) {
            am.cancel(pi)
            return
        }
        val at = System.currentTimeMillis() + millisToNearest(targets)
        // 精确闹钟优先（误差秒级）；没权限或系统不给就用普通 AllowWhileIdle（Doze 里
        // 也照常触发，误差通常一两分钟）。两条路都不会抛异常出去。
        try {
            val exact = if (android.os.Build.VERSION.SDK_INT >= 31) am.canScheduleExactAlarms() else true
            if (exact) {
                am.setExactAndAllowWhileIdle(android.app.AlarmManager.RTC_WAKEUP, at, pi)
            } else {
                am.setAndAllowWhileIdle(android.app.AlarmManager.RTC_WAKEUP, at, pi)
            }
        } catch (e: SecurityException) {
            am.setAndAllowWhileIdle(android.app.AlarmManager.RTC_WAKEUP, at, pi)
        } catch (e: Exception) {
            // 连普通闹钟都设不上（极少见的兼容层）：静默，开 App 时还会重排
        }
    }

    private fun pending(ctx: Context): PendingIntent {
        return PendingIntent.getBroadcast(
            ctx, 2002,
            Intent(ctx, ItemAlarmReceiver::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
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

    fun notify(ctx: Context, id: String, name: String, alarm: Boolean) {
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

    private fun channel(ctx: Context, alarm: Boolean): String {
        val mgr = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (alarm) {
                // 渠道一旦创建，声音设置就改不动 —— 每次先删再建，
                // 保证"闹铃"渠道一定带着系统闹钟声（老版本装过的用户也生效）
                mgr.deleteNotificationChannel(CHANNEL_ALARM)
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
}
