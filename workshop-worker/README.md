# 镜译 · 音色工坊后端

一个 Cloudflare Worker（一个 JS 文件，没有依赖）加一个 D1 数据库（SQLite）。插件里的「音色工坊」页面靠它登录、存投稿、列表、计数。

本地整合版的工坊地址默认留空。下面是实际配置服务时使用的部署步骤。

免费额度够用：Workers 每天 10 万次请求，D1 免费 5 GB。一张头像压缩后大约 30 KB，存几万个投稿也放得下。

---

## 一、从零部署（大约 15 分钟）

准备 Cloudflare 和 Discord 账号。下文的本地检查使用 Node.js 24。

### 1. 在 Discord 建一个应用

1. 打开 <https://discord.com/developers/applications>，点 **New Application**，名字随便，比如「镜译音色工坊」。
2. 左边 **OAuth2** 页：
   - 复制 **Client ID**（后面要填进 `wrangler.toml`，不是秘密）。
   - 点 **Reset Secret** 复制 **Client Secret**（后面用命令行存，不要写进文件、不要发给别人）。
   - **Redirects** 里先不填，第 4 步拿到 Worker 地址以后回来加。
3. 不用建 Bot，也不用在后台勾 scope；授权链接里已经写了只要 `identify`（用户名、头像、数字 ID）。

### 2. 装工具、登录 Cloudflare

```bash
cd workshop-worker
npm install
npx wrangler login
```

### 3. 建数据库

```bash
npx wrangler d1 create jingyi-voice-workshop
```

输出里有一行 `database_id = "…"`，把它填进 `wrangler.toml` 的 `database_id`。然后建表：

```bash
npm run db:init
```

`schema.sql` 可以重复执行，已有的表不会被动。

### 4. 第一次部署，拿到地址

```bash
npx wrangler deploy
```

输出里会有你的地址，形如 `https://jingyi-voice-workshop.你的子域名.workers.dev`。

现在改 `wrangler.toml`：

| 项 | 填什么 |
|---|---|
| `PUBLIC_URL` | 上面这个地址，**结尾不要斜杠** |
| `DISCORD_CLIENT_ID` | 第 1 步复制的 Client ID |
| `ADMIN_IDS` | 你自己的 Discord 数字 ID（Discord 设置 → 高级 → 打开「开发者模式」→ 右键自己的头像 → 复制用户 ID）。多个用英文逗号隔开 |

### 5. 存两个密钥

```bash
npx wrangler secret put DISCORD_CLIENT_SECRET     # 粘贴 Client Secret
npx wrangler secret put FISH_API_KEY              # 可选，见下面的说明
```

`FISH_API_KEY` 不填也能用：投稿时由投稿人的插件用他自己的 Key 去核对音色。填了以后，服务器在收到投稿时会**再核对一次**（音色存在吗、是不是私有），并且「Fish 上的原作者」以 Fish 返回的为准，防止有人乱填。

改完 `wrangler.toml` 后再部署一次：

```bash
npx wrangler deploy
```

### 6. 回 Discord 后台填回调地址

Discord 应用 → OAuth2 → **Redirects** → Add Redirect，填：

```
https://你的地址/api/auth/callback
```

要和 `PUBLIC_URL` + `/api/auth/callback` **一个字都不差**（协议、大小写、有没有斜杠），点 Save Changes。这是最容易出错的一步。

### 7. 把地址填进插件

打开插件里的 `workshop.js`，顶部：

```js
export const WORKSHOP_API = 'https://你的地址';
```

使用 HTTPS 地址，不带结尾斜杠。地址须与 Worker 的 `PUBLIC_URL` 一致。随插件发布时，同步更新插件版本和 `?v=` 缓存版本。

### 8. 验证

- 浏览器打开 `https://你的地址/api`，应该看到 `{"ok":true,"service":"jingyi-voice-workshop"}`。
- 酒馆里打开「微调 → 朗读 → 进入音色工坊」；高级模式在「朗读 → 音色 → 音色工坊」。使用 Discord 登录，授权页面显示「登录成功」后回到酒馆。

---

## 二、登录是怎么走的（为什么这样设计）

酒馆里的插件、手机上的 App 壳、Discord 授权页，三者不在同一个页面里，所以不用弹窗回传，而是**轮询**：

```
插件                          Worker                       Discord
 │ POST /api/auth/start ───────▶│ 生成随机 state，存 10 分钟
 │◀── { state, url } ───────────│
 │ 新标签打开 url ───────────────────────────────────────────▶│ 用户点「授权」
 │                              │◀── /api/auth/callback?code&state ─┤
 │                              │ 用 code 换 access_token，取 /users/@me
 │                              │ 生成自己的登录 token，存哈希，明文放进这次登录记录
 │ GET /api/auth/poll?state ───▶│ 还没好：{status:"pending"}；好了：交出 token，并删掉记录
 │◀── { status:"done", token } ─│
```

