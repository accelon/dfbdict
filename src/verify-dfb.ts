#!/usr/bin/env bun
/**
 * dfb 建库验收 v2：证明「建出来能用」，不是只证明「建出来了」。
 *
 * v1 有两处是验收脚本自己的错，已改：
 *   A 原先拿 search() 当 caches/詞 的代理 → 误报「[87A7]字香印 检不出」。
 *     实为全文索引不认方括号；正确测点是 reader.cachedStrings("詞")。
 *   D 原先把源正文与 adb 还原串直接比 → 我们故意把（雜語）转成 <例 t="雜語"/> 标签行、
 *     把 (參見：X) 转成 <聯>，剥标签后自然与源不等。两侧必须用同一套还原规则。
 *
 * 硬不变量（母区 scopes.ts:1471 usable = names.length === segs.length；
 * 不满足不报错，只会让词条查询与点链接静默退化成全文搜索）：
 *   A caches/詞 收录数 == <詞> 实例数 == 源条目数
 *   B <聯 n=...> 目标全部在 caches/詞 内（零死链）
 *   C 同形词头 a= 序号连续
 *   D 逐条回读：按同一规则还原后与源逐字相等（内容零丢失）
 *   E 引擎 search / toc 实际可用
 * 用法: bun run src/verify-dfb.ts [adb] [tsv]
 */
import { readFileSync } from "node:fs";
import { openAdb } from "../../adb-converter/ts/tools/adb-skill/engine";

const adbPath = process.argv[2] ?? "out/dfb.adb";
const tsvPath = process.argv[3] ?? "data/dfb.tsv";

const unesc = (s: string) => {
  let o = "";
  for (let k = 0; k < s.length; k++) {
    if (s[k] === "\\" && k + 1 < s.length) {
      const n = s[++k];
      o += n === "n" ? "\n" : n === "t" ? "\t" : n;
      continue;
    }
    o += s[k];
  }
  return o;
};

const src: { id: number; head: string; body: string }[] = [];
{
  const lines = readFileSync(tsvPath, "utf8").replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.startsWith("entryid")) lines.shift();
  for (const l of lines) {
    if (!l.trim()) continue;
    const c = l.split("\t");
    if (c.length < 3) continue;
    src.push({ id: Number(c[0]), head: unesc(c[1] ?? ""), body: unesc(c[2] ?? "") });
  }
}
// 建库端做了（一）diacritic→Unicode 转换，验收必须用同一张表同样规则还原源侧，
// 否则会比出数千处“不符”，那是规则不对称、不是内容错。
const TR = new Map<string, string>();
{
  const lines = readFileSync("data/translit-cbdia-map.tsv", "utf8").replace(/\r\n/g, "\n").split("\n").slice(1);
  for (const l of lines) {
    if (!l.trim()) continue;
    const c = l.split("\t");
    if (!c[0] || !c[1] || !c[2]) continue;
    const cp = parseInt(String(c[2]).replace(/^U\+/i, ""), 16);
    if (Number.isFinite(cp)) TR.set(`${c[0]}|${c[1]}`, String.fromCodePoint(c[1].codePointAt(0)!, cp).normalize("NFC"));
  }
}
const MARKCHARS = "%!^~/.:'_;:,;".split("");
function diac(s: string): string {
  const chars = [...s];
  let o = "";
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    const n = chars[i + 1];
    if (/[A-Za-z]/.test(c) && n && MARKCHARS.includes(n)) {
      const rep = TR.get(`${n}|${c}`);
      if (rep !== undefined) {
        o += rep;
        i++;
        continue;
      }
    }
    o += c;
  }
  return o;
}

const db = await openAdb(adbPath);

