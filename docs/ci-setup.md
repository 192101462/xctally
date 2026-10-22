# 云端自动构建：一次性配置指南

**目标**：日常只往 gitee 推代码；想发版时推一个 `v*` 标签，
云端自动构建签名 APK、建 gitee Release、更新 version.json——
手机上「检查更新」即可升级。全程无需人工干预。

**为什么是 GitHub Actions**：Gitee 官方流水线（Gitee Go）的云端构建环境
最高只支持 Gradle 4.4，装不下本项目（Gradle 9.6 + AGP 9.4 + Android SDK 37），
也不支持自定义镜像；它的 Shell 插件需要自建主机组，个人项目不划算。
GitHub Actions 对公开仓库免费，构建产物最终仍发布在 **gitee Release**
（手机下载走 gitee，国内速度不受影响）。

```
你的电脑 ──push──▶ gitee 仓库 ──推送镜像──▶ GitHub 仓库（同代码）
                      ▲                        │ 推 v* 标签触发
                      │                        ▼
                      │              GitHub Actions 云端构建签名 APK
                      └──────发布 Release + version.json 回 gitee
                                  （手机「检查更新」读这里）
```

---

## 零、生成签名密钥（还没生成过的话，先做这步）

在仓库根目录（`D:\xcnote`）的 Git Bash 里执行：

```bash
"C:\Users\1\.jdks\ms-17.0.20\bin\keytool.exe" -genkeypair -v   -keystore apps/android/release.jks -alias xctally   -keyalg RSA -keysize 2048 -validity 10950
```

> 前面那串全路径是因为这台机器 PATH 里没有 keytool（JAVA_HOME 失效）。
> 它会让你设置两遍口令（密钥库口令 = 密钥口令设成一样最省事），并问姓名/城市等——
> 随便填或一路回车都行，不影响使用。
> **口令务必记牢并备份 release.jks**：密钥丢了，已装 App 就永远无法覆盖升级。

然后创建 `apps/android/keystore.properties`（本地发版脚本用，已被 gitignore）：

```properties
storeFile=release.jks
storePassword=你刚设的口令
keyAlias=xctally
keyPassword=你刚设的口令
```

做完这步再往下配置 GitHub。

---

## 一、注册 GitHub 并建镜像仓库（约 3 分钟）

1. 注册 [github.com](https://github.com) 账号（免费）
2. 新建一个**公开**仓库（名字随意，如 `xctally`；公开仓库 Actions 不限时）
3. 生成 GitHub 私人令牌（给 gitee 镜像推送用）：头像 → Settings → Developer settings →
   Personal access tokens → **Tokens (classic)** → Generate new token
   - 权限只勾一个大项：**`repo`**（推送代码必需；它包含读改仓库的完整权限）
   - 有效期建议设 No expiration 或 90 天以上，到期换了再更新 gitee 镜像密码
   - 生成后**立即复制**（只显示一次），这就是下一步填进 gitee 镜像的密码

   > 若你想用 Fine-grained tokens（细粒度）：Repository access 选你刚建的仓库，
   > Permissions → **Contents: Read and write**（其余默认不动）即可。二选一。

## 二、在 gitee 配置"推送镜像"（约 2 分钟）

gitee 仓库 → 管理 → 仓库镜像 → **推送到镜像**：

- 镜像地址：`https://github.com/你的用户名/xctally.git`
- 用户名：GitHub 用户名
- 密码：上一步生成的 GitHub 令牌

保存后点一次"立即同步"验证。以后每次 push gitee，代码自动镜像到 GitHub。

## 三、在 GitHub 仓库配置 Secrets（约 3 分钟）

GitHub 仓库 → Settings → Secrets and variables → Actions → New repository secret，
依次添加 **5 个**：

| Secret 名 | 值 |
|---|---|
| `GITEE_TOKEN` | gitee 私人令牌（gitee → 设置 → 私人令牌，勾 projects） |
| `KEYSTORE_BASE64` | 签名密钥文件的 base64。**先完成第零步生成密钥**，然后在仓库根目录（Git Bash）执行：<br>`base64 -w0 apps/android/release.jks \| clip`<br>（内容进了剪贴板，直接去 GitHub 粘贴；若提示找不到文件 = 密钥还没生成）<br>剪贴板不可用时改用：`base64 -w0 apps/android/release.jks > /tmp/k.txt` 然后打开该文件复制 |
| `KEYSTORE_PASSWORD` | 密钥库口令 |
| `KEY_ALIAS` | 密钥别名（默认 `xctally`） |
| `KEY_PASSWORD` | 密钥口令 |

> 密钥一旦换掉，老用户无法覆盖升级——这三个 Secret 要和
> `tools/release.py` 本地发版用的密钥保持一致（同一把）。

## 四、把本仓库的流水线文件推上去

`.github/workflows/release.yml` 和 `tools/ci_publish.py` 已在仓库里，
随代码一起 push 到 gitee，镜像同步到 GitHub 后即生效。

## 五、发版 = 推一个标签

```bash
python tools/release.py --help     # 本地一键发版仍可用（不经过云端）
# 云端自动构建发版：
git tag v1.1
git push origin v1.1               # gitee → 镜像 → GitHub Actions 自动构建发布
```

构建进度看 GitHub 仓库的 **Actions** 页（一次约 5-8 分钟）。
完成后 gitee 的"发行版"页面出现新 Release，`version.json` 已更新，
手机上点「检查更新」即可。

> 标签推错了想重发：本地 `git tag -f v1.1 && git push -f origin v1.1`
> 重新触发（发布脚本对同名 Release 会报错，删掉 gitee 上那个 Release 再触发）。

## 常见问题

- **Actions 没触发**：确认仓库是公开的；确认 gitee 镜像同步成功（GitHub 仓库里有最新提交和标签）
- **发布步骤报 401/404**：`GITEE_TOKEN` 过期或没勾 projects 权限
- **构建失败 gradle 版本**：看 Actions 日志；本流水线按 Gradle 9.6 / AGP 9.4 / SDK 37 配置
- **只想构建不发布**：GitHub Actions 页 → release → Run workflow，版本留空
