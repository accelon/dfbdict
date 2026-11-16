#!/usr/bin/env bun
/**
 * 独立复核 backlink 产出的字元级锚点 <聯 i="taisho?頁" q="…" j="起-訖">。
 *
 * 为什么不能直接用 backlink 的 pageHanAt 来自检：那是同一套取页逻辑，
 * 自己验自己只会把它的偏差一起确认为“对”。这里走另一条路：
 *   用 taisho.adb 的行档（db.raw / db.line）定位，向前回溯找 `<頁 id="…"`，
 *   收集到下一个 `<頁 ` 为止，再按同样的“可见汉字”规则取序列比对。
 * 判定：q 的汉字序列必须等于 pageHan[j起 : j訖]。
 * 用法: bun run src/verify-xref.ts <linked.txt> [样本数=30]
 */
import { readFileSync } from "node:fs";
import { openAdb } from "../../adb-converter/ts/src/accelon26/variants"; // 占位，下面不用
import { openAdb as _unused } from "../../adb-converter/ts/tools/adb-skill/engine";

void _unused; void openAdb;

const linked = process.argv[2] ?? "../../adb-converter/build/dfb-pilot-linked.txt";
const sampleN = Number(process.argv[3] ?? 30);

const lines = readFileSync(linked, "utf8").replace(/\r\n/g, "\n").split("\n");
type L = { line: number; page: string; q: string; a: number; b: number };
const found: L[] = [];
for (let i = 0; i < lines.length; i++) {
  for (const m of lines[i].matchAll(/<聯 i="taisho\?([^"]+)" q="([^"]*)" j="(\d+)-(\d+)">/g)) {
    found.push({ line: i, page: m[1], q: m[2], a: Number(m[3]), b: Number(m[4]) });
  }
}
console.log(`linked 档内 taisho 字元级锚点 ${found.length} 个`);
if (!found.length) {
  console.log("没有可验对象");
  process.exit(1);
}

// 可见汉字规则（与阅读端一致）：只数 BMP 汉字区，跳过标签
const isHan = (c: string) => /[㐀-䶿一-鿿豈-﫿]/.test(c);
const hanOf = (s: string) => {
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

const db = await (await import("../../adb-converter/ts/tools/adb-skill/engine")).openAdb("D:/accelon3/taisho.adb");
console.log(`taisho.adb 行数 ${db.lines}`);

// 抽样：均匀取，覆盖不同经
const step = Math.max(1, Math.floor(found.length / sampleN));
const picks = found.filter((_, i) => i % step === 0).slice(0, sampleN);

// 页缓存：页 id -> 该页可见汉字串
const pageCache = new Map<string, string>();
async function pageHan(pageId: string): Promise<string> {
  const hit = pageCache.get(pageId);
  if (hit !== undefined) return hit;
  // 用 search 找到该页内任一文本行号，再前后扫原始行
  const s = await db.search(pageId, 1).catch(() => null);
  void s;
  // 行档里找 `<頁 id="X"`：靠 toc 的 va 无法直接映射，这里用逐段扫描（页 id 唯一，命中即停）
  let out = "";
  const chunk = 4000;
  for (let start = 0; start < db.lines; start += chunk) {
    const raws = await Promise.all(Array.from({ length: Math.min(chunk, db.lines - start) }, (_, i) => db.raw(start + i)));
    for (let k = 0; k < raws.length; k++) {
      const t = raws[k] ?? "";
      if (t.includes(`<頁 id="${pageId}"`) || t.includes(`<頁 n="${pageId}"`) || t.includes(`id="${pageId}"`)) {
        // 从该行起收集到下一个 `<頁 `
        let acc = t.slice(t.indexOf(`<頁 `) >= 0 ? t.indexOf(`<頁 `) : 0);
        let j = start + k + 1;
        while (j < db.lines && !acc.includes("<頁 ", 10) ) {
          const nx = await db.raw(j);
          if (nx.includes("<頁 ")) break;
          acc += nx;
          j++;
          if (j - (start + k) > 400) break;
        }
        out = hanOf(acc);
        pageCache.set(pageId, out);
        return out;
      }
    }
  }
  pageCache.set(pageId, "");
  return "";
}

let pass = 0;
const fails: string[] = [];
for (const f of picks) {
  const ph = await pageHan(f.page);
  const qh = hanOf(f.q.replace(/＆/g, "&").replace(/＜/g, "<").replace(/＞/g, ">"));
  const seg = ph.slice(f.a, f.b);
  const ok = qh.length > 0 && seg === qh;
  if (ok) pass++;
  else if (fails.length < 12) fails.push(`页 ${f.page} j=${f.a}-${f.b}｜q汉=${JSON.stringify(qh.slice(0, 22))}｜页内=${JSON.stringify(seg.slice(0, 22))}｜页汉长 ${ph.length}`);
}
console.log(`\n独立复核 ${picks.length} 个锚点：通过 ${pass}、不符 ${picks.length - pass}`);
for (const x of fails) console.log("   ", x);
