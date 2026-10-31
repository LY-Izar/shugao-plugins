# 树高教务通 · 教室端插件库

这个仓库里，**每个目录就是一个教室端插件**：

```text
plugins/
├─ shugao.daily/             ← 目录名必须等于 manifest 里的 id
├─ shugao.quote/
├─ ruofeng.class-attendance/ ← 第三方插件（另一个开发者写的）
└─ <你的插件 id>/            ← 目录里三个文件，缺一不可
   ├─ manifest.json          ← 说明书（字段见宿主仓库《教室端插件开发手册.md》§2.1）
   ├─ index.js               ← 单文件 ESM，export default { activate, deactivate }
   └─ index.js.sha256        ← 入口指纹，一行十六进制
```

`plugins/<id>/` 里放的**永远是当前版本**。历史版本不用另建目录 —— 每次发布会把
`commit` 与 `sha256` 一起钉进登记表，旧版本靠 git 历史随时取得到。

## 插件目录

| 示例 | 看它学什么 |
|---|---|
| `shugao.quote` | **最小可用**：一个资源（`class.quote`）+ 一个时钟事件，几十行就能看完 |
| `shugao.daily` | **多资源凑一屏**：`data.dailyHomework` + `data.duty` + `data.schedule` 三个能力一起用，带窗口尺寸与空态 |
| `shugao.duty` | 值日生展示 |
| `shugao.exams` | 考试展示 |
| `shugao.review` | 作业讲评 |
| `shugao.schedule` | 班级课表 |
| `ruofeng.class-attendance` | **第三方插件的完整样子**：多能力（`data.roster` / `bus` / `clock` / `sound` / `files`）、有窗口尺寸、有降级分支 |

正式环境的插件统一从本 Git 仓库按已审核的提交读取。教室端程序只提供插件宿主；插件新增或更新经管理员发布后直接加载，无须重发安装包。插件使用宿主尚未提供的新能力时，仍需先升级宿主。

---

## 开发者怎么提交

```bash
git clone https://github.com/LY-Izar/shugao-plugins.git
cd shugao-plugins
git checkout -b plugin/<你的插件 id>

mkdir -p plugins/<你的插件 id>
# 把 manifest.json 与 index.js 放进去，然后生成指纹：
cd plugins/<你的插件 id>
sha256sum index.js > index.js.sha256
# Windows PowerShell 用这一行（certutil 的输出带空格与标题行，直接用会 CI 红）：
# (Get-FileHash index.js -Algorithm SHA256).Hash.ToLower() | Set-Content index.js.sha256 -Encoding ascii
cd ../..

git add plugins/<你的插件 id>
git commit -m "<插件 id> 1.0.0：一句话说清这个插件做什么"
git push -u origin plugin/<你的插件 id>
```

然后开 Pull Request 到 `main`，正文写清四样：

```text
改了什么：
version：1.0.0（首个版本，或 1.0.0 → 1.1.0）
新增能力和读表申请：例如 read，reads 中声明 students 与用途
教师端结果：如需展示，在 teacherResults 中列出 storage 槽名与展示名称；否则写无
自检：plugin-framework-checks --plugin plugins/<id> 全绿
```

**审核与发布由超管做。** 管理端 `/admin` 从 `plugin/<id>` 分支读取提交、检查插件代码与数据权限，检查通过后发布该提交。合并 PR 时保留该提交的 Git 历史；发布完成前保留待审分支。仅提交或合并 PR 不会使插件自动上线。

插件在 `manifest.json` 声明 `permissions`、`reads` 和可选的 `teacherResults`。例如申请只读本班学生名单，并向教师端展示插件算出的汇总：

```json
{
  "permissions": ["read", "storage"],
  "reads": [{ "table": "students", "why": "读取本班学生名单并计算汇总" }],
  "teacherResults": [{ "key": "summary", "label": "班级汇总" }]
}
```

插件用 `ctx.data.readTable('students')` 获取当前数据，用 `ctx.data.watchTable('students', callback)` 接收更新通知后重新读取；只有管理员批准的表会进入运行时权限。插件用 `ctx.storage.set('summary', value)` 保存结果，教师端只读取已审核的 `teacherResults` 槽。通知由实时通道传递，断线重连时重新读取，另有低频兜底检查。

---

## CI 会检查什么

`.github/check.mjs`（PR 与 main 推送都跑）：

1. `manifest.json` 能解析、`id` 合命名空间且与目录名一致；
2. `permissions` 全在枚举内（旧名 `tts` / `floating` / `capabilities` 都判失败）；
3. 入口存在、`export default {...}`、没有 `fetch` / `WebSocket` / `XMLHttpRequest` / `window.__shell_out` / `localStorage`；
4. `index.js.sha256` 与实际文件一致；
5. `version` 比 `main` 上的同 `id` 版本**更大**（只增不减）。

> 这五条只查"明显违规"。运行期行为（生命周期、配额、崩溃熔断）由开发者在自己机器上跑
> 宿主仓库的 `npm run plugin-framework-checks -- --plugin <目录>`，合并前请把结果贴进 PR。

---

## 四条铁律

1. `id` **发布后终生不改**（它是数据库主键的一部分）；`version` **只增不减**。
2. 插件**不许自己联网**（没有 `fetch` / `WebSocket`），也不许碰宿主的 `localStorage`；
   要数据就走宿主资源（手册 §6.1）。
3. **不许写真实学生/教师信息**：姓名、学号、手机号、身份证号一个都不许进代码或注释。
4. 正式插件只从本 Git 仓库加载已发布的提交。改动插件代码后必须提升版本号、更新指纹并重新经过管理员审核；不能直接替换已发布提交。

---

## 规则与手册

- 插件怎么写、能力怎么申请、错误码怎么处理：宿主仓库的《教室端插件开发手册.md》
- 分支、权限、发布链、下载地址规则：《插件库与发布流程.md》
