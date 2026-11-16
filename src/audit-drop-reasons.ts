#!/usr/bin/env bun
/**
 * 拆「丟棄 501」的真實成因，特別查那筆「截短後退化 = 0」有沒有被漏計。
 *
 * 產生端的判定順序是（backlink.ts:525-528）：
 *     if (s.from < lastEnd) dropped++            ← 先算重疊
 *     if (s.to > 行寬) s.to = 行寬                ← 再截短
 *     if (s.to <= s.from) dropped++              ← 最後才算退化
 * 順序本身就會藏數：一個原生退化（to<=from）的段，只要它同時被前一段蓋住，
 * 就先落進「重疊」那欄，永遠不會出現在「退化」裡。所以「退化 0」有兩種可能：
 *   ① 真的沒有退化段；
 *   ② 有，但被前面那條 if 吃掉了。
 * 本腳本把每個被丟的段按其**自身**性質重新分類（不看判定順序），
 * 另附「截短是否真的發生」與「頁面集合對賬」兩項旁證。只讀。
 *
 * 用法：bun run src/audit-drop-reasons.ts [slug=dfb-v3]
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { openAdb } from "../../adb-converter/ts/tools/adb-skill/engine";

const ROOT = resolve(import.meta.dir, "..");
const slug = process.argv[2] ?? "dfb-v3";
const ADB = process.argv[3] ?? "D:/accelon3/dfb.adb";

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
function posOf(segs: Seg[], ri: number) {
  for (const s of segs) {
    const len = s.to - s.from;
    if (ri >= s.rawFrom && ri < s.rawFrom + len) return { line: s.line, col: s.from + (ri - s.rawFrom) };
  }
  return null;
}

const keep = new Set<number>(JSON.parse(readFileSync(resolve(ROOT, `out/gate-keep-${slug}.json`), "utf8")) as number[]);
const allMatches = JSON.parse(readFileSync(resolve(ROOT, `out/matches/${slug}-matches-all.json`), "utf8")) as
  { qIndex: number; anchor?: string; matched?: number }[];
const quotesArr = JSON.parse(readFileSync(resolve(ROOT, `out/matches/${slug}-quotes.json`), "utf8")) as
  { raw: string; segs?: Seg[] }[];
const baseLines = readFileSync(resolve(ROOT, "out/dfb-lines.txt"), "utf8").replace(/\r\n/g, "\n").split("\n");

type S = { line: number; from: number; to: number; page: string };
const spans: S[] = [];
for (const mt of allMatches) {
  if (!keep.has(mt.qIndex) || !mt.anchor) continue;
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
  const page = String(mt.anchor);
  if (a.line === b.line) spans.push({ line: a.line, from: a.col, to: b.col + 1, page });
  else {
    spans.push({ line: a.line, from: a.col, to: (baseLines[a.line] ?? "").length, page });
    for (let l = a.line + 1; l < b.line; l++) spans.push({ line: l, from: 0, to: (baseLines[l] ?? "").length, page });
    spans.push({ line: b.line, from: 0, to: b.col + 1, page });
  }
}
spans.sort((x, y) => x.line - y.line || x.from - y.from || y.to - x.to);
console.log(`保留集 ${keep.size} 筆 → 生成引文段 ${spans.length} 段`);

/* ① 按產生端順序計（應為 501，其中退化 0）＋ ② 按段自身性質重分類 */
const reason = { 真重疊: 0, 同起點被更長段壓掉: 0, 原生退化: 0, 截短後退化: 0, 保留: 0 };
let clampFired = 0;
const byLine = new Map<number, S[]>();
for (const s of spans) (byLine.get(s.line) ?? byLine.set(s.line, []).get(s.line)!).push(s);
for (const [li, list] of byLine) {
  const width = (baseLines[li] ?? "").length;
  let lastEnd = -1, lastFrom = -1;
  for (const s of list) {
    const degenerateItself = s.to <= s.from;
    if (s.to > width) clampFired++;
    const clamped = Math.min(s.to, width);
    if (s.from < lastEnd) {
      if (degenerateItself) reason.原生退化++;           // 產生端會先算成重疊，這裡還它本色
      else if (s.from === lastFrom) reason.同起點被更長段壓掉++;
      else reason.真重疊++;
      continue;
    }
    if (clamped <= s.from) { reason.截短後退化++; continue; }
    reason.保留++; lastEnd = clamped; lastFrom = s.from;
  }
}
const droppedAll = reason.真重疊 + reason.同起點被更長段壓掉 + reason.原生退化 + reason.截短後退化;
console.log(`\n按產生端順序：保留 ${reason.保留}、丟棄 ${droppedAll}（截短實際發生的段數 ${clampFired}）`);
console.log(`  真重疊 ${reason.真重疊}｜同一起點但較短 ${reason.同起點被更長段壓掉}｜原生退化（to<=from）${reason.原生退化}｜截短後退化 ${reason.截短後退化}`);
console.log(`  → 「退化 0」的含義：${reason.原生退化 + reason.截短後退化 === 0
  ? "確實不存在 to<=from 的段（連被重疊規則先吃掉的那種也沒有），不是漏計"
  : `有 ${reason.原生退化 + reason.截短後退化} 段本屬退化、被前一條 if 算進重疊，需回產生端改記帳口徑`}`);

/* 頁面集合對賬：庫內實際鏈到的頁，必須都來自保留集 */
const pagesFromSpans = new Set<string>();
for (const s of spans) pagesFromSpans.add(s.page);
const db = await openAdb(ADB);
const pagesInLib = new Set<string>();
let libOpens = 0;
const CHUNK = 8000;
for (let s0 = 0; s0 < db.lines; s0 += CHUNK) {
  const raws = await Promise.all(Array.from({ length: Math.min(CHUNK, db.lines - s0) }, (_, i) => db.raw(s0 + i))) as string[];
  for (const l of raws) {
    if (typeof l !== "string") continue;
    for (const m of l.matchAll(/<聯 i="taisho\?([^"#]+)/g)) { libOpens++; pagesInLib.add(m[1]); }
  }
}
await db.close?.();
const extra = [...pagesInLib].filter((p) => !pagesFromSpans.has(p));
const untouched = [...pagesFromSpans].filter((p) => !pagesInLib.has(p));
console.log(`\n頁面集合對賬：保留集涉及 ${pagesFromSpans.size} 頁、庫內鏈到 ${pagesInLib.size} 頁、庫內開標 ${libOpens} 次`);
console.log(`  庫內有而保留集沒有（不該發生）${extra.length}${extra.length ? `：${extra.slice(0, 5).join(" ")}` : ""}`);
console.log(`  保留集有而庫內完全沒鏈到（重疊把該頁所有段都吃掉的詞条）${untouched.length}${untouched.length ? `：${untouched.slice(0, 8).join(" ")}` : ""}`);
