# xctally 协作方案：邀请好友一起记录

> ## ⛔️ 状态：已暂缓
>
> 已经决定 **xctally 做成单机本地工具**：不注册、不联网、不上传，
> 换手机靠「导出完整备份 → 新设备恢复」（见 `prototype/backup.js`）。
>
> 这份文档**仅作留档**。如果以后真的要做多人协作（比如家人共用一个账本），
> 下面的数据模型、API 契约、同步与冲突策略可以直接拿来用，不用重新设计。
>
> ---
>
> 早期实现过的「分享包互传」也已一并取消。

---

> 面向「我有台小服务器」的场景。目标：**你和朋友能各自记录、互相看见**，同时不把 App 做成"没服务器就不能用"。

---

## 当前进度

| 阶段 | 状态 |
|---|---|
| **0. 分享包互传** | ❌ **已取消**（实现过又移除了，改为纯本地备份） |
| 1. 注册登录 + 空间 + 邀请码 + 单向同步 | 未开始 |
| 2. 双向同步 + 冲突处理 | 未开始 |
| 3. 评论点赞 / 成员管理 / 图片上传 | 未开始 |

> 取消的原因：xctally 定位成**单机本地工具**，不做公网服务，也就顺带绕开了域名备案。
> 「换手机」的需求由 **导出完整备份 → 新设备恢复** 满足（`prototype/backup.js`）。
> 下面这套服务端设计依然可用 —— 哪天决定做多人协作（比如家人共用一本账），照它实现即可。

---

## 0. 先说合规：挂了公网服务，性质就变了

之前的结论是「纯离线 App 可向 Apple 申请 ICP 备案豁免」。**一旦你的服务器对公众提供互联网信息服务，这条就不成立了**：

- 域名需要 **ICP 备案**（境内服务器 + 域名实名，走云厂商代提交）
- App 上架国内商店还需要 **App 备案**（App 备案的前提是域名已备案，见主 README）
- 也就是说：**"邀请好友"这个功能，会把整个项目从"零合规成本"推到"必须备案"**

**测试阶段的务实做法**（三选一，风险递增）：

| 方式 | 是否需要备案 | 说明 |
|---|---|---|
| **A. 分享包互传（0 服务器）** | 否 | 导出一个 `.xctally` 文件（JSON/zip）发给朋友，对方导入即可看；对方导出再发回来，你合并。**今天就能用** |
| **B. 私有网络**（Tailscale / ZeroTier / frp） | 否 | 服务只在你和朋友的内网里可达，公网不暴露。体验接近真同步，但每人都要装客户端 |
| **C. 公网域名 + 公网服务** | **是** | 真正的"邀请链接一键加入"，但必须先备案 |

**建议路径**：先用 **A** 验证"和朋友一起记"到底有没有意思；确认有价值，再上 **C** 并接受备案成本。
架构上请坚持「离线优先」：本地库永远是完整可用的，服务器只是同步中枢。这样上面三条路可以随时切换。

---

## 1. 协作形态：选"空间 + 单条可见性"

| 形态 | 说明 | 问题 |
|---|---|---|
| 各记各的 + 互相关注 | 好友关系，数据默认私有，手动分享 | 分享动作太重，朋友之间会懒得点 |
| 家庭共享账本 | 一份数据多人编辑 | 日记这种东西一定会打架 |
| **空间 + 单条可见性**（推荐） | 建一个"空间"（如「我们家」「宿舍」），邀请码加入；空间内默认互相可见；**单条可标"仅自己可见"** | 需要在服务端强制过滤私有条目 |

推荐形态下：物品/能源这类"事实数据"默认共享（谁买了、用了多少，本来就该共享）；日记默认私有，想发就发。

---

## 2. 服务端数据模型

