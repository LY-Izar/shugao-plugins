/**
 * 插件库 CI —— 只查"明显违规"，语义正确性靠超管审 + 开发者在宿主仓库跑契约自检。
 *
 * 🔴 这里是**第二道**闸，不是唯一那道：
 *   · 第一道是开发者在宿主仓库跑的 `plugin-framework-checks`（14 条，含运行期）；
 *   · 第三道是平台 `/admin` 发布时**当场重算指纹**（那一处才是真正进数据库前的判据）。
 *   三处判据必须同源：能力枚举改了要同时改这里、宿主 `pluginHost.ts` 与手册 §5。
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execSync } from 'node:child_process'
import { join } from 'node:path'

const ID_RE = /^[a-z][a-z0-9-]{2,31}\.[a-z][a-z0-9-]{2,31}$/
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/
/** 与手册 §5 同一份枚举（旧名 tts / floating / 粗粒度 data 都不认） */
const PERMS = new Set([
  'storage',
  'data.roster',
  'data.schedule',
  'data.dailyHomework',
  'data.duty',
  'data.assignments',
  'data.quote',
  'config',
  'clock',
  'bus',
  'sound',
  'pip',
  'files',
  'keepAwake',
])
/** 手册 §11 禁区里能静态判的那几条 */
const BANNED = [
  [/window\.__shell_out/, '碰了壳桥 __shell_out'],
  [/\bfetch\s*\(/, '自己联网 fetch('],
  [/\bXMLHttpRequest\b/, '自己联网 XMLHttpRequest'],
  [/\bWebSocket\b/, '自己联网 WebSocket'],
  [/\blocalStorage\b/, '碰了宿主 localStorage'],
]

const fails = []
const ok = (m) => console.log(`[ok] ${m}`)
const bad = (m) => {
  fails.push(m)
  console.log(`[FAIL] ${m}`)
}

const prevVersion = (id) => {
  try {
    const raw = execSync(`git show origin/main:plugins/${id}/manifest.json`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    })
    return JSON.parse(raw).version ?? null
  } catch {
    return null
  }
}

const cmp = (a, b) => {
  const pa = SEMVER.exec(a)
  const pb = SEMVER.exec(b)
  if (!pa || !pb) return 0
  for (let i = 1; i <= 3; i++) {
    const d = Number(pa[i]) - Number(pb[i])
    if (d !== 0) return d
  }
  return 0
}

/**
 * 🔴 扫禁区代码前**必须先剥注释**：插件里写着「不碰 window.__shell_out」这种说明文字
 *    也会被正则命中 —— 首跑就发生过（`shugao.quote` 的注释），一条永远为红的判据
 *    比没有判据更糟：开发者会学会"忽略这条红"。
 */
const stripComments = (s) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n')

const base = 'plugins'
const dirs = existsSync(base)
  ? readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory())
  : []
if (dirs.length === 0) ok('还没有插件目录，跳过（首个插件提交后这里就会开始检查）')

for (const d of dirs) {
  const id = d.name
  const dir = join(base, id)
  const mf = join(dir, 'manifest.json')
  if (!existsSync(mf)) {
    bad(`${id}: 缺 manifest.json`)
    continue
  }
  let m
  try {
    m = JSON.parse(readFileSync(mf, 'utf8'))
  } catch {
    bad(`${id}: manifest.json 不是合法 JSON`)
    continue
  }

  if (!ID_RE.test(m.id ?? '')) bad(`${id}: id 不合命名空间（vendor.name，小写，各段 ≥3 字符）：${String(m.id)}`)
  if (m.id !== id) bad(`${id}: id 与目录名不一致（目录 ${id} ≠ id ${String(m.id)}）`)
  if (m.capabilities) bad(`${id}: 字段名是 permissions，不是 capabilities`)
  if (!Array.isArray(m.permissions) || m.permissions.length === 0) bad(`${id}: permissions 缺失或为空`)
  else for (const p of m.permissions) if (!PERMS.has(p)) bad(`${id}: 不认识的能力 ${p}`)
  if (!SEMVER.test(m.version ?? '')) bad(`${id}: version 必须是 主.次.修，实际 ${String(m.version)}`)
  if (!Array.isArray([m.name]) || typeof m.name !== 'string' || !m.name.trim()) bad(`${id}: 缺 name`)
  if (typeof m.description !== 'string' || !m.description.trim()) bad(`${id}: 缺 description`)
  if (typeof m.icon !== 'string' || !m.icon.trim()) bad(`${id}: 缺 icon`)

  const entry = join(dir, m.entry ?? 'index.js')
  if (!existsSync(entry)) {
    bad(`${id}: 入口文件不存在（${m.entry ?? 'index.js'}）`)
    continue
  }
  const src = stripComments(readFileSync(entry, 'utf8'))
  for (const [re, why] of BANNED) if (re.test(src)) bad(`${id}: 入口里${why}`)
  if (!/export\s+default\s*\{/.test(src)) bad(`${id}: 入口必须 export default { ... }`)

  const shaFile = join(dir, 'index.js.sha256')
  if (!existsSync(shaFile)) bad(`${id}: 缺 index.js.sha256`)
  else {
    const want = readFileSync(shaFile, 'utf8').trim().split(/\s+/)[0]
    const got = createHash('sha256').update(readFileSync(entry)).digest('hex')
    if (want !== got) bad(`${id}: 指纹对不上（文件里 ${want}，实际 ${got}）— 改完 index.js 要重新生成`)
  }

  const prev = prevVersion(id)
  if (prev && cmp(m.version, prev) <= 0) bad(`${id}: version 必须比 main 上的 ${prev} 更大`)
  else ok(`${id}@${m.version}`)

  /* 个人信息样式的串：只查最明显的三类，宁可漏也别误伤（中文姓名没法可靠判） */
  const pii = [
    [/1[3-9]\d{9}/, '疑似手机号'],
    [/\d{17}[\dXx]/, '疑似身份证号'],
    [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, '疑似邮箱'],
  ]
  for (const f of ['manifest.json', m.entry ?? 'index.js']) {
    const text = readFileSync(join(dir, f), 'utf8')
    for (const [re, why] of pii) if (re.test(text)) bad(`${id}: ${f} 里有${why}`)
  }
}

if (fails.length) {
  console.error(`\n${fails.length} 条不通过`)
  process.exit(1)
}
console.log('\n全部通过')
