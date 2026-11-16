#!/usr/bin/env bun
/**
 * 閘門資料穩定性對賬：把「部署那顆 adb 裡實際有幾個錨點」與
 * 上游三個憑證（backlink 打包驗收、gate-keep 保留集、verdicts 逐行判定）擺在一起比。
 * 只靠日誌報數是不够的——日誌說 10,577，庫裡可能因為重疊去重／跨行包裹而是另一個數。
 * 用法：bun run src/audit-anchor-counts.ts [adb] [slug]
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { openAdb } from "../../adb-converter/ts/tools/adb-skill/engine";

const ROOT = resolve(import.meta.dir, "..");
const adb = process.argv[2] ?? "D:/accelon3/dfb.adb";
const slug = process.argv[3] ?? "dfb-v3";

const db = await openAdb(adb);
let iOpen = 0, nOpen = 0, nClose = 0, seg = 0, li = 0, readLines = 0;
const withIJ: string[] = [];
// db.raw 回 Promise<string>：不 await 就拿到 Promise，typeof 檢查會把所有行跳過，
// 結果四個計數全 0——「全都對不上」看起來像資料問題，其實是探針自己寫錯。
const CHUNK = 8000;
for (let s = 0; s < db.lines; s += CHUNK) {
  const raws = await Promise.all(
    Array.from({ length: Math.min(CHUNK, db.lines - s) }, (_, i) => db.raw(s + i)),
  ) as string[];
  for (let j = 0; j < raws.length; j++) {
    const l = raws[j];
    if (typeof l !== "string") continue;
    readLines++;
    const ci = (l.match(/<聯 i="/g) ?? []).length;
    iOpen += ci;
    nOpen += (l.match(/<聯 n="/g) ?? []).length;
    nClose += (l.match(/<\/聯>/g) ?? []).length;
    seg += (l.match(/<段\/>/g) ?? []).length;
    li += (l.match(/ j="/g) ?? []).length;
    if (ci && withIJ.length < 2) withIJ.push(`行 ${s + j + 1}：${l.slice(0, 110)}`);
  }
}
await db.close?.();

const keep = JSON.parse(readFileSync(resolve(ROOT, `out/gate-keep-${slug}.json`), "utf8")) as number[];
const verdicts = readFileSync(resolve(ROOT, `out/title-verdicts-${slug}.tsv`), "utf8").split("\n").slice(1).filter(Boolean);
const inKeep = verdicts.filter((r) => { const c = r.split("\t"); return c[6] !== "不符" && Number(c[4]) <= 100; }).length;
const logTxt = (() => {
  try { return readFileSync(resolve(ROOT, "out/backlink-v3-gated4.log"), "utf8"); } catch { return ""; }
})();
const logTail = ((/驗收：聯\.i (\d+)、聯\.q (\d+)/.exec(logTxt) ?? []).slice(1).join("/")) || "?";
const logDropped = Number((/重疊 (\d+)/.exec(logTxt) ?? [])[1] ?? -1);

console.log(`部署檔 ${adb}`);
console.log(`  实读行数 ${readLines}／${db.lines}（对不上说明探针取行失败，下面的数一律不可信）`);
console.log(`  庫內實數：<聯 i= ${iOpen}、帶 j= ${li}、<聯 n= ${nOpen}、<段/> ${seg}、</聯> 閉合 ${nClose}（應 ${iOpen + nOpen}）`);
console.log(`  backlink 打包驗收 聯.i = ${logTail}`);
console.log(`  gate-keep 保留集 = ${keep.length} 條；verdicts 自行復算同條件 = ${inKeep} 條（差 ${keep.length - inKeep}）`);
/* 保留集 11,077 → 庫內 10,577，差 500：**不是簡單減法**。產生端自報
 * 「套用 11,077 筆（略過 0、重疊 501）」——重疊引文段共用同一錨點，一個錨點也可吃掉多筆，
 * 兩個口徑本就不 1:1。真正要咬合的是三條等式：庫內實數 = 打包驗收、
 * gate-keep = 由 verdicts 獨立復算、實讀行數 = 庫總行數。 */
console.log(`  保留 ${keep.length} → 實際錨點 ${iOpen}：差 ${keep.length - iOpen}（產生端報「重疊 501」，共用錨點所致，非 1:1 減法）`);
/* ---------------- 重疊臺賬：11,077 → 10,577 到底怎麼少的 ----------------
 * 上面那條「庫內 = 打包驗收」是同一個口徑測兩次，不算獨立核對。真正的賬要這樣平：
 *   保留集（= 產生端 wrapped 筆）→ 展開成「引文段」：一條引文跨幾行就出幾段
 *   → 同行內起點落在前一段結束之前的，算重疊丟掉 → 剩下纔是庫裡的 <聯 i=。
 * 這段照 backlink.ts:497-532 的算法重算一遍（hanRawIndex / PUNCT 外扩 / posOf 三段），
 * 目的只有一個：證明 500 的差是「重疊 501 − 跨行多出 1 段」，不是悄悄少了鏈。 */