// 关键修正：一律从 .adb 本体回读，不读中间档 out/dfb-lines.txt。
// 中间档在 authorAdb 之前就写出，若建库失败/被占用，会出现“行档是新的、adb 是旧的”
// 而验收仍报全通过——本轮实测就踩到了。
// 关键修正二：db.text() 返回的是**已剥标签的纯文字**，拿它找 `<詞>` 会得到 0 行，
// 于是 B/C/D 全在量空集合却报“通过”。必须读原始行 db.raw(i)。
// 并且：任何一节样本数为零都视为失败——空集合上的“全部满足”没有意义。
const linesRaw: string[] = [];
{
  const step = 8000;
  for (let s = 0; s < db.lines; s += step) {
    const chunk = await Promise.all(
      Array.from({ length: Math.min(step, db.lines - s) }, (_, i) => db.raw(s + i))
    );
    linesRaw.push(...chunk);
  }
}
if (linesRaw.length !== db.lines) throw new Error(`回读行数 ${linesRaw.length} != ${db.lines}`);
const raw: string[] = linesRaw.map((x) => x ?? "");
console.log(`\n回读来源 = ${adbPath}（原始行 ${db.lines} 行，dbname=${db.dbname}）`);

const ciLines = raw.filter((l: string) => /^<詞 /.test(l));
if (ciLines.length === 0) throw new Error("adb 内找不到 <詞> 行——回读方式错了，拒绝继续（空集合上的‘通过’无意义）");
const ciParse = (l: string) => {
  // 通用属性抽取，不依赖顺序：建库端现在输出 id / t / a 三个属性，
  // 写死顺序的正则会把带 t 的行整批解析成 null，于是 A/C 变成在量空集合。
  const m = l.match(/^<詞 ([^>]*)>(.*)<\/詞>$/);
  if (!m) return null;
  const at = (k: string): string => {
    const r = new RegExp(`\\b${k}="([^"]*)"`).exec(m[1]);
    return r ? r[1] : "";
  };
  const id = Number(at("id"));
  if (!Number.isInteger(id)) return null;
  return { id, a: Number(at("a") || "1"), t: at("t"), head: m[2] };
};

const names: string[] = await db.reader.cachedStrings("詞");
const nameSet = new Set(names);

// ---- A ----
console.log(`\n[A] 源条目 ${src.length}｜<詞> 行 ${ciLines.length}｜caches/詞 收录 ${names.length}`);
const A = names.length === ciLines.length && ciLines.length === src.length;
console.log(`    三者相等 = ${A ? "通过" : "不通过"}`);
// 逐位对齐检查：caches 顺序应与 <詞> 出现顺序一致（usable 依赖此对齐）
let mis = 0;
ciLines.forEach((l, i) => {
  const p = ciParse(l);
  if (!p || names[i] !== diac(p.head)) mis++;
});
console.log(`    与 <詞> 逐位不对齐 ${mis} 处${mis ? "（usable 会失效！）" : ""}`);

// ---- B ----
// 只在短行里找标签，避免对 14 万行（含 1.9 万字长行）做无谓扫描
const tagLines = raw.filter((l: string) => l.length < 400 && /[<>]/.test(l));
const linkTargets = new Map<string, number>();
for (const l of tagLines) for (const m of l.matchAll(/<聯 n="([^"]*)">/g)) linkTargets.set(m[1], (linkTargets.get(m[1]) ?? 0) + 1);
const dead = [...linkTargets.keys()].filter((t) => !nameSet.has(t.replace(/＂/g, '"').replace(/＆/g, "&").replace(/＜/g, "<").replace(/＞/g, ">")));
console.log(`\n[B] <聯 n=> 目标 ${linkTargets.size} 种；不在 caches/詞 = ${dead.length}${dead.length ? `：${dead.slice(0, 8).join("、")}` : "（零死链）"}`);

