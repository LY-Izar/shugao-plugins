# 树高教务通 · 教室端插件库

这个仓库里，**每个目录就是一个教室端插件**：

```text
plugins/
├─ shugao.quote/             ← 目录名必须等于 manifest 里的 id
└─ shugao.daily/             ← 每日作业、值日生与今日课表
   ├─ manifest.json          ← 说明书（字段见宿主仓库《教室端插件开发手册.md》§2.1）
   ├─ index.js               ← 单文件 ESM，export default { activate, deactivate }
   └─ index.js.sha256        ← 入口指纹，一行十六进制
```

`plugins/<id>/` 里放的**永远是当前版本**。历史版本不用另建目录 —— 每次发布会把
`commit` 与 `sha256` 一起钉进登记表，旧版本靠 git 历史随时取得到。

`shugao.daily` 1.1.0 使用宿主的 `class.todaySchedule` 资源，要求教室端插件壳至少
1.1.6。日期由宿主时钟提供，今日课表与主屏共用临时调课、调休选课和周一顺延的结果。

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
新增能力：data.schedule（要读本班课表）／无新增数据槽 key
自检：plugin-framework-checks --plugin plugins/<id> 全绿
```

**合并与发布由超管做。** 合并之后在平台 `/admin` 的「插件」分区发布，才会下发到教室端。

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

## 三条铁律

1. `id` **发布后终生不改**（它是数据库主键的一部分）；`version` **只增不减**。
2. 插件**不许自己联网**（没有 `fetch` / `WebSocket`），也不许碰宿主的 `localStorage`；
   要数据就走宿主资源（手册 §6.1）。
3. **不许写真实学生/教师信息**：姓名、学号、手机号、身份证号一个都不许进代码或注释。

---

## 规则与手册

- 插件怎么写、能力怎么申请、错误码怎么处理：宿主仓库的《教室端插件开发手册.md》
- 分支、权限、发布链、下载地址规则：《插件库与发布流程.md》