```sql
-- 用户
CREATE TABLE users (
  id            TEXT PRIMARY KEY,          -- ULID
  nickname      TEXT NOT NULL,
  email         TEXT UNIQUE,               -- 或 phone
  pwd_hash      TEXT NOT NULL,             -- argon2id / bcrypt
  created_at    INTEGER NOT NULL
);

-- 空间：协作的最小单位
CREATE TABLE spaces (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  owner_id      TEXT NOT NULL REFERENCES users(id),
  created_at    INTEGER NOT NULL
);

-- 成员
CREATE TABLE space_members (
  space_id      TEXT NOT NULL REFERENCES spaces(id),
  user_id       TEXT NOT NULL REFERENCES users(id),
  role          TEXT NOT NULL DEFAULT 'member',   -- owner | member
  joined_at     INTEGER NOT NULL,
  PRIMARY KEY (space_id, user_id)
);

-- 邀请码：限次 + 有效期，可撤销
CREATE TABLE invites (
  code          TEXT PRIMARY KEY,          -- 8 位随机
  space_id      TEXT NOT NULL REFERENCES spaces(id),
  created_by    TEXT NOT NULL REFERENCES users(id),
  expires_at    INTEGER,
  max_uses      INTEGER DEFAULT 1,
  used_count    INTEGER DEFAULT 0,
  revoked       INTEGER DEFAULT 0,
  created_at    INTEGER NOT NULL
);

-- 业务数据：物品 / 收藏 / 能源读数统一放这一张表
CREATE TABLE entries (
  id            TEXT PRIMARY KEY,          -- 客户端生成 ULID，保证幂等
  space_id      TEXT NOT NULL REFERENCES spaces(id),
  module        TEXT NOT NULL,             -- item | collect | meter
  payload       TEXT NOT NULL,             -- JSON 原样存，服务端不理解业务细节
  visibility    TEXT NOT NULL DEFAULT 'space',  -- space | private
  created_by    TEXT NOT NULL REFERENCES users(id),
  updated_by    TEXT NOT NULL REFERENCES users(id),
  updated_at    INTEGER NOT NULL,          -- 客户端时间，仅作展示
  server_seq    INTEGER NOT NULL,          -- 服务端自增，同步游标用它
  rev           INTEGER NOT NULL DEFAULT 1,
  deleted_at    INTEGER                    -- 软删除（tombstone）
);
CREATE INDEX idx_entries_sync ON entries(space_id, server_seq);

-- 冲突留档：同一条两端都改过时，谁都不覆盖
CREATE TABLE entry_conflicts (
  id            TEXT PRIMARY KEY,
  entry_id      TEXT NOT NULL REFERENCES entries(id),
  space_id      TEXT NOT NULL,
  payload       TEXT NOT NULL,             -- 落败的那一版
  author_id     TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);
```

**关键设计：`payload` 存 JSON，服务端不理解业务字段。**
好处是收藏模块以后怎么改字段、加类型，服务端都不用动。代价是不能按字段查询 —— 对这个体量完全划算。

---

## 3. API 契约

统一前缀 `/api`，鉴权用 `Authorization: Bearer <token>`。

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/auth/register` | `{nickname, email, password}` → `{token, user}` |
| POST | `/auth/login` | `{email, password}` → `{token, user}` |
| GET | `/me` | 当前用户 |
| POST | `/spaces` | `{name}` → 建空间（创建者即 owner） |
| GET | `/spaces` | 我加入的所有空间 |
| POST | `/spaces/:id/invites` | `{expiresInDays, maxUses}` → `{code, url}` |
| GET | `/spaces/:id/invites` | 未撤销的邀请码列表 |
| DELETE | `/invites/:code` | 撤销邀请 |
| POST | `/invites/:code/accept` | 加入空间 → `{space, member}` |
| GET | `/spaces/:id/members` | 成员列表 |
| GET | `/spaces/:id/entries?since=<seq>&limit=200` | 增量拉取 → `{entries[], nextSeq, hasMore}` |
| POST | `/spaces/:id/entries` | **批量** upsert，body `{entries:[{id, module, payload, visibility, rev, updatedAt}]}` |
| DELETE | `/spaces/:id/entries/:id` | 软删除，写 tombstone |

**提交一律批量**（一次最多 200 条）：手机上网络切换频繁，逐条提交会反复断在半路。

---

## 4. 同步策略（决定"会不会丢日记"）

1. **客户端本地库是完整的真相源**，离线照常读写，服务器只是同步中枢。
2. **id 由客户端生成（ULID）** —— 同一份数据重复提交不会产生重复行（幂等）。
3. **增量拉取用服务端自增 `server_seq`**，不用时间戳。手机时钟不准是常态，用时间戳做游标迟早漏数据。
4. **冲突不静默覆盖**：同一条两端都改 → 服务端把落败版本写进 `entry_conflicts`，客户端在详情页顶部提示「这条在别处也改过，选一个保留」。
   > 日记被悄悄覆盖，是这个功能最不能犯的错。宁可多问一句。
5. **删除用 tombstone**（`deleted_at`），否则离线设备一同步就把删掉的东西"复活"。
6. **每台设备记录 `lastSeq`**，启动时先拉增量、再推本地 dirty 数据。

---

## 5. 邀请流程

```
你：空间 → 「邀请朋友」→ 生成邀请码 ABC12XYZ（7 天有效、1 次）
   → 分享链接 https://你的域名/join?c=ABC12XYZ
