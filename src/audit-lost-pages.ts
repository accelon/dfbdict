#!/usr/bin/env bun
/**
 * 追「保留集有、庫內卻完全沒鏈到」的那些頁：逐頁找出它在庫裡那一行被誰吃掉，
 * 並把清單導成 TSV＋CSV（Excel 用，UTF-8 BOM＋CRLF）。只讀不改檔。
 *
 * 欄位著重在「first-wins 有沒有殺掉更好的那一條」：把被吃頁與勝出頁的
 * **經名核對判定**並排列出，只要勝出方判定比被吃方差（例如被吃方「一致」、
 * 勝出方「不符」），那條就是被排序政策誤殺的候選——要改母區 backlink 的取勝
 * 規則（改成經名相符優先）時，這份清單是唯一依據。
 * 用法：bun run src/audit-lost-pages.ts [頁1 頁2 ...]（不給參數就全量導出＋抽印前幾頁）
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
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

const keep = new Set<number>(JSON.parse(readFileSync(resolve(ROOT, "out/gate-keep-dfb-v3.json"), "utf8")) as number[]);
const allMatches = JSON.parse(readFileSync(resolve(ROOT, "out/matches/dfb-v3-matches-all.json"), "utf8")) as
  { qIndex: number; line: number; anchor?: string; matched?: number; book?: string }[];
const quotesArr = JSON.parse(readFileSync(resolve(ROOT, "out/matches/dfb-v3-quotes.json"), "utf8")) as
  { raw: string; segs?: Seg[] }[];
const baseLines = readFileSync(resolve(ROOT, "out/dfb-lines.txt"), "utf8").replace(/\r\n/g, "\n").split("\n");

/* qIndex → 該條引文的經名核對結論（判定＋解析方式） */
type Vd = { want: string; book: string; verdict: string; how: string };
const verdictOf = new Map<number, Vd>();
for (const l of readFileSync(resolve(ROOT, "out/title-verdicts-dfb-v3.tsv"), "utf8").replace(/\r\n/g, "\n").trim().split("\n").slice(1)) {
  const c = l.split("\t");
  if (c.length < 8) continue;
  verdictOf.set(Number(c[0]), { want: c[2], book: c[3], verdict: c[6], how: c[7] });
}
const bookOf = new Map<number, string>(allMatches.map((m) => [m.qIndex, m.book ?? ""]));

/* 行號 → 詞條（導出要讓人跳得回詞条，不能只給裸行號） */
const entryOf: string[] = [];
{
  let label = "";
  for (const l of baseLines) {
    const m = /^<詞 id="(\d+)"[^>]*>(.*)<\/詞>$/.exec(l);
    if (m) label = `${m[1]} ${m[2]}`;
    entryOf.push(label);
  }
}

type S = { line: number; from: number; to: number; page: string; qIndex: number };
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
  spans.push({ line: a.line, from: a.col, to: b.col + 1, page: String(mt.anchor), qIndex: mt.qIndex });
}
spans.sort((x, y) => x.line - y.line || x.from - y.from || y.to - x.to);
const byLine = new Map<number, S[]>();
for (const s of spans) (byLine.get(s.line) ?? byLine.set(s.line, []).get(s.line)!).push(s);

const survivors = new Map<string, number>();
const losers: { s: S; by: S; reason: string }[] = [];
for (const [li, list] of byLine) {
  const width = (baseLines[li] ?? "").length;
  let lastEnd = -1, lastFrom = -1;
  let prev: S | null = null;
  for (const s of list) {
    if (s.from < lastEnd) {
      if (prev) losers.push({ s, by: prev, reason: s.from === lastFrom ? "同起點但較短" : "起點落在前段區間內" });
      continue;
    }
    const to = Math.min(s.to, width);
    if (to <= s.from) continue;
    survivors.set(s.page, (survivors.get(s.page) ?? 0) + 1);
    prev = s; lastEnd = to; lastFrom = s.from;
  }
}
const pages = new Set(spans.map((s) => s.page));
const lost = [...pages].filter((p) => !survivors.has(p));
const lostSet = new Set(lost);

/* 一頁被吃多段就列多行。兩面都要看，不只「誰被判得差」：
 *  · 疑似誤殺＝勝出方判定比被吃方差（這才是 first-wins 殺掉好鏈）
 *  · 可疑存活＝勝出方自己就判「不符」（活下來的那條本來就不該在庫裡）
 * 「无题面记录」不參與排序比較（它不是判定，是沒有題面可比），單獨計數。 */
