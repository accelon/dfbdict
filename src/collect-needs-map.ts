#!/usr/bin/env bun
/**
 * 汇编「需要異寫／省稱／注家對照」的書名工作清單：三個來源合流，去重、按出現次數排。
 *   1. out/last-trace.tsv 裡尺二拒掉的繼承來源（真擋過的好書名會被误伤，得先列出来）；
 *   2. title-map 中 kind=对不上 的題面（丁福保写了、我们此前认不出的一切）；
 *   3. title-map 中靠“跳字子序列”才成立的省称（上一轮实测 15 种里 11 种如此，是要拆掉的对象）。
 * 产出 out/needs-map.tsv，供 build-title-overlay.ts 提候选、人工核对。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const norm = (s: string) => s.replace(/[^\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g, "");
const isSubseq = (small: string, big: string) => {
  if (small.length < 2) return false;
  let i = 0;
  for (let j = 0; j < big.length && i < small.length; j++) if (big[j] === small[i]) i++;
  return i === small.length;
};

const want = new Map<string, { n: number; why: Set<string> }>();
const add = (t: string, why: string, n = 1) => {
  const k = t.trim();
  if (!k || k.length < 2) return;
  const cur = want.get(k) ?? { n: 0, why: new Set<string>() };
  cur.n += n;
  cur.why.add(why);
  want.set(k, cur);
};

// 1. 被尺二拒掉的继承来源
try {
  for (const l of readFileSync(resolve(ROOT, "out/last-trace.tsv"), "utf8").split("\n").slice(1)) {
    const c = l.split("\t");
    if (c.length < 5) continue;
    if (c[4] === "n") add(c[2], "回指继承被拒");
  }
} catch { console.log("（无 out/last-trace.tsv，跳过来源 1）"); }

// 2/3. title-map
const tmap = readFileSync(resolve(ROOT, "data/title-map.tsv"), "utf8").replace(/\r\n/g, "\n").trim().split("\n").slice(1);
let noneCnt = 0, jumpCnt = 0;
for (const l of tmap) {
  const c = l.split("\t");
  const [t, n, kind, list] = [c[0], Number(c[1] ?? 0), c[2] ?? "", (c[3] ?? "").split("|").filter(Boolean)];
  if (kind === "对不上") { add(t, "题面对不上", n); noneCnt++; continue; }
  if (kind === "简称展开") {
    const tn = norm(t);
    const contig = list.some((f) => norm(f).includes(tn));
    if (!contig) { add(t, "仅靠跳字成立", n); jumpCnt++; }
  }
}
console.log(`title-map：对不上 ${noneCnt} 种、简称中靠跳字成立 ${jumpCnt} 种`);

const rows = [...want.entries()].sort((a, b) => b[1].n - a[1].n);
writeFileSync(
  resolve(ROOT, "out/needs-map.tsv"),
  ["dfb_name\t出现次数\t为什么需要"].concat(rows.map(([t, v]) => `${t}\t${v.n}\t${[...v.why].join("、")}`)).join("\n") + "\n",
  "utf8",
);
console.log(`合计 ${rows.length} 种 -> out/needs-map.tsv`);
console.log(`Top 40：${rows.slice(0, 40).map(([t, v]) => `${t}(${v.n})`).join(" ")}`);
