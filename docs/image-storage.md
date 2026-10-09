# xctally 随笔图片的存储方案

> 原型里图片是 **base64 直接塞进正文 HTML** 的。这只适合演示，正式版必须换掉。
> 这份文档给出目标架构、压缩参数、跨平台坑和迁移步骤。

---

## 1. 为什么不能长期用 base64

| 问题 | 说明 |
|---|---|
| **体积膨胀 33%** | base64 编码本身的开销 |
| **正文变成巨型字符串** | 列表页、搜索、全量备份都要搬运它 |
| **存储上限** | 浏览器 localStorage 约 5MB；100 张 200KB 的照片 ≈ 27MB 文本，直接撞墙 |
| **无法懒加载** | 列表里显示封面必须解析整条正文 |
| **无法整体管理** | 不能"清理孤立图片""只删缩略图""按大小排序" |
| **备份文件爆炸** | 换手机导出的 JSON 会有几十 MB |

原型的自检里可以看到真实数字：**7.97 MB 的原始照片 → 压缩后 1.04 MB**，
但再转成 base64 存进 JSON，又白白多出 33%。

---

## 2. 目标架构

```
Documents/                      ← App 私有目录（iOS: Application Support 更合适）
├─ xctally.db                    ← SQLite：物品 / 随笔 / 能源
└─ media/
   └─ 2026/
      └─ 10/
         ├─ 01H8XQ..._a1b2c3.jpg        压缩后的原图
         └─ 01H8XQ..._a1b2c3_thumb.jpg  缩略图
```

**规则**：
- 文件名 = `ULID + 内容短哈希`，避免重名，也避免用户原始文件名里的特殊字符
- 按 `年/月` 分目录，别把几万个文件堆在一个目录里（文件系统会变慢）
- **数据库里只存相对路径**（如 `media/2026/10/xxx.jpg`）

---

## 3. 数据库

```sql
CREATE TABLE media (
  id          TEXT PRIMARY KEY,   -- ULID
  entry_id    TEXT,               -- 属于哪条随笔（软关联，允许为空=孤立图片）
  rel_path    TEXT NOT NULL,      -- 相对 Documents 的路径
  thumb_path  TEXT,
  width       INTEGER,
  height      INTEGER,
  bytes       INTEGER,
  mime        TEXT,
  sha256      TEXT,               -- 内容哈希，可用于去重
  created_at  INTEGER NOT NULL,
  deleted_at  INTEGER             -- 软删除，定期清理
);
CREATE INDEX idx_media_entry ON media(entry_id);
```

正文里存**自定义 scheme**，渲染时再替换成真实路径：

```html
<p>第二杯把水温降到 90 度。</p>
<img src="xctally://media/01H8XQ...">
```

### ⚠️ 绝对不能存绝对路径

```
❌ file:///var/mobile/Containers/Data/Application/8F3A.../Documents/media/a.jpg
✅ media/2026/10/01H8XQ..._a1b2c3.jpg   （或 xctally://media/<id>）
```

**iOS 每次安装、升级、恢复备份，沙盒容器 UUID 都会变。** 存绝对路径的结果是
用户升级一次 App，所有图片全部裂开。这是同类 App 最经典的翻车方式。

---

## 4. 压缩参数（原型已验证）

| 场景 | 处理 |
|---|---|
| 普通照片 | 长边 **1600px**、JPEG **q=0.82** |
| 截图 / 纯色图 | JPEG 反而更大时，**保留原图**（阈值：原图 < 400KB） |
| **动图 GIF** | **绝不重编码** —— canvas 会把动画压成静态第一帧；只限制体积上限（如 5MB）并提示用户 |
| HEIC（iPhone 默认） | 用系统解码后再压；浏览器 / 部分安卓解不开 |
| 缩略图 | 长边 320px、JPEG q=0.7，列表和长图预览用 |
| EXIF | 重编码天然丢弃（**包括 GPS**）；想保留拍摄时间就单独抽成字段 |

**先降采样再解码**：4000 万像素的照片如果直接整张解码进内存，会 OOM。

- Android：`BitmapFactory.Options.inSampleSize`
- iOS：`CGImageSourceCreateThumbnailAtIndex`
- Flutter：`instantiateImageCodec(targetWidth:)`

---

## 5. 已有数据怎么迁移

原型 → 正式版、或正式版早期版本升级，都可能带着 base64 数据：

```
1. 遍历 entries
2. 解析 body_html，找出所有 src 以 data:image/ 开头的 img
3. 逐张：base64 解码 → 写文件到 media/yyyy/mm/ → 插入 media 表
4. 把该 img 的 src 换成 xctally://media/<id>
5. 写回 body_html
6. 每处理完一条随笔就提交一次事务（可中断续跑，别指望一次跑完）
7. 全部完成后 VACUUM 数据库回收空间
```

要点：**一条一条提交**。用户手机上可能有上千条随笔，
中途来电、切后台被杀，整体事务会导致全部回滚重来。

---

## 6. 备份文件也要改

| 版本 | 格式 | 适用 |
|---|---|---|
| 原型 | 单个 JSON（图片 base64 内嵌） | 数据量小、演示 |
| 正式版 | **ZIP**：`xctally.db` + `media/` 目录 | 真实使用 |

- 导出：打包成 zip，仍然保留"先对比再合并"的恢复流程
- 恢复：解压到沙盒新目录 → 校验 sha256 → 重写路径前缀 → 合并数据库
- 大文件要显示进度，别让用户以为卡死了

---

## 7. 清理策略

- 删除随笔 → 对应 media 软删除 → 定期（如 7 天后）物理删除
- 提供「清理孤立图片」：media 表里 `entry_id` 找不到、或正文里已无引用的
- 设置里显示占用明细（图片 / 缩略图 / 数据库），支持"只清缩略图"（可重建）
- 图片写入失败要能降级：宁可这条随笔没图，也不能让整条保存失败

---

## 8. 各平台差异备忘

| 平台 | 注意点 |
|---|---|
| iOS | 沙盒路径会变（用相对路径）；相册权限文案；后台压缩注意内存峰值 |
| Android | 分区存储（Scoped Storage），用 App 私有目录，别申请全盘权限；HEIC 支持因厂商而异 |
| 鸿蒙 | 沙盒目录 API 与 Android 不同，但"相对路径 + 私有目录"策略一致 |
| 全平台 | 压缩放在**后台线程**，UI 只显示进度；单张失败不要中断批量导入 |

---

## 9. 一句话总结

**库里只存相对路径，图片落地成文件，正文用自定义 scheme 引用，备份改成 ZIP。**
压缩参数照抄原型里已经验证过的那套（1600px / q0.82 / 动图不重编码），
迁移时一条一条提交事务。这四件事做对了，图片这块就不会出大问题。
