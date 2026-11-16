#!/usr/bin/env bun
/**
 * 回指之外還有沒有回指：題面（引用前那幾個字）分類普查。
 *
 * 起因：作者先點名「同經」，我修了以 同/又/前/次/本/此/是 起頭、剥完只剩
 * 經論疏記這類「裸體裁字」的 732 條。但丁福保的題目寫法遠不止這一型：
 *   「同卷」「又第」「上卷」「准前」「已上經」「同輔行」「嘉祥同…」
 * 都可能是回指。本腳本**只讀不改**，逐型量三件事：
 *   1. 有多少條題面屬於這一型；
 *   2. 這一型現在判成什麼（一致／簡體一致／部分相符／不符／未解…）；
 *   3. 若把這一型改判回指（正文回溯 → 順序繼承），判定會變成什麼。
 * 有 flip 矩陣才談得上「需不需要」，只數 pattern 是自high。
 *
 * 用法：bun run src/audit-anaphora.ts [slug=dfb-v3]
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const SLUG = process.argv[2] ?? "dfb-v3";

const matches = JSON.parse(readFileSync(resolve(ROOT, `out/matches/${SLUG}-matches.json`), "utf8")) as
  { qIndex: number; line: number; book: string; anchor: string; cands: number; hint: number }[];
const quotes = JSON.parse(readFileSync(resolve(ROOT, `out/matches/${SLUG}-quotes.json`), "utf8")) as
  { line: number; raw: string; han: string }[];

const norm = (s: string) => s.replace(/[^\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g, "");

// 行號 → 詞條
const lineToEntry: number[] = [];
{
  const lines = readFileSync(resolve(ROOT, "out/dfb-lines.txt"), "utf8").replace(/\r\n/g, "\n").split("\n");
  let cur = 0;
  for (const l of lines) {
    const m = /^<詞 id="(\d+)"/.exec(l);
    if (m) cur = Number(m[1]);
    lineToEntry.push(cur);
  }
}
// 詞條 → 按順序的題面記錄
type Cite = { entry: number; title: string; juan: string; han: string };
const cites = new Map<number, Cite[]>();
{
  const lines = readFileSync(resolve(ROOT, "out/cite-all.tsv"), "utf8").replace(/\r\n/g, "\n").trim().split("\n").slice(1);
  for (const l of lines) {
    const c = l.split("\t");
    if (c.length < 5) continue;
    const e = Number(c[0]);
    const list = cites.get(e) ?? [];
    list.push({ entry: e, title: c[2] ?? "", juan: c[3] ?? "", han: norm(c[4] ?? "") });
    cites.set(e, list);
  }
}
// 詞條釋文（正文回溯用）
const body = new Map<number, string>();
{
  const lines = readFileSync(resolve(ROOT, "../fodict/data/佛學大辭典.tsv"), "utf8").split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split("\t");
    if (c.length < 3) throw new Error(`釋文源第 ${i + 1} 行列數不足`);
    body.set(Number(c[0]), norm(c[2].replace(/\\n/g, "")));
  }
}
// 書名空間＝backlink 實際報過的大正書名
const books = [...new Set(matches.map((m) => m.book).filter((b) => !!b && b.length >= 2))];
const byFirst = new Map<string, string[]>();
for (const b of books) {
  const l = byFirst.get(b[0]);
  if (l) l.push(b);
  else byFirst.set(b[0], [b]);
}
for (const l of byFirst.values()) l.sort((a, b) => b.length - a.length);
const hitsCache = new Map<number, { at: number; title: string }[]>();
function titleHits(e: number) {
  const c = hitsCache.get(e);
  if (c) return c;
  const t = body.get(e) ?? "";
  const out: { at: number; title: string }[] = [];
  for (let i = 0; i < t.length; i++) {
    const cs = byFirst.get(t[i]);
    if (!cs) continue;
    for (const b of cs) { if (t.startsWith(b, i)) { out.push({ at: i, title: b }); break; } }
  }
  hitsCache.set(e, out);
  return out;
}
function nearestBefore(e: number, quoteHan: string): string {
  const t = body.get(e);
  if (!t || quoteHan.length < 4) return "";
  const at = t.indexOf(quoteHan.slice(0, 12));
  if (at < 0) return "";
  let best = "";
  let bestAt = -1;
  for (const h of titleHits(e)) if (h.at + h.title.length <= at && h.at > bestAt) { best = h.title; bestAt = h.at; }
  return best;
}

/* ---------------- 型的定義 ---------------- */
const LEAD = /^(同|又|前|次|本|此|是|如|准|準|出|見|則|即|案|按)/;
const GENRE = /^(經|論|疏|鈔|記|集|章|訣|頌|律|藏|書|篇|偈|部|典|語|文句|玄義|名義|義疏|演義|述義|疏鈔|記|[一二三四五六七八九十百\d]+)$/;
const VOLUME = /^(第?[一二三四五六七八九十百千0-9]+|卷[第]?[一二三四五六七八九十百千0-9]+|上|中|下|上卷|中卷|下卷|前卷|後卷|本卷|此卷|初|末)$/;
const PIN2 = /^(第?[一二三四五六七八九十百千0-9]+)?(品|章|句|偈|喻|分|集|卷|篇)$/;
const COMMENT = /^(輔行|嘉祥|凈影|淨影|章安|智者|荆溪|圭峰|溫陵|圓暉|憬興|測疏|新疏|舊疏|同疏|疏主|記主|鈔主|演|述|贊|註|注|疏|記|鈔|序|引|解|義|判|要|述|玄義|文句|釋文|音義|行記|傳|論|律)$/;
type Cls = { name: string; test: (raw: string, rest: string) => boolean };
const CLASSES: Cls[] = [
  { name: "①裸體裁字（現行已判回指）", test: (_r, rest) => rest === "" || GENRE.test(rest) },
  { name: "②只有卷次/品次", test: (_r, rest) => VOLUME.test(rest) || PIN2.test(rest) },
  { name: "③注家/注書省稱", test: (_r, rest) => COMMENT.test(rest) },
  { name: "④以上/前說型（含「上」「前」結尾）", test: (raw, rest) => /(已上|以上|上說|上卷|前說|前引|前文|前章|同前|如前|准前|準前|已上|上同)$/.test(raw) || rest === "上" || rest === "前" },
  { name: "⑤其他引導詞＋實稱（自帶經名）", test: () => true },
];
/** 回指引導詞集合＝现行 ANA ∪ 如/准/準/出/見/則/即/案/按；比對時按最長前綴剝。 */
function stripLead(t: string): { hit: boolean; rest: string } {
  const s = t.trim();
  const m = LEAD.exec(s);
  if (!m) return { hit: false, rest: s };
  return { hit: true, rest: s.slice(m[0].length).replace(/^[（(。、，：；\s]+/, "").trim() };
}
const CURRENT_ANA = /^(同|又|前|次|本|此|是)/;
const CURRENT_GENRE = /^(經|論|疏|鈔|記|集|章|訣|頌|律|藏|書|篇|偈|部|典|語|文句|玄義|名義|義疏|[一二三四五六七八九十百\d]+)$/;
function isCurrentAnaphora(t: string): boolean {
  const s = t.trim();
  if (!CURRENT_ANA.test(s)) return false;
  const rest = s.replace(CURRENT_ANA, "").replace(/^[（(。、，：；\s]+/, "").trim();
  return rest === "" || CURRENT_GENRE.test(rest);
}

/* 把候選錨點對回題面記錄（與 check-titles 同一配對法） */
const quoteOf = new Map<number, { q: { raw: string; han: string }; mIdx: number }>();
matches.forEach((m, i) => quoteOf.set(m.qIndex, { q: quotes[m.qIndex], mIdx: i }));
const byEntryIdx = new Map<number, { qIndex: number; ci: number }[]>();
for (const m of matches) {
  const entry = lineToEntry[m.line] ?? 0; // backlink 的 line 是 0 起算
  if (!entry) continue;
  const q = quotes[m.qIndex];
  if (!q) continue;
  const qh = norm(q.han ?? q.raw);
  const list = cites.get(entry) ?? [];
  let ci = list.findIndex((x) => x.han.length >= 4 && qh.startsWith(x.han.slice(0, 12)));
  if (ci < 0) ci = list.findIndex((x) => x.han.slice(0, 12).startsWith(qh.slice(0, 12)) && qh.length >= 4);
  if (ci < 0) continue;
  (byEntryIdx.get(entry) ?? byEntryIdx.set(entry, []).get(entry)!).push({ qIndex: m.qIndex, ci });
}

function verdictOf(want: string, book: string): string {
  const wn = norm(want), bn = norm(book);
  if (!wn) return "無期望經名";
  if (wn === bn) return "一致";
  const sub = (s: string, b: string) => { if (s.length < 2) return false; let i = 0; for (let j = 0; j < b.length && i < s.length; j++) if (b[j] === s[i]) i++; return i === s.length; };
  if (bn.includes(wn) || wn.includes(bn) || sub(wn, bn) || sub(bn, wn)) return "簡稱/異寫一致";
  return "不符";
}
// 現有解析（簡化重現 check-titles 的非回指分支：去噪→品名剝離→tmap）
const matchOf = new Map<number, (typeof matches)[number]>(matches.map((m) => [m.qIndex, m]));
const tmap = new Map<string, { kind: string; list: string[] }>();
for (const l of readFileSync(resolve(ROOT, "data/title-map.tsv"), "utf8").replace(/\r\n/g, "\n").trim().split("\n").slice(1)) {
  const c = l.split("\t");
  tmap.set(c[0], { kind: c[2] ?? "", list: (c[3] ?? "").split("|").filter(Boolean) });
}
const NOISE = /^(則|即|如|出|見|案|按|又|同|此|是|本|前|次)+/;
const PIN = /^(.{2,12}?(?:經|論|疏|鈔|記|集|章|訣|頌|律|名義|玄義|文句))(?:[一二三四五六七八九十百\d]+)?(?:品|卷|篇|章)?/;
function currentWant(entry: number, list: Cite[], idx: number): { want: string; how: string } {
  let last = "";
  for (let i = 0; i <= idx; i++) {
    const t = list[i].title.trim();
    if (isCurrentAnaphora(t)) { last = last; continue; }
    let title = t.replace(NOISE, "");
    const m = title.match(PIN);
    if (m && m[1].length >= 2) title = m[1];
    const tm = tmap.get(title);
    if (tm?.kind === "简称展开" && tm.list.length === 1) title = tm.list[0];
    if (title) last = title;
  }
  const t = list[idx].title.trim();
  if (isCurrentAnaphora(t)) return { want: last, how: "回指(现行)" };
  let title = t.replace(NOISE, "");
  const m = title.match(PIN);
  if (m && m[1].length >= 2) title = m[1];
  const tm = tmap.get(title);
  if (tm?.kind === "简称展开" && tm.list.length === 1) title = tm.list[0];
  return { want: title, how: tm?.kind ?? (title === t ? "原样" : "去噪/剥离") };
}

const stat = new Map<string, { 題面: number; 帶錨點: number; now: Map<string, number>; then: Map<string, number>; flip: number; samples: string[] }>();
const bump = (k: string) => {
  let s = stat.get(k);
  if (!s) stat.set(k, (s = { 題面: 0, 帶錨點: 0, now: new Map(), then: new Map(), flip: 0, samples: [] }));
  return s;
};
const add = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

for (const [entry, list] of cites) {
  for (let i = 0; i < list.length; i++) {
    const raw = list[i].title.trim();
    if (!raw) continue;
    const { hit, rest } = stripLead(raw);
    let name = "⓪非引導詞開頭";
    if (hit) for (const c of CLASSES) { if (c.test(raw, rest)) { name = c.name; break; } }
    const s = bump(name);
    s.題面++;
    const anchors = (byEntryIdx.get(entry) ?? []).filter((x) => x.ci === i);
    for (const a of anchors) {
      const m = matchOf.get(a.qIndex)!;
      s.帶錨點++;
      const cur = currentWant(entry, list, i);
      add(s.now, verdictOf(cur.want, m.book) + "/" + cur.how);
      // 改判回指後
      const inh = nearestBefore(entry, list[i].han) || (list.slice(0, i).map((x) => currentWant(entry, list, list.indexOf(x)).want).filter(Boolean).pop() ?? "");
      const v2 = verdictOf(inh, m.book);
      add(s.then, v2 + (nearestBefore(entry, list[i].han) ? "/正文回溯" : "/順序繼承"));
      if (v2 === "一致" || v2 === "簡稱/異寫一致") { if (cur.want !== inh) s.flip++; }
      if (s.samples.length < 3) s.samples.push(`《${raw}》→ 現「${cur.want}」(${cur.how}) vs 改「${inh}」｜命中「${m.book}」`);
    }
  }
}

console.log(`詞條 ${cites.size}、題面 ${[...cites.values()].reduce((s, l) => s + l.length, 0)}、帶錨點候選 ${matches.length}\n`);
for (const [name, s] of [...stat.entries()].sort((a, b) => b[1].帶錨點 - a[1].帶錨點)) {
  console.log(`【${name}】題面 ${s.題面} 條、其中帶錨點 ${s.帶錨點}；改判回指後可比對為一致/簡體一致的 ${s.flip}`);
  const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k}:${v}`).join("  ");
  console.log(`   現判定  ${top(s.now)}`);
  console.log(`   改判後  ${top(s.then)}`);
  for (const x of s.samples) console.log(`   · ${x}`);
}
