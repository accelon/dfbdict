#!/usr/bin/env bun
/**
 * 三版規則的逐行判定差分：不比較巨觀百分比（那個會把「A 修好的」與「B 弄壞的」
 * 加在一起互相抵銷，看不出改動到底做了什麼），逐 qIndex 比對 verdict 欄位。
 * 只讀。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const load = (f: string) => {
  const m = new Map<string, { want: string; book: string; v: string; how: string }>();
  for (const l of readFileSync(resolve(ROOT, f), "utf8").replace(/\r\n/g, "\n").trim().split("\n").slice(1)) {
    const c = l.split("\t");
    if (c.length < 7) continue;
    m.set(c[0], { want: c[2], book: c[3], v: c[6], how: c[7] ?? "" });
  }
  return m;
};
const V0 = load("out/gate-ab/verdicts-W0.tsv"); // 今天已產出那版（無光杆一字、舊品名剝離）
const V1 = load("out/gate-ab/verdicts-W1.tsv"); // +光杆一字回指
const V2 = load("out/gate-ab/verdicts-W2.tsv"); // +光杆一字 +新版品名剝離
console.log(`行數 V0 ${V0.size}、V1 ${V1.size}、V2 ${V2.size}`);

const GOOD = new Set(["一致", "简称/异写一致"]);
const BAD = new Set(["不符"]);
function diff(a: Map<string, any>, b: Map<string, any>, la: string, lb: string, examples = 6) {
  let up = 0, down = 0, moved = 0;
  const ups: string[] = [], downs: string[] = [];
  for (const [k, x] of a) {
    const y = b.get(k);
    if (!y || y.v === x.v) continue;
    if (GOOD.has(y.v) && BAD.has(x.v)) { up++; if (ups.length < examples) ups.push(`${k} 词条见下｜「${x.want}」→「${y.want}」vs ${y.book}`); }
    else if (GOOD.has(x.v) && BAD.has(y.v)) { down++; if (downs.length < examples) downs.push(`${k}｜「${x.want}」→「${y.want}」vs ${y.book}`); }
    else moved++;
  }
  console.log(`\n${la} → ${lb}：轉好 ${up}、轉壞 ${down}、同類互轉 ${moved}`);
  for (const x of ups) console.log("   ↑ " + x);
  for (const x of downs) console.log("   ↓ " + x);
  return { up, down, moved };
}
diff(V0, V1, "V0", "V1");
diff(V1, V2, "V1", "V2");
diff(V0, V2, "V0", "V2");

// 作者點名的兩條 + 本次新覆蓋的代表條：逐條報狀態
const WATCH = new Map<number, string>([
  [60, "同經 → 佛說阿彌陀經"], [61, "同品 → 法華經"], [219, "同品 → 法華經"],
  [4410, "中 → 往生要集"], [5242, "偈"], [864, "同註/同什註 → 注維摩詰經"],
  [2082, "註 → 注維摩詰經"], [15061, "偈 → 法華經"], [16409, "同中 → 資持記"],
  [21838, "四十二章經（該剔）"],
]);
console.log("\n=== 點名條目的最終判定（V2）===");
for (const l of readFileSync(resolve(ROOT, "out/gate-ab/verdicts-W2.tsv"), "utf8").split("\n").slice(1)) {
  const c = l.split("\t");
  if (c.length < 8) continue;
  const note = WATCH.get(Number(c[1]));
  if (!note) continue;
  console.log(`  词条 ${c[1]}《${note}》→ 期望「${c[2]}」命中「${c[3]}」＝ ${c[6]}（${c[7]}）`);
}
