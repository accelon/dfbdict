#!/usr/bin/env bun
/**
 * 独立复核 `<聯 i="taisho?頁" q="…" j="起-訖">`——**全量**，一遍扫过大正藏。
 *
 * 为什么不用 src/verify-xref.ts：那支的 `pageHan()` 每查一个页 id 都从第 0 行
 * 重扫一遍 taisho.adb（674 万行）。抽样 30 个还跑得动，全量 10,587 个锚点＝
 * 近万次全库扫描，实际是 O(n²)：丢到后台五分钟后回头看，才发现它根本不会结束，
 * 已终止（连带清掉上一轮遗留的一个 inline 探针行程，两个 bun 各占 0.8／1.0 GB）。
 * 这里改成**按页分组＋单遍流式**：扫到某页才算某页，算完即丢，内存有界。
 *
 * 还修掉旧脚本一个真隐患：它把任意 `id="X"` 也算命中，`id="12"` 会误配到别的标记。
 * 这里只认 `<頁 …>` 标记本身的 id／n。
 *
 * j 的口径照产生端：backlink.ts:381 `end = pos + matched`，是**不含终点**的右开区间，
 * 所以比对用 `pageHan.slice(a, b)`；另外统计 q 长与区间长的关系，
 * 真有 off-by-one 会露在「长度不等」这一栏，不会混进「通过」。
 *
 * 用法: bun run src/verify-xref-all.ts <linked.txt>
 */
import { readFileSync } from "node:fs";
import { openAdb } from "../../adb-converter/ts/tools/adb-skill/engine";

const linked = process.argv[2];
if (!linked) {
  console.error("用法: bun run src/verify-xref-all.ts <linked.txt>");
  process.exit(2);
}

type A = { line: number; page: string; q: string; a: number; b: number };
const found: A[] = [];
{
  const lines = readFileSync(linked, "utf8").replace(/\r\n/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i].matchAll(/<聯 i="taisho\?([^"]+)"[^>]*\bq="([^"]*)"[^>]*\bj="(\d+)-(\d+)">/g)) {
      found.push({ line: i + 1, page: m[1], q: m[2], a: Number(m[3]), b: Number(m[4]) });
    }
  }
}
console.log(`linked 档内 taisho 字元级锚点 ${found.length} 个`);
if (!found.length) process.exit(1);

const isHan = (c: string) => /[㐀-䶿一-鿿豈-﫿]/.test(c);
const hanOf = (s: string): string => {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "<") {
      const gt = s.indexOf(">", i);
      if (gt < 0) break;
      i = gt;
      continue;
    }
    if (isHan(s[i])) out += s[i];
  }
  return out;
};
const unesc = (s: string) =>
  s.replace(/＆/g, "&").replace(/＜/g, "<").replace(/＞/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

// 页 → 该页待验锚点；不在册的页扫过时一个字都不收。
const byPage = new Map<string, A[]>();
for (const f of found) {
  let list = byPage.get(f.page);
  if (!list) byPage.set(f.page, (list = []));
  list.push(f);
}
console.log(`涉及 ${byPage.size} 个不同的页栏键`);

const db = await openAdb("D:/accelon3/taisho.adb");
console.log(`taisho.adb ${db.lines} 行，单遍扫描开始`);

const t0 = Date.now();
let pass = 0, bad = 0, pagesSeen = 0, prefixOnly = 0;
const fails: string[] = [];
const seen = new Set<string>();

let cur: string | null = null;
let want = false;
let acc = "";

function flush() {
  if (!cur || !want) return;
  pagesSeen++;
  seen.add(cur);
  const ph = hanOf(acc);
  for (const f of byPage.get(cur)!) {
    const qh = hanOf(unesc(f.q));
    const seg = ph.slice(f.a, f.b);
    const span = f.b - f.a;
    if (qh.length > 0 && seg === qh) {
      pass++;
      if (qh.length !== span) prefixOnly++; // 内容对上了但长度不等：q 比区间长，另计
    } else if (qh.length > span && seg === qh.slice(0, span)) {
      pass++; // q 带得比 j 区间长（产生端 qAttr 截 160 字），区间本身对得上
      prefixOnly++;
    } else {
      bad++;
      if (fails.length < 12) {
        let d = 0;
        while (d < seg.length && d < qh.length && seg[d] === qh[d]) d++;
        fails.push(`页 ${f.page} 行 ${f.line} j=${f.a}-${f.b}｜首异@${d}｜q汉=${JSON.stringify(qh.slice(d, d + 16))}｜页内=${JSON.stringify(seg.slice(d, d + 16))}｜页汉长 ${ph.length}`);
      }
    }
  }
  acc = "";
}

/* `<頁\b` 是个陷阱：`頁` 不是 `\w`，后面跟空格时压根没有词边界，正则永远不匹配，
 * 第一版就因此扫了 60 万行却「已核页 0」。改成 lookahead。 */
const PAGE_HEAD = /<頁(?=[\s>])[^>]*>/g;
const attrOf = (tag: string, k: string) => new RegExp(`\\b${k}="([^"]*)"`).exec(tag)?.[1] ?? "";

const CHUNK = 6000;
// --max 只扫前 N 行，用来自检「页认得出吗」，不必等整库跑完才发现匹配写错
const MAXARG = process.argv.indexOf("--max");
const MAXLINES = MAXARG >= 0 ? Number(process.argv[MAXARG + 1]) : 0;
const STOP = MAXLINES > 0 ? Math.min(MAXLINES, db.lines) : db.lines;
for (let start = 0; start < STOP; start += CHUNK) {
  const n = Math.min(CHUNK, db.lines - start);
  const raws = await Promise.all(Array.from({ length: n }, (_, i) => db.raw(start + i)));
  for (const t of raws) {
    PAGE_HEAD.lastIndex = 0;
    let pos = 0;
    let m: RegExpExecArray | null;
    while ((m = PAGE_HEAD.exec(t)) !== null) {
      if (want) acc += t.slice(pos, m.index); // 标记之前的文字属于上一页
      flush();
      const id = attrOf(m[0], "id") || attrOf(m[0], "n");
      cur = id || null;
      want = !!cur && byPage.has(cur);
      pos = m.index + m[0].length;
      acc = "";
    }
    if (want) acc += t.slice(pos);
  }
  if ((start + CHUNK) % 120000 === 0) console.log(`  ${start + CHUNK} 行（${((Date.now() - t0) / 1000).toFixed(0)}s，已核页 ${pagesSeen}、锚点 通过 ${pass}／不符 ${bad}）`);
}
flush();

const missing = [...byPage.keys()].filter((p) => !seen.has(p));
console.log(`\n全量复核 ${found.length} 个锚点：通过 ${pass}、不符 ${bad}（${((bad / found.length) * 100).toFixed(3)}%）`);
console.log(`  其中「文字对但 q 比 j 区间长」${prefixOnly} 个（口径差异，不是错，列出来备查）`);
console.log(`扫到并核过的页 ${pagesSeen}／需要 ${byPage.size}；没扫到的页 ${missing.length}${missing.length ? `（例：${missing.slice(0, 5).join(" ")}）` : ""}`);
console.log(`耗时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
for (const x of fails) console.log("   ", x);
if (missing.length) console.log("    注：没扫到的页，其锚点既不算通过也不算不符，须先解释再签收。");