const PUNCT = "，。、；：！？…—‧・";
const isHanCh = (c: string) => /[㐀-䶿一-鿿豈-﫿]/.test(c);
function hanRawIndex(raw: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < raw.length;) {
    if (raw[i] === "<") { const gt = raw.indexOf(">", i); if (gt < 0) break; i = gt + 1; continue; }
    const cp = raw.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    if (isHanCh(ch)) out.push(i);
    i += ch.length;
  }
  return out;
}
type Seg = { line: number; from: number; to: number; rawFrom: number };
function lineOf(segs: Seg[], ri: number): number | null {
  for (const s of segs) {
    const len = s.to - s.from;
    if (ri >= s.rawFrom && ri < s.rawFrom + len) return s.line;
  }
  return null;
}
const allMatches = JSON.parse(readFileSync(resolve(ROOT, `out/matches/${slug}-matches-all.json`), "utf8")) as
  { qIndex: number; anchor?: string; matched?: number }[];
const quotesArr = JSON.parse(readFileSync(resolve(ROOT, `out/matches/${slug}-quotes.json`), "utf8")) as
  { line: number; raw: string; segs?: Seg[] }[];
const keepSet = new Set(keep);
let wrapped = 0, spanTotal = 0, crossLine = 0, noSegs = 0, noAnchor = 0;
for (const mt of allMatches) {
  if (!keepSet.has(mt.qIndex)) continue;
  if (!mt.anchor) { noAnchor++; continue; }
  const q = quotesArr[mt.qIndex];
  if (!q?.segs?.length) { noSegs++; continue; }
  const idx = hanRawIndex(q.raw);
  const m = Math.min(mt.matched ?? 0, idx.length);
  if (m < 1) continue;
  const startRaw = idx[0];
  let endRaw = idx[m - 1] + 1;
  while (endRaw < q.raw.length && PUNCT.includes(q.raw[endRaw])) endRaw++;
  const al = lineOf(q.segs, startRaw), bl = lineOf(q.segs, endRaw - 1);
  if (al === null || bl === null) continue;
  wrapped++;
  spanTotal += bl - al + 1;
  if (bl > al) crossLine++;
}
/* 上一版只數「行數」，得 11,077 段、推應丟 500，與產生端報的 501 差 1。
 * 差 1 不能靠「大約是四捨五入」收帳——產生端的 dropped 其實計兩種：
 *   ① 起點落在前一段結束之前（真·重疊）
 *   ② 依行寬截短後 to<=from（退化段，多半是引文頂到行尾）
 * 這裡把它逐段重算、分開計數，湊不出 501 就不签收。 */