好友：打开链接 → 注册/登录 → 接受邀请 → 进入空间 → 自动拉全量
```

安全细节：
- 邀请码 **8 位随机、限次、有有效期、可撤销**
- 接受邀请**必须已登录**，不允许匿名加入
- 对 `/auth/login` 和 `/invites/*/accept` 限流（防爆破）
- **不要开放公开注册页**，测试期只发邀请码 —— 这既是安全，也是合规上的克制

---

## 6. 你那台小服务器的部署清单

**配置**：1 核 1G 起步，几十个用户、几万条记录毫无压力。

**技术栈（按省事程度排序）**：

| 方案 | 说明 |
|---|---|
| **Node + Fastify + better-sqlite3**（推荐） | 单文件部署，SQLite 开 WAL，无外部依赖，一台机器跑得下 |
| Python + FastAPI + SQLite | 同样简单，如果你更熟 Python |
| Supabase / Cloudflare Workers + D1 | 省运维，但境外节点 + 数据出境，国内体验与合规都别扭 |

**必备**：
- HTTPS（Caddy 自动证书最省事；Nginx + certbot 也行）
- 每天定时备份（`sqlite3 .backup` + 推到对象存储/另一台机器），备份加密
- 限流 + 访问日志 + 健康检查端点
- 密码用 argon2id 或 bcrypt；token 短期 + 刷新，或直接上 session

**不要做**：Redis、消息队列、K8s、微服务。这个量级纯属给自己找活干。

### 只有公网 IP、没有域名时（你当前的情况）

```
阶段 A：IP + 非标端口 + 私有网络
  http://<公网IP>:8443
  优点：立刻能跑，不需要备案
  缺点：① 没有域名就签不了 Let's Encrypt 证书，App 端要么走 HTTP（明文，不能传密码），
           要么自签证书、在每个朋友手机上手动信任一次
        ② 运营商可能封常见端口，选高位端口
        ③ 你的服务实际上已经暴露在公网，只是没人知道地址

阶段 B：拿到域名 + 备案
  1. 买域名（几十块/年）→ 实名认证
  2. 用云厂商备案系统提交：域名备案（个人主体只需身份证）
  3. 域名解析到你的服务器 → Caddy 自动申请 HTTPS 证书
  4. 至此才能做「邀请链接一键加入」
  5. App 要上国内商店时，再补 App 备案（前提就是域名已备案）
```

**如果只是和几个朋友测试**：推荐 Tailscale / ZeroTier 组一个私有网络，服务只监听内网地址，
公网完全不暴露 —— 不用备案、不用证书、不怕扫描，体验和真同步几乎一样。等确认要对外了再买域名。

---

## 7. 客户端要改什么

- 数据层加一张 `sync_state`：`local_id / server_seq / dirty / deleted / last_synced_at`
- 三个模块（物品 / 收藏 / 能源）**共用同一个同步队列**，不要各写一套
- 冲突提示 UI（详情页顶部一条黄色横幅 + 「保留我这版 / 保留对方版本」）
- 空间切换器：我的数据默认在"个人空间"，可以切到共享空间
- **离线优先不变**：没网照样记，联网自动补传；永远不要把"记录"这个动作绑在网络请求上

---

## 8. 分阶段落地

| 阶段 | 内容 | 价值 |
|---|---|---|
| **0** | 导出/导入 `.xctally` 分享包（**零服务器**） | 今天就能和朋友一起玩，零合规成本 |
| **1** | 注册登录 + 空间 + 邀请码 + **单向同步**（只看不写） | 已经能"一起记录"，实现量最小 |
| **2** | 双向同步 + 冲突处理 + 软删除 | 真正可用 |
| **3** | 评论/点赞、成员管理、图片上传（对象存储） | 锦上添花 |

建议别跳阶段 0：它成本最低，而且能提前告诉你"朋友到底会不会用"。

---

## 9. 一句话总结

**空间 + 邀请码 + 客户端 ULID + 服务端 seq 增量同步 + 冲突留档不覆盖 + tombstone 删除**，
服务端只存 JSON 不理解业务，SQLite 就够，唯一真正的门槛是**域名备案**。
先用分享包验证需求，再决定要不要付这个成本。