// ---- C ----
const perHead = new Map<string, number[]>();
for (const l of ciLines) {
  const p = ciParse(l);
  if (p) (perHead.get(p.head) ?? perHead.set(p.head, []).get(p.head)!).push(p.a);
}
let badSeq = 0;
for (const [h, v] of perHead) {
  if (v.length < 2) continue;
  const sorted = v.slice().sort((a, b) => a - b);
  if (JSON.stringify(sorted) !== JSON.stringify(sorted.map((_, i) => i + 1))) {
    badSeq++;
    if (badSeq <= 3) console.log(`    序号异常：${h} → ${sorted.join(",")}`);
  }
}
console.log(`\n[C] 同形词头 ${[...perHead.values()].filter((v) => v.length > 1).length} 种；序号不连续 ${badSeq} 种`);

// ---- D：两侧同规则还原 ----
const deesc = (s: string) => s.replace(/＆/g, "&").replace(/＜/g, "<").replace(/＞/g, ">").replace(/＂/g, '"');
const stripTags = (s: string) => deesc(s.replace(/<聯 n="[^"]*">/g, "").replace(/<\/聯>/g, "").replace(/<[^>]+>/g, ""));
// 源侧还原必须与建库同条件：只有“目标确在词头表”的引用才被转成 <聯>（剥标后剩 X），
// 死链在建库里保留 (參見：X) 原文，所以源侧也不能剥。v1 一律剥 → 假报 401 处不符。
const headSetForCanon = new Set(src.map((r) => r.head));
const canonSrc0 = (body: string) =>
  body
    .replace(/^　?（[^）\n]{1,6}）/, "")
    .replace(/\(參見：([^)]{1,40})\)/g, (whole, t) => {
      const target = t.trim();
      return headSetForCanon.has(target) ? target : whole;
    })
    .replace(/[\s　]+/g, "");
// 源侧先套同一张 diacritic 表，再走其余归一（与建库顺序一致）
const canonSrc = (body: string) => canonSrc0(diac(body));
const canonAdb = (text: string) => stripTags(text).replace(/[\s　]+/g, "");

type Entry = { id: number; text: string };
const entries: Entry[] = [];
let cur: Entry | null = null;
for (const l of raw) {
  const p = ciParse(l);
  if (p) {
    if (cur) entries.push(cur);
    cur = { id: p.id, text: "" };
    continue;
  }
  if (!cur) continue;
  if (/^<例 /.test(l) || l === "") continue;
  cur.text += l;
}
if (cur) entries.push(cur);


const srcById = new Map(src.map((r) => [r.id, r]));
let mismatch = 0;
const bad: string[] = [];
for (const e of entries) {
  const s = srcById.get(e.id);
  if (!s) {
    mismatch++;
    bad.push(`adb 有 id=${e.id} 但源无`);
    continue;
  }
  const a = canonSrc(s.body);
  const b = canonAdb(e.text);
  if (a !== b) {
    mismatch++;
    if (bad.length < 8) {
      let p = 0;
      while (p < a.length && p < b.length && a[p] === b[p]) p++;
      bad.push(`id=${e.id} 首个差异@${p}：源「${a.slice(p, p + 30)}」vs adb「${b.slice(p, p + 30)}」`);
    }
  }
}
console.log(`\n[D] 逐条回读 ${entries.length} 条（两侧同规则）；内容不符 ${mismatch}`);
for (const x of bad.slice(0, 8)) console.log(`    ${x}`);

// 词头逐条相等（含方括号那条）
let headBad = 0;
for (const r of src) {
  const idx = entries.findIndex((e) => e.id === r.id);
  const p = ciParse(ciLines[idx]);
  if (!p || p.head !== r.head) headBad++;
}
console.log(`    词头逐条与源相等：不符 ${headBad}`);

// ---- E ----
console.log("\n[E] 引擎检索：");
for (const q of ["般若", "阿耨多羅三藐三菩提", "種子", "一即一切"]) {
  const t0 = Date.now();
  const s = await db.search(q, 5);
  console.log(`    「${q}」total=${s.total} 前5=${s.hits.map((h: any) => h.line ?? "?").join(",")} ${Date.now() - t0}ms`);
}
const bracket = "[87A7]字香印";
console.log(`    方括号词头「${bracket}」在 caches/詞 = ${nameSet.has(bracket)}（v1 用 search 误判为缺）`);
const toc = await db.toc();
console.log(`    toc ${toc.length} 行，首行 ${JSON.stringify(toc[0])}`);

