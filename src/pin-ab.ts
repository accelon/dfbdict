#!/usr/bin/env bun
/**
 * stripPin 兩版對照表：把「哪些書名會被剝、剝成什麼」摊開看。
 * 舊版的毛病是尾巴選填 → 凡含體裁字的長書名都從第一個體裁字截斷。
 * 只讀。
 */
const OLD = /^(.{2,12}?(?:經|論|疏|鈔|記|集|章|訣|頌|律|名義|玄義|文句))(?:[一二三四五六七八九十百\d]+)?(?:品|卷|篇|章)?/;
const TAIL = /^(?:[第]?[一二三四五六七八九十百千\d]+(?:[上下中])?|[上下中]|[卷品篇章]|.{1,8}?[卷品篇章])/;
function oldPin(t: string): string {
  const m = t.match(OLD);
  return m && m[1].length >= 2 ? m[1] : t;
}
function newPin(t: string): string {
  const m = t.match(/^(.{2,12}?(?:經|論|疏|鈔|記|集|章|訣|頌|律|名義|玄義|文句))([\s\S]+)$/);
  if (!m) return t;
  return TAIL.test(m[2]) && m[1].length >= 2 ? m[1] : t;
}
const CASES = [
  "法華經譬喻品", "法華經玄義", "法華經文句", "四分律刪繁補闕行事鈔", "四十二章經",
  "大雲經第卅六", "妙法蓮華經", "摩訶止觀", "止觀輔行傳弘決", "大品涅槃經",
  "華嚴經探玄記", "涅槃經名家集", "金剛頂一字頂輪王儀軌經", "佛說觀無量壽佛經",
  "大智度論", "瑜伽師地論本地分", "十住毘婆沙論易行品", "楞嚴經長水疏",
  "無量壽經優婆提願偈", "釋禪波羅密次第坐禪法門", "付法藏因緣傳",
];
console.log("书名".padEnd(24), "旧版剥离".padEnd(16), "新版剥离");
let diff = 0;
for (const c of CASES) {
  const a = oldPin(c), b = newPin(c);
  if (a !== b) diff++;
  console.log(`${c}  →  旧「${a}」 新「${b}」${a !== b ? "   ← 改" : ""}`);
}
console.log(`\n${CASES.length} 例中 ${diff} 例行为改变`);
// 真实题面全量对照：数一数新版少剥了多少条
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const ROOT = resolve(import.meta.dir, "..");
const lines = readFileSync(resolve(ROOT, "out/cite-all.tsv"), "utf8").replace(/\r\n/g, "\n").trim().split("\n").slice(1);
let o = 0, n = 0;
const nowOld = new Map<string, string>();
for (const l of lines) {
  const c = l.split("\t");
  if (c.length < 5) continue;
  const t = (c[2] ?? "").trim().replace(/^(則|即|如|出|見|案|按|又|同|此|是|本|前|次)+/, "");
  const a = oldPin(t), b = newPin(t);
  if (a !== t) { o++; nowOld.set(t, a); }
  if (b !== t) n++;
}
console.log(`全库 ${lines.length} 条题面：旧版剥 ${o} 条、新版剥 ${n} 条（少剥 ${o - n} 条多节书名不再被截断）`);
console.log("旧版剥得最狠的例子：", [...nowOld.entries()].filter(([k, v]) => k.length - v.length >= 4).slice(0, 8).map(([k, v]) => `${k}→${v}`).join("、"));
