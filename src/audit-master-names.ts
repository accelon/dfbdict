#!/usr/bin/env bun
/**
 * 「同天台疏」這類**注家專名**的繼承邏輯到底對不對——逐條攤開查三件事：
 *
 *   A. 判型對不對：它不該被當成回指（「同」是「與前同書」的 redundant 提示，
 *      真正的指稱在「天台疏」三字上）；反過來「同疏」「同註」這種裸體裁字才該回指。
 *   B. **污染**：注家專名多半在 title-map 裡是「對不上」（語料無此書），
 *      而解析器無條件 `last = title`——一旦把「天台疏」寫進 last，
 *      同詞条後面的「同偈」「同經」就會繼承這個**語料根本沒有的書名**，
 *      錯得比不繼承還遠。這是最要緊的一項。
 *   C. 該不該給它們配「注家→注書」對照：數一數這一型有幾條、帶幾條錨點，
 *      值不值得動資料層。
 *
 * 只讀，不改產出。用法：bun run src/audit-master-names.ts [slug=dfb-v3]
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const SLUG = process.argv[2] ?? "dfb-v3";

const norm = (s: string) => s.replace(/[^\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g, "");
const LEAD = /^(同|又|前|次|本|此|是)/;
const BARE = /^(經|論|疏|鈔|記|集|章|訣|頌|律|藏|書|篇|偈|部|典|語|品|中|上|下|前|後|注|註|卷)$/;
const GENERIC = /^(經|論|疏|鈔|記|集|章|訣|頌|律|藏|書|篇|偈|部|典|語|品|中|上|下|前|後|注|註|卷|文句|玄義|名義|義疏|[一二三四五六七八九十百\d第]+)$/;
// 注家／宗派稱：丁福保拿來當代稱呼用的專名（史傳與台宗常用者）
const MASTERS = /(天台|荊溪|章安|智者|嘉祥|淨影|凈影|圭峰|溫陵|圓暉|測|憬興|慈恩|窥基|肇|僧肇|什|羅什|鳩摩羅什|馬鳴|龍樹|世親|賢首|清凉|清涼|孤山|南屏|北山|南山|相國|慈雲|神清|宗密|法藏|澄觀|湛然|智顗|吉藏|慧遠|道生|道宣|善導|迦才|懷感|飛錫|承遠|省常|延壽|智圓|淨梵|普泰|光宅|愛|宣)|[師公大師]$/;
const WORK_SUFFIX = /(疏|記|鈔|註|注|論|集|章|玄義|文句|義疏|演義|述義|贊|偈|頌|序|引|解|傳|錄|要|決|門|旨|科|榜|源|略|全書|編)$/;

/** 與 check-titles 同式的回指判別（這裡要的是「現在實際上怎麼判」） */
function isAnaphora(t: string): boolean {
  const s = t.trim();
  if (BARE.test(s)) return true;
  if (!LEAD.test(s)) return false;
  const rest = s.replace(LEAD, "").replace(/^[（(。、，：；\s]+/, "").trim();
  return rest === "" || GENERIC.test(rest) || /^(經|論|疏|記|鈔).{1,6}(品|卷|章|篇)$/.test(rest);
}
/** 注家專名型：引導詞＋（專名）＋書體尾，且不是裸體裁字 */
function isMasterForm(t: string): null | { rest: string; kind: "注家" | "注書省稱" } {
  const s = t.trim();
  if (isAnaphora(s)) return null;
  const rest = LEAD.test(s) ? s.replace(LEAD, "").trim() : s;
  if (!rest || rest.length < 2) return null;
  if (MASTERS.test(rest) && WORK_SUFFIX.test(rest)) return { rest, kind: "注家" };
  if (WORK_SUFFIX.test(rest) && !GENERIC.test(rest) && rest.length <= 8) return { rest, kind: "注書省稱" };
  return null;
}

const tmap = new Map<string, { kind: string; list: string[] }>();
for (const l of readFileSync(resolve(ROOT, "data/title-map.tsv"), "utf8").replace(/\r\n/g, "\n").trim().split("\n").slice(1)) {
  const c = l.split("\t");
  tmap.set(c[0], { kind: c[2] ?? "", list: (c[3] ?? "").split("|").filter(Boolean) });
}
const matches = JSON.parse(readFileSync(resolve(ROOT, `out/matches/${SLUG}-matches.json`), "utf8")) as
  { qIndex: number; line: number; book: string; cands: number }[];
const quotes = JSON.parse(readFileSync(resolve(ROOT, `out/matches/${SLUG}-quotes.json`), "utf8")) as { line: number; raw: string }[];
const NOISE = /^(則|即|如|出|見|案|按|又|同|此|是|本|前|次)+/;
const PIN = /^(.{2,12}?(?:經|論|疏|鈔|記|集|章|訣|頌|律|名義|玄義|文句))(?:[一二三四五六七八九十百\d]+)?(?:品|卷|篇|章)?/;
function resolvePlain(t: string): { title: string; kind: string } {
  let s = t.trim().replace(NOISE, "");
  const m = s.match(PIN);
  if (m && m[1].length >= 2) s = m[1];
  const tm = tmap.get(s);
  return { title: s, kind: tm?.kind ?? "未收" };
}

const cites = new Map<number, { title: string; han: string }[]>();
{
  const lines = readFileSync(resolve(ROOT, "out/cite-all.tsv"), "utf8").replace(/\r\n/g, "\n").trim().split("\n").slice(1);
  for (const l of lines) {
    const c = l.split("\t");
    if (c.length < 5) continue;
    const e = Number(c[0]);
    const list = cites.get(e) ?? [];
    list.push({ title: (c[2] ?? "").trim(), han: norm(c[4] ?? "") });
    cites.set(e, list);
  }
}
const lineToEntry: number[] = [];
{
  const ls = readFileSync(resolve(ROOT, "out/dfb-lines.txt"), "utf8").replace(/\r\n/g, "\n").split("\n");
  let cur = 0;
  for (const l of ls) {
    const m = /^<詞 id="(\d+)"/.exec(l);
    if (m) cur = Number(m[1]);
    lineToEntry.push(cur);
  }
}
const anchorsOf = new Map<number, { qIndex: number; ci: number; book: string; cands: number }[]>();
for (const m of matches) {
  const e = lineToEntry[m.line] ?? 0; // backlink 的 line 是 0 起算
  const q = quotes[m.qIndex];
  const list = cites.get(e) ?? [];
  if (!e || !q) continue;
  const qh = norm(q.raw);
  let ci = list.findIndex((x) => x.han.length >= 4 && qh.includes(x.han.slice(0, 12)));
  if (ci < 0) continue;
  const arr = anchorsOf.get(e) ?? [];
  arr.push({ qIndex: m.qIndex, ci, book: m.book, cands: m.cands });
  anchorsOf.set(e, arr);
}

let 注家型 = 0, 注家型帶錨 = 0, 未收或對不上 = 0;
const seenTitles = new Map<string, number>();
const samples: string[] = [];
// 污染計數：後面有幾條回指继承了「語料無此書/未收」的 last
let poisonedRows = 0, poisonedAnchors = 0;
const poisonSamples: string[] = [];
for (const [e, list] of cites) {
  let last = "";
  let lastBad = false;
  for (let i = 0; i < list.length; i++) {
    const t = list[i].title;
    const mf = isMasterForm(t);
    if (mf) {
      注家型++;
      seenTitles.set(t, (seenTitles.get(t) ?? 0) + 1);
      const rp = resolvePlain(t);
      if (rp.kind === "对不上" || rp.kind === "未收") 未收或對不上++;
      if ((anchorsOf.get(e) ?? []).some((a) => a.ci === i)) 注家型帶錨++;
      if (samples.length < 14) samples.push(`  詞条 ${e}《${t}》→ 現判型=${isAnaphora(t) ? "回指" : "書名"}、解析「${rp.title}」(${rp.kind})`);
    }
    if (isAnaphora(t)) {
      if (lastBad && last) {
        poisonedRows++;
        if ((anchorsOf.get(e) ?? []).some((a) => a.ci === i)) poisonedAnchors++;
        if (poisonSamples.length < 10) poisonSamples.push(`  詞条 ${e}《${t}》继承了上一个「${last}」——那個在語料裡${lastBad ? "根本沒有" : "?"}`);
      }
      continue;
    }
    const rp = resolvePlain(t);
    if (rp.title) { last = rp.title; lastBad = rp.kind === "对不上" || rp.kind === "未收"; }
  }
}
console.log(`注家／注書省稱型題面：${注家型} 條（其中 ${未收或對不上} 條在 title-map 裡是「對不上／未收」），帶錨點 ${注家型帶錨} 个`);
console.log(`Top：${[...seenTitles.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18).map(([k, v]) => `${k}(${v})`).join(" ")}`);
console.log("\n判型抽樣：");
for (const s of samples) console.log(s);
console.log(`\n【污染】继承了「語料無此書」這種 last 的回指行：${poisonedRows} 行、其中带锚点 ${poisonedAnchors} 个`);
for (const s of poisonSamples) console.log(s);