- Discord 给的 access_token 用完就丢，不保存；只留下 Discord 数字 ID、显示名、头像 hash。
- 登录 token 是 32 字节随机数，领取后数据库只存它的 SHA-256。插件在浏览器的 localStorage 中保存登录信息（键名 `jingyi.workshop.session.v1`），有效期 30 天，切换工坊服务地址后需要重新登录。
- `state` 就是这次登录的秘密，只有发起登录的那个插件知道；token 只会交出一次。
- 手机上弹窗被拦时，插件界面会多出一行「没弹出页面？点这里打开授权页」，点一下就在新标签页里打开；不想等了点「取消」。

---

## 三、接口

基础地址是 `PUBLIC_URL`。普通接口返回 JSON，成功含 `"ok": true`，失败带错误代码和提示。授权回调返回 HTML，头像返回图片。除了健康检查、登录开始和轮询、授权回调、公开头像及 CORS 预检，接口需要 `Authorization: Bearer <登录 token>`。凭证缺失或过期时返回 `401`。

跨域：允许任意来源（`Access-Control-Allow-Origin: *`）。因为认证靠请求头而不是 Cookie，所以这样是安全的。

### 登录

| 接口 | 说明 |
|---|---|
| `POST /api/auth/start` | 不用登录。返回 `{ state, url, expiresIn: 600 }`，`url` 是要打开的 Discord 授权页 |
| `GET /api/auth/callback` | Discord 授权完成后跳回来的页面，给人看的 HTML，不是给程序调用的 |
| `GET /api/auth/poll?state=…` | 不用登录。`{status:"pending"}`；授权好了 `{status:"done", token, user}`；取消授权 `403 denied`；过期 `410 expired` |
| `POST /api/auth/logout` | 让这个 token 立即作废 |
| `GET /api/me` | `{ user: { id, name, avatar, admin } }` |

### 音色

一条音色（`Voice`）长这样：

```json
{
  "id": "k3m9x2p7q4ab",
  "name": "白露",
  "src": "温柔御姐 · 原创设定",
  "lang": "zh",
  "fishId": "a1b2c3d4e5f60718293a4b5c6d7e8f90",
  "fishBy": "Amber",
  "copies": 128,
  "status": "ok",
  "createdAt": 1790000000000,
  "cover": "https://…/api/voices/k3m9x2p7q4ab/cover",
  "by": { "id": "123456789012345678", "name": "渡口", "avatar": "https://cdn.discordapp.com/…" },
  "mine": false
}
```

| 接口 | 说明 |
|---|---|
| `GET /api/voices` | 列表。参数：`sort=new｜hot`、`lang=zh｜ja｜en｜other`（`other` 是这三种以外的所有语言）、`q=搜索词`（搜角色名、出处、音色 ID）、`mine=1`（只看自己的，含被隐藏的）、`page`、`limit`（最多 48，默认 24）。返回 `{ items, hasMore, page }`；第一页还带 `counts`（各语言数量、`mine`）和 `hero`（复制最多的一条，只在没有任何筛选时给） |
| `POST /api/voices` | 投稿。body：`{ name, src, lang, fishId, fishBy, cover }`，`cover` 是 `data:image/webp｜jpeg｜png;base64,…`（可选，解码后不超过 100 KB，服务器会检查文件头，格式对不上直接拒绝）。成功 `201 { voice }` |
| `DELETE /api/voices/:id` | 删除。本人或管理员；头像、复制记录、举报一起清掉 |
| `POST /api/voices/:id/copy` | 记一次复制：每人每个音色只算一次，投稿人复制自己的不算。返回 `{ copies, counted }` |
| `POST /api/voices/:id/report` | 举报，body `{ reason }`。不同的人举报满 `REPORT_HIDE_AT`（默认 3）次自动隐藏 |
| `GET /api/voices/:id/cover` | 头像图，**不需要登录**（`<img>` 标签发不了请求头）。id 是随机的，没登录的人拿不到列表，也就找不到它；被隐藏的投稿不再提供头像 |

投稿失败的常见代码：`bad_name`、`bad_fish_id`、`bad_cover`、`cover_too_large`（413）、`duplicate`（409，同一个 Fish 音色全站只能有一条，不分大小写；带 `existingId`）、`rate_limited`（429，每人每天最多 20 条）、`too_many`（429，每人最多 200 条）、`fish_not_found` / `fish_private`（只有配了 `FISH_API_KEY` 才会出现）。