type SpanT = { line: number; from: number; to: number };
function posOf(segs: Seg[], ri: number): { line: number; col: number } | null {
  for (const s of segs) {
    const len = s.to - s.from;
    if (ri >= s.rawFrom && ri < s.rawFrom + len) return { line: s.line, col: s.from + (ri - s.rawFrom) };
  }
  return null;
}
const baseLines = readFileSync(resolve(ROOT, "out/dfb-lines.txt"), "utf8").replace(/\r\n/g, "\n").split("\n");
const spansAll: SpanT[] = [];
let wrapped2 = 0;
for (const mt of allMatches) {
  if (!keepSet.has(mt.qIndex) || !mt.anchor) continue;
  const q = quotesArr[mt.qIndex];
  if (!q?.segs?.length) continue;
  const idx = hanRawIndex(q.raw);
  const m = Math.min(mt.matched ?? 0, idx.length);
  if (m < 1) continue;
  const startRaw = idx[0];
  let endRaw = idx[m - 1] + 1;
  while (endRaw < q.raw.length && PUNCT.includes(q.raw[endRaw])) endRaw++;
  const a = posOf(q.segs, startRaw), b = posOf(q.segs, endRaw - 1);
  if (!a || !b) continue;
  wrapped2++;
  if (a.line === b.line) spansAll.push({ line: a.line, from: a.col, to: b.col + 1 });
  else {
    spansAll.push({ line: a.line, from: a.col, to: (baseLines[a.line] ?? "").length });
    for (let l = a.line + 1; l < b.line; l++) spansAll.push({ line: l, from: 0, to: (baseLines[l] ?? "").length });
    spansAll.push({ line: b.line, from: 0, to: b.col + 1 });
  }
}
spansAll.sort((x, y) => x.line - y.line || x.from - y.from || y.to - x.to);
let dropOverlap = 0, dropDegenerate = 0, kept = 0;
{
  let lastEnd = -1, prevLine = -1;
  for (const s of spansAll) {
    if (s.line !== prevLine) { lastEnd = -1; prevLine = s.line; }
    if (s.from < lastEnd) { dropOverlap++; continue; }
    const to = Math.min(s.to, (baseLines[s.line] ?? "").length);
    if (to <= s.from) { dropDegenerate++; continue; }
    kept++; lastEnd = to;
  }
}
const impliedDrop = spanTotal - iOpen;
console.log(`\n  重疊臺賬：保留 ${keep.length}（無錨點 ${noAnchor}、缺 segs ${noSegs}）→ 有效套用 ${wrapped} 筆`);
console.log(`    展開成引文段 ${spanTotal} 段（其中跨行引文 ${crossLine} 條，多出 ${spanTotal - wrapped} 段）`);
console.log(`    減去庫內實測 ${iOpen} 個 <聯 i= → 應丟重疊 ${impliedDrop}；產生端日誌報 ${logDropped}`);
console.log(`  逐段重算：套 ${wrapped2} 筆 → 生成 ${spansAll.length} 段 → 留 ${kept} 段`);
console.log(`    丟棄 ①真重疊 ${dropOverlap} ＋ ②截短後退化 ${dropDegenerate} ＝ ${dropOverlap + dropDegenerate}（日誌報 ${logDropped}）`);
/* 「同標籤重複」不能當重發證據：同一行兩段引文命中同一頁同一區間時，標籤字串本來就一樣。
 * 要準就只能照 `wrapLine` 的發射邏輯重跑一遍——逐字元走，遇到行內既有標記先收 `</聯>`、
 * 越過去之後若仍在段內就再發一次開標。發射次數加總應剛好等於庫內的 <聯 i= 數。 */
type KSpan = { line: number; from: number; to: number };
const byLine2 = new Map<number, KSpan[]>();
{
  let lastEnd = -1, prevLine = -1;
  for (const s of spansAll) {
    if (s.line !== prevLine) { lastEnd = -1; prevLine = s.line; }
    if (s.from < lastEnd) continue;
    const to = Math.min(s.to, (baseLines[s.line] ?? "").length);
    if (to <= s.from) continue;
    const arr = byLine2.get(s.line) ?? [];
    arr.push({ line: s.line, from: s.from, to });
    byLine2.set(s.line, arr);
    lastEnd = to;
  }
}
let emissions = 0;
for (const [li2, list] of byLine2) {
  const line = baseLines[li2] ?? "";
  let i = 0, si = 0, open = false;
  while (i < line.length) {
    if (line[i] === "<") {
      const gt = line.indexOf(">", i);
      if (gt < 0) break;
      if (open) { open = false; }
      i = gt + 1;
      while (si < list.length && list[si].to <= i) si++;
      if (si < list.length && list[si].from <= i && i < list[si].to) {
        emissions++;
        open = true;
      }
      continue;
    }
    while (si < list.length && list[si].to <= i) { open = false; si++; }
    if (!open && si < list.length && list[si].from <= i && i < list[si].to) { emissions++; open = true; }
    i++;
  }
}
console.log(`    照 wrapLine 重跑：留段 ${kept} 段 → 實際發射開標 ${emissions} 次（比留段多 ${emissions - kept} 次，即被行內既有標記切開後再發的那幾段）`);
console.log(`    ${dropOverlap + dropDegenerate === logDropped && emissions === iOpen
  ? `結帳：丟棄 ${dropOverlap}（＋退化 ${dropDegenerate}）與產生端日誌 ${logDropped} 一致；發射 ${emissions} 次與庫內 <聯 i= ${iOpen} 一字不差 → 11,077 減 10,577 的 500 差確為預期重疊，沒有掉鏈`
  : `結帳：仍有出入（發射 ${emissions} vs 庫內 ${iOpen}；丟 ${dropOverlap + dropDegenerate} vs 日誌 ${logDropped}），須先解释再签收`}`);

for (const s of withIJ) console.log("  例：" + s);
const ok = readLines === db.lines && iOpen > 0 && logTail.split("/")[0] === String(iOpen)
  && keep.length === inKeep && emissions === iOpen && dropOverlap + dropDegenerate === logDropped
  && nClose === iOpen + nOpen;
console.log(ok
  ? "\n对账：一致（读行数、库内锚点数、打包验收、保留集复算、逐段重算＋跨标记重发、开闭配对，六项互相咬合）。"
  : "\n对账：有出入，须先解释再签收。");
