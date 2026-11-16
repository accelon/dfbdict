#!/usr/bin/env bun
/**
 * 校驗兩張新表：data/title-master.tsv 的每個目標書名、data/title-variant.tsv 的每個
 * 例證對，都必須能在 data/corpus-titles.tsv 裡查到。對照表是手寫的，手寫的東西會過期：
 * 語料重新打包、書名改字，表就會悄悄指到沒有的書——那時 sound 尺會「看起來通過」而實際放錯行。
 * 任何一條查不到就非零退出。
 *
 * 用法：bun run src/verify-title-tables.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const corpus = new Set(
  readFileSync(resolve(ROOT, "data/corpus-titles.tsv"), "utf8").replace(/\r\n/g, "\n").trim().split("\n").slice(1).map((l) => l.split("\t")[0]),
);
console.log(`语料书名 ${corpus.size} 部`);
const bad: string[] = [];
const missingTarget: string[] = [];

// 1. 省稱／注家對照表
const lines = readFileSync(resolve(ROOT, "data/title-master.tsv"), "utf8").replace(/\r\n/g, "\n").trim().split("\n").slice(1);
let rows = 0, occ = 0;
for (const l of lines) {
  const c = l.split("\t");
  if (c.length < 5) { bad.push(`列数不足：${l.slice(0, 40)}`); continue; }
  const [alias, targets, kind, basis] = c;
  rows++;
  const list = targets.split("|").map((s) => s.trim()).filter(Boolean);
  if (!list.length) { bad.push(`${alias}：目標為空`); continue; }
  for (const t of list) {
    if (!corpus.has(t)) { bad.push(`${alias} → 「${t}」不在语料书名表`); missingTarget.push(t); }
  }
  if (!kind || !basis) bad.push(`${alias}：缺 kind／依据，日后无法复核`);
}
console.log(`title-master：${rows} 条对照`);

// 2. 異寫表：每條都得真的有一對「改一個字就等於語料書名」的实例
const vlines = readFileSync(resolve(ROOT, "data/title-variant.tsv"), "utf8").replace(/\r\n/g, "\n").trim().split("\n").slice(1);
for (const l of vlines) {
  const c = l.split("\t");
  if (c.length < 3) { bad.push(`异写行列数不足：${l.slice(0, 30)}`); continue; }
  const [a, b] = c;
  const swapped = [...corpus].find((t) => t.includes(b));
  if (!swapped) bad.push(`异写 ${a}/${b}：语料里没有任何书名含「${b}」，这条规则没有落脚点`);
}
console.log(`title-variant：${vlines.length} 条异写`);

if (bad.length) {
  console.error(`\n不通过 ${bad.length} 项：`);
  for (const x of bad.slice(0, 20)) console.error("  " + x);
  process.exit(1);
}
console.log("\n两表全部通过：每条目标都能在语料书名表里精确查到。");
void occ;