### 管理员

`ADMIN_IDS` 里的人才能用：

| 接口 | 说明 |
|---|---|
| `GET /api/admin/reports` | 被举报的音色，按举报数排序 |
| `POST /api/admin/voices/:id/status` | body `{ "status": "hidden" }` 或 `{ "status": "ok" }`；恢复成 `ok` 会清掉这条的举报记录 |
| `POST /api/admin/users/:discordId/ban` | body `{ "banned": true }`：封人，会话立刻作废，投稿全部隐藏，也登录不进来；`false` 解封（投稿不会自动恢复） |

管理员删任何人的投稿，用的是普通的 `DELETE /api/voices/:id`。

自己的登录 token 在酒馆页面的浏览器控制台里取：

```js
JSON.parse(localStorage.getItem('jingyi.workshop.session.v1')).token
```

然后：

```bash
TOKEN=上面取到的
API=https://你的地址

curl -H "Authorization: Bearer $TOKEN" $API/api/admin/reports
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{"status":"hidden"}' $API/api/admin/voices/投稿id/status
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{"banned":true}' $API/api/admin/users/对方的DiscordID/ban
```

不想用接口的话，直接改数据库也行：

```bash
npx wrangler d1 execute jingyi-voice-workshop --remote --command "SELECT id, name, fish_id, status FROM voices ORDER BY created_at DESC LIMIT 20"
npx wrangler d1 execute jingyi-voice-workshop --remote --command "UPDATE voices SET status='hidden' WHERE id='投稿id'"
npx wrangler d1 execute jingyi-voice-workshop --remote --command "UPDATE users SET banned=1 WHERE id='对方的DiscordID'"
```

### 限制汇总

| 项 | 数值 |
|---|---|
| 每人每天投稿 | 20 |
| 每人投稿总数 | 200 |
| 每人每天举报 | 30 |
| 头像图 | 解码后 ≤ 100 KB（插件会压到约 30 KB） |
| 登录 token 有效期 | 30 天 |
| 一次登录的等待时间 | 10 分钟 |

---

## 四、本地调试

```bash
cp .dev.vars.example .dev.vars        # 填上 DISCORD_CLIENT_SECRET
npm run db:init:local
npm run dev                            # 默认 http://localhost:8787
```

- `wrangler.toml` 里的 `PUBLIC_URL` 临时改成 `http://localhost:8787`，并在 Discord 后台把 `http://localhost:8787/api/auth/callback` 也加进 Redirects。
- 调试时可以在酒馆页面的控制台执行 `localStorage.setItem('jingyi.workshop.api', 'http://localhost:8787')`，然后重开镜译面板。调试结束后用 `localStorage.removeItem('jingyi.workshop.api')` 还原。HTTP 只接受本机回环地址。

后端测试使用 Node 自带的 SQLite 模拟 D1，并模拟 Discord 和 Fish。

```bash
npm test
```

---

## 五、常见问题

- **Discord 页面提示 `Invalid OAuth2 redirect_uri`**：Redirects 里的地址和 `PUBLIC_URL/api/auth/callback` 有出入。逐字符对一遍。
- **授权页显示「登录失败」**：一般是 `DISCORD_CLIENT_SECRET` 填错了，重新 `wrangler secret put`；也可能是 `DISCORD_CLIENT_ID` 和 Secret 不是同一个应用的。用 `npx wrangler tail` 看实时日志。
- **插件里一直「等待 Discord 授权」**：授权页那边有没有显示「登录成功」？没有就是上一条；有的话检查手机和酒馆是不是能访问 Worker 的地址。等 10 分钟会自动超时，可以重试。
- **工坊页提示「还没有接上后端」**：`workshop.js` 里的 `WORKSHOP_API` 还是空的，或者浏览器缓存了旧文件（升版本号）。
- **`*.workers.dev` 在国内经常连不上**：如果你的用户主要在国内，给 Worker 绑一个你自己的域名（Cloudflare 后台 → Workers → 你的 Worker → Settings → Domains & Routes → Add → Custom Domain），把 `PUBLIC_URL`、Discord 的 Redirect、`WORKSHOP_API` 都换成这个域名。另外 Discord 本身也需要能访问。
- **改了 `wrangler.toml` 没生效**：要重新 `npx wrangler deploy`；密钥（secret）是单独存的，改了 `wrangler.toml` 不会丢。
- **想清空重来**：`npx wrangler d1 execute jingyi-voice-workshop --remote --command "DROP TABLE voices; DROP TABLE covers; DROP TABLE copies; DROP TABLE reports;"` 然后 `npm run db:init`。用户和登录记录不用动。
