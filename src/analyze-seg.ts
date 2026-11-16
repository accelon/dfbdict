#!/usr/bin/env bun
/**
 * <段/> 分段可行性分析（只读，不改档）。
 *
 * 丁福保词条里的「（一）（二）（三）」有两种互不兼容的用法：
 *   A 义项首：「…其說有二：（一）極短促之時刻也。…（二）思念對境一次也。」→ 该在该序号前分段
 *   B 尾注：  「…是即名為一相法門（一）。師子勇猛…（二）。」→ 序号是上一句的附注，切了会把句子截断
 * 判準（客观化、可复算）：
 *   前有句读边界 BOUND = [。．：；！？）」』】]  → 候选可切
 *   後緊接 STOP    = [。，、；：）]              → 是尾注，不切
 * 两个条件同时成立才算「义项首」。既不满足前界、或落在尾注者，一律不动（宁少切不乱切）。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const TSV = process.argv[2] ?? resolve(ROOT, "../fodict/data/佛學大辭典.tsv");

const BOUND = /[。．：；！？）」』】]/;
const STOP = /[。，、；：）]/;
// 全形括号序号；丁福保不用 (1) 这类半形写法（扫过：半形 0 命中）
const ENUM = /（[一二三四五六七八九十]{1,3}）/g;

type Row = { id: number; head: string; body: string };
const rows: Row[] = [];
{
  const lines = readFileSync(TSV, "utf8").split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  lines.shift(); // header
  for (const l of lines) {
    const c = l.split("\t");
    if (c.length < 3) throw new Error(`列数不足: ${l.slice(0, 40)}`);
    rows.push({ id: Number(c[0]), head: c[1], body: c[2].replace(/\\n/g, "\n") });
  }
}
console.log(`词条 ${rows.length} 条`);

type Occ = {
  id: number; head: string; at: number; mark: string;
  before: string; after: string; lead: boolean; inQuote: boolean; ctx: string;
};
const occs: Occ[] = [];
const perEntry = new Map<number, { lead: number; trail: number }>();

for (const r of rows) {
  const chars = [...r.body];
  ENUM.lastIndex = 0;
  let m: RegExpExecArray | null;
  // 用字符索引而非字节索引，避免中文错位
  while ((m = ENUM.exec(chars.join(""))) !== null) {
    const at = m.index;
    let i = at - 1;
    while (i >= 0 && /[\s　]/.test(chars[i])) i--;
    const before = i >= 0 ? chars[i] : "";
    const after = chars[at + m[0].length] ?? "";
    const lead = before !== "" && BOUND.test(before) && !STOP.test(after);
    const rec = perEntry.get(r.id) ?? { lead: 0, trail: 0 };
    if (lead) rec.lead++; else rec.trail++;
    perEntry.set(r.id, rec);
    occs.push({
      id: r.id, head: r.head, at, mark: m[0], before, after, lead,
      inQuote: quotes(chars, at),
      ctx: chars.slice(Math.max(0, at - 18), at + m[0].length + 18).join(""),
    });
  }
}
function quotes(chars: string[], pos: number): boolean {
  let d = 0;
  for (let i = 0; i < pos; i++) {
    if (chars[i] === "「") d++;
    else if (chars[i] === "」") d = Math.max(0, d - 1);
  }
  return d > 0;
}

const lead = occs.filter((o) => o.lead);
const trail = occs.filter((o) => !o.lead);
const pureLead = [...perEntry.entries()].filter(([, v]) => v.lead > 0 && v.trail === 0);
const pureTrail = [...perEntry.entries()].filter(([, v]) => v.lead === 0 && v.trail > 0);
const mixed = [...perEntry.entries()].filter(([, v]) => v.lead > 0 && v.trail > 0);

console.log(`序号出现 ${occs.length} 处，涉及 ${perEntry.size} 条`);
console.log(`  义项首（可切） ${lead.length}`);
console.log(`    其中落在「」引文内 ${lead.filter((o) => o.inQuote).length}`);
console.log(`    位于行首（本来就自成一段） ${lead.filter((o) => o.before === "" || /^\n/.test(o.ctx)).length}`);
console.log(`  尾注／边界不明（不动） ${trail.length}`);
console.log(`条目级：纯义项首 ${pureLead.length}、纯尾注 ${pureTrail.length}、混合 ${mixed.length}`);

const beforeNonSpace = occs.filter((o) => o.before === "").length;
console.log(`序号前无正文（词条开头就有序号） ${beforeNonSpace}`);

// 前后各取 10 例给人看，确认判準没跑偏
const dump = (title: string, list: Occ[]) => {
  console.log(`\n--- ${title} ---`);
  for (const o of list.slice(0, 10)) console.log(`  ${o.id} ${o.head}｜前「${o.before}」後「${o.after}」${o.inQuote ? "｜引文内" : ""}  …${o.ctx}…`);
};
dump("会切（义项首）样例", lead);
dump("不切（尾注／边界不明）样例", trail);

writeFileSync(
  resolve(ROOT, "out/seg-plan.tsv"),
  ["id\thead\tmark\tbefore\tafter\tlead\tinQuote\tcontext"].concat(
    occs.map((o) => [o.id, o.head, o.mark, o.before, o.after, o.lead ? "Y" : "N", o.inQuote ? "Y" : "N", o.ctx].join("\t")),
  ).join("\n") + "\n", "utf8",
);
console.log("\n-> out/seg-plan.tsv");