const RANK = new Map<string, number>([["一致", 3], ["简称/异写一致", 2], ["部分相符", 1], ["不符", 0]]);
const rows: string[][] = [];
let wrongKill = 0, suspectWinner = 0;
const pairCount = new Map<string, number>();
for (const l of losers) {
  if (!lostSet.has(l.s.page)) continue;
  const vl = verdictOf.get(l.s.qIndex), vw = verdictOf.get(l.by.qIndex);
  const rl = RANK.get(vl?.verdict ?? ""), rw = RANK.get(vw?.verdict ?? "");
  const worse = rl !== undefined && rw !== undefined && rw < rl;
  const suspect = vw?.verdict === "不符";
  if (worse) wrongKill++;
  if (suspect) suspectWinner++;
  pairCount.set(`被吃 ${vl?.verdict ?? "?"} ／ 勝出 ${vw?.verdict ?? "?"}`, (pairCount.get(`被吃 ${vl?.verdict ?? "?"} ／ 勝出 ${vw?.verdict ?? "?"}`) ?? 0) + 1);
  rows.push([
    l.s.page, bookOf.get(l.s.qIndex) ?? "", vl?.verdict ?? "?", vl?.how ?? "",
    l.by.page, bookOf.get(l.by.qIndex) ?? "", vw?.verdict ?? "?",
    String(l.s.line + 1), entryOf[l.s.line] ?? "", `${l.s.from}-${l.s.to}`, `${l.by.from}-${l.by.to}`, l.reason,
    worse ? "是" : "", suspect ? "是" : "", (quotesArr[l.s.qIndex]?.raw ?? "").replace(/<[^>]*>/g, "").slice(0, 40),
  ]);
}
const header = ["被吃頁", "該頁書名", "該條經名核對", "解析方式", "勝出頁", "勝出書名", "勝出判定",
  "行號", "詞條", "被吃區間", "勝出區間", "被吃原因", "疑似誤殺", "勝出方本身判不符", "引文"];
writeFileSync(resolve(ROOT, "out/lost-pages.tsv"),
  header.join("\t") + "\n" + rows.map((r) => r.join("\t")).join("\n") + "\n", "utf8");
const cell = (s: string) => `"${s.replace(/"/g, '""')}"`;
writeFileSync(resolve(ROOT, "out/lost-pages.csv"),
  "\ufeff" + header.map(cell).join(",") + "\r\n" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n", "utf8");

console.log(`保留集涉及 ${pages.size} 頁，存活 ${survivors.size} 頁，全盤被吃掉 ${lost.length} 頁（被吃段 ${rows.length} 段）`);
console.log(`  疑似誤殺（勝出方判定比被吃方差）：${wrongKill} 段`);
console.log(`  可疑存活（勝出方自己就判「不符」）：${suspectWinner} 段`);
console.log(`  判定配對分佈：`);
for (const [k, v] of [...pairCount.entries()].sort((a, b) => b[1] - a[1])) console.log(`     ${String(v).padStart(3)}  ${k}`);
console.log(`  -> out/lost-pages.tsv、out/lost-pages.csv（UTF-8 BOM＋CRLF，Excel 直接開）`);

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : lost.slice(0, 4);
for (const p of wanted) {
  const cases = losers.filter((l) => l.s.page === p);
  if (!cases.length) { console.log(`\n頁 ${p}：不在本次被吃清單（查頁名或批次）`); continue; }
  console.log(`\n頁 ${p}（${bookOf.get(cases[0].s.qIndex) ?? "?"}）：被吃 ${cases.length} 段`);
  for (const c of cases.slice(0, 2)) {
    const vl = verdictOf.get(c.s.qIndex), vw = verdictOf.get(c.by.qIndex);
    console.log(`  ${entryOf[c.s.line] ?? ""}（行 ${c.s.line + 1}）區間 ${c.s.from}-${c.s.to}｜判定 ${vl?.verdict}(${vl?.how})`);
    console.log(`    勝出 ${c.by.page}(${bookOf.get(c.by.qIndex)}) 區間 ${c.by.from}-${c.by.to}｜判定 ${vw?.verdict}｜${c.reason}`);
    console.log(`    引文 ${(quotesArr[c.s.qIndex]?.raw ?? "").replace(/<[^>]*>/g, "").slice(0, 40)}…`);
  }
}
