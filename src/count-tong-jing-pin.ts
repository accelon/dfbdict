#!/usr/bin/env bun
/** 数「同經＋品名」型題面（同經法師品／此經光明品…）——它们也是回指，但引导词后还有品名。只读。 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const ROOT = resolve(import.meta.dir, "..");
const C = readFileSync(resolve(ROOT, "out/cite-all.tsv"), "utf8").replace(/\r\n/g, "\n").trim().split("\n").slice(1);
const LEAD = /^(同|又|前|次|本|此|是)/;
// 引导词后＝「体裁字 + 任意 1~6 字 + 品/卷/章/篇」，例如「經法師品」「疏序品」。
// 不去枚举汉字（上一版列了 60 个字仍然漏掉「法師」这种，枚举是补不完的），
// 改用量级约束：章题用字一般 1~6 字，超过就像是一整部书名，交回原流程判。
const REST = /^(經|論|疏|記|鈔).{1,6}(品|卷|章|篇)$/;
let n = 0;
const ex = new Map<string, number>();
for (const l of C) {
  const c = l.split("\t");
  if (c.length < 5) continue;
  const t = (c[2] ?? "").trim();
  if (!LEAD.test(t)) continue;
  const rest = t.replace(LEAD, "");
  if (rest === t) continue;
  if (REST.test(rest)) { n++; ex.set(t, (ex.get(t) ?? 0) + 1); }
}
console.log(`「引导词＋体裁字＋品名」型：${n} 条、${ex.size} 种`);
console.log([...ex.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16).map(([k, v]) => `${k}(${v})`).join(" "));
// 顺带看这种题面所在的词条，正文里有没有可回溯的经名
const B = readFileSync(resolve(ROOT, "../fodict/data/佛學大辭典.tsv"), "utf8").split("\n");
const body = new Map<number, string>();
for (let i = 1; i < B.length; i++) { const c = B[i].split("\t"); if (c.length >= 3) body.set(Number(c[0]), c[2].replace(/\\n/g, "")); }
const ents = new Set<number>();
for (const l of C) {
  const c = l.split("\t"); if (c.length < 5) continue;
  const t = (c[2] ?? "").trim();
  if (LEAD.test(t) && REST.test(t.replace(LEAD, ""))) ents.add(Number(c[0]));
}
console.log(`涉及词条 ${ents.size} 条`);
let shown = 0;
for (const e of ents) {
  if (shown++ > 5) break;
  console.log(`  词条 ${e}：${(body.get(e) ?? "").slice(0, 66)}…`);
}