// ---- F ---- 版面体例（作者 2026-11-15：詞條必須在行首；義項序號前才允許 <段/>）
const SEG = "<段/>"; // 4 个码位：先前按 5 算，把检查自己的尺子先弄错了
let headOffLine = 0;   // 詞條行前面还有别的内容
let segAtStart = 0;    // <段/> 落在行首（等于凭空多一个空段）
let segInTag = 0;      // <段/> 被吞进别的标记本体（例如 <聯 n="…<段/>…">），标记被截断
let segBadPos = 0;     // <段/> 后面不是義項序號
let segUnbalanced = 0; // 一行里 < 与 > 数量不等（插进了半个标记）
let segTotal = 0;
let segInLink = 0;     // <段/> 落在 <聯 i=…>…</聯> 的正文里（一条链的显示文字被断开）
for (const l of raw) {
  if (l.includes(SEG)) {
    segTotal += (l.match(/<段\/>/g) ?? []).length;
    if (l.startsWith(SEG)) segAtStart++;
    // 词头/引用文字里的 `<` 早被 esc() 转成 &lt;，所以行内每个裸 `<` 都该是标记开头；
    // 标记本体里再出现 `<段` 就是被截断。
    if ((l.match(/</g) ?? []).length !== (l.match(/>/g) ?? []).length) segUnbalanced++;
    const tags = l.match(/<[^>]*>/g) ?? [];
    if (tags.some((t) => t !== SEG && t.includes("<段"))) segInTag++;
    for (const m of l.matchAll(new RegExp(SEG.replace("/", "\\/"), "g"))) {
      // 后面先跨过去的任何标记（`<聯 i=…>` 常常正好在这里开链），再看是否義項序號
      let rest = l.slice((m.index ?? 0) + SEG.length);
      while (/^\s*<[^>]*>/.test(rest)) rest = rest.replace(/^\s*<[^>]*>/, "");
      rest = rest.replace(/^[\s　]+/, "");
      if (!/^（[一二三四五六七八九十]{1,3}）/.test(rest)) segBadPos++;
    }
    // <段/> 不该落在 <聯 i=…>…</聯> 的正文里：那会让一条链的显示文字中间断开
    let depth = 0;
    for (const t of l.match(/<[^>]*>/g) ?? []) {
      if (t === SEG) { if (depth > 0) segInLink++; }
      else if (/^<聯 i=/.test(t) && !/\/>$/.test(t)) depth++;
      else if (t === "</聯>") depth = Math.max(0, depth - 1);
    }
  }
  if (l.includes("<詞 ")) {
    const p = ciParse(l);
    if (!/^<詞 /.test(l) || !p) headOffLine++;
  }
}
console.log(`\n[F] 版面体例：<段/> ${segTotal} 处`);
console.log(`    詞條行不在行首 ${headOffLine}；<段/> 在行首 ${segAtStart}；嵌在标记内 ${segInTag}；后面不是義項序號 ${segBadPos}；<> 不成对行 ${segUnbalanced}；落在跨库链正文内 ${segInLink}`);
const segTagOk = db.tags.includes("段");
console.log(`    引擎 tags 容器收錄「段」：${segTagOk}（tags 共 ${db.tags.length} 種）`);

const verdict = [
  A && mis === 0 ? "A 通过" : "A 不通过",
  dead.length === 0 ? "B 通过" : "B 不通过",
  badSeq === 0 ? "C 通过" : "C 不通过",
  mismatch === 0 && headBad === 0 ? "D 通过" : "D 不通过",
  headOffLine === 0 && segAtStart === 0 && segInTag === 0 && segBadPos === 0 && segUnbalanced === 0 && segInLink === 0 ? "F 通过" : "F 不通过",
].join("｜");
console.log(`\n判定：${verdict}`);
