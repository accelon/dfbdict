#!/usr/bin/env bun
/**
 * 給「認不出的書名」找候選全稱，**只准用連字證據**（跳字子序列一律不算）：
 *
 *   R1 削尾：丁福保常在書名後掛卷次／品次（行事鈔下、資持記上、秘藏記末、
 *      唯識述記一本、法華經序品），先削掉尾上的 上中下末本＋數字＋卷品篇章，
 *      再看削出來的字符串是否**連字**出現在某部語料書名裡。
 *   R2 異寫偵測：R1 無解時，找「等長且只差一個字」的語料書名，把差異字對
 *      報出來——這是從資料裡長出來的異寫表（一↔壹 這類），不是我憑記憶編的。
 *
 * 輸出是**候選**，要人工核過才進 data/title-master.tsv。
 * 用法：bun run src/make-title-overlay.ts [topN=140]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const norm = (s: string) => s.replace(/[^\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g, "");

const corpus = readFileSync(resolve(ROOT, "data/corpus-titles.tsv"), "utf8").replace(/\r\n/g, "\n").trim().split("\n").slice(1).map((l) => l.split("\t")[0]);
const corpusN = corpus.map((c) => ({ raw: c, n: norm(c) }));
console.log(`语料书名 ${corpus.length} 部`);

const needs = readFileSync(resolve(ROOT, "out/needs-map.tsv"), "utf8").replace(/\r\n/g, "\n").trim().split("\n").slice(1)
  .map((l) => { const c = l.split("\t"); return { name: c[0], n: Number(c[1] ?? 0), why: c[2] ?? "" }; });

const TOP = Number(process.argv[2] ?? 140);
const TAIL_VOL = /[上中下末卷品篇章]+$|[一二三四五六七八九十百\d]+$/;
/** 逐层削尾：最多削 4 个字符，避免把书名本体削掉 */
function trims(t: string): string[] {
  const out = [t];
  let s = t;
  for (let i = 0; i < 4; i++) {
    const next = s.replace(TAIL_VOL, "");
    if (!next || next === s || [...next].length < 2) break;
    out.push(next);
    s = next;
  }
  return out;
}
const rows: string[] = [];
const variants = new Map<string, number>();
let uniq = 0, multi = 0, none = 0;
for (const k of needs.slice(0, TOP)) {
  const nm = norm(k.name);
  let picked = "", via = "", trimmed = "";
  for (const t of trims(nm)) {
    const hits = corpusN.filter((c) => c.n.includes(t));
    if (hits.length) {
      trimmed = t === nm ? "" : `（削尾→${t}）`;
      via = hits.length === 1 ? "连字·唯一" : `连字·${hits.length}家`;
      picked = hits.slice(0, 4).map((h) => h.raw).join(" | ");
      break;
    }
  }
  if (!picked) {
    // R2：等長、只差一個字 → 報異寫對
    const near: string[] = [];
    for (const c of corpusN) {
      if (c.n.length !== nm.length) continue;
      const diff: string[] = [];
      for (let i = 0; i < nm.length; i++) if (nm[i] !== c.n[i]) diff.push(`${nm[i]}/${c.n[i]}`);
      if (diff.length === 1) { near.push(`${c.raw}[${diff[0]}]`); variants.set(diff[0], (variants.get(diff[0]) ?? 0) + 1); }
      if (near.length >= 3) break;
    }
    if (near.length) { picked = near.join(" | "); via = "异写候选"; }
    else { picked = "（无语料连字对应）"; via = "无"; }
  }
  if (via === "连字·唯一") uniq++; else if (via.startsWith("连字·")) multi++; else none++;
  rows.push([k.name, String(k.n), via, trimmed, picked].join("\t"));
}
writeFileSync(
  resolve(ROOT, "out/title-candidates.tsv"),
  ["dfb_name\t出现\t证据\t削尾\t语料候选"].concat(rows).join("\n") + "\n",
  "utf8",
);
console.log(`前 ${Math.min(TOP, needs.length)} 种：唯一连字 ${uniq}、多义 ${multi}、无解 ${none} -> out/title-candidates.tsv`);
console.log(`\n异写候选（等长且仅差一字，按出现次数）：${[...variants.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24).map(([k, v]) => `${k}(${v})`).join(" ")}`);
console.log("\n前 45 条：");
for (const r of rows.slice(0, 45)) {
  const c = r.split("\t");
  console.log(`  ${c[0]}(${c[1]}) ${c[2]}${c[3]} → ${c[4].slice(0, 92)}`);
}
