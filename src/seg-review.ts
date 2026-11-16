#!/usr/bin/env bun
/**
 * 分段人工複核清單：把 66 條受影響的詞條，前後對照列出來。
 * 對照基準是上一版（未分段）的中間檔，不是憑記憶写的「原本長這樣」。
 * 產出 out/seg-review.md（可勾選：每條前面一個 `- [ ]`，核過就打勾）。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const OLD = resolve(ROOT, "out/matches/dfb-v2-text.txt");
const NEW = resolve(ROOT, "out/matches/dfb-v3-text.txt");
const SEG = "<段/>";

const a = readFileSync(OLD, "utf8").replace(/\r\n/g, "\n").split("\n");
const b = readFileSync(NEW, "utf8").replace(/\r\n/g, "\n").split("\n");
if (a.length !== b.length) throw new Error(`兩版行數不同（${a.length} vs ${b.length}），無法逐行對照`);

// 行號 → 詞條 id／詞頭
let id = 0, head = "";
const owner: string[] = [];
for (const l of b) {
  const m = l.match(/^<詞 id="(\d+)"(?:[^>]*)>(.*)<\/詞>$/);
  if (m) { id = Number(m[1]); head = m[2]; }
  owner.push(`${id} ${head}`);
}

const rows: { line: number; entry: string; before: string; after: string; n: number }[] = [];
for (let i = 0; i < b.length; i++) {
  if (!b[i].includes(SEG)) continue;
  const plain = b[i].split(SEG).join("");
  if (a[i] !== plain) {
    let p = 0;
    while (p < a[i].length && p < plain.length && a[i][p] === plain[p]) p++;
    throw new Error(`行 ${i + 1} 不是純插入：舊「…${a[i].slice(p, p + 30)}」vs 新去標記「…${plain.slice(p, p + 30)}」`);
  }
  rows.push({
    line: i + 1, entry: owner[i], before: a[i], after: b[i],
    n: (b[i].match(/<段\/>/g) ?? []).length,
  });
}

const cutTotal = rows.reduce((s, r) => s + r.n, 0);

// 重新生成時要留住人工已打過的勾：以「詞條 id＋行號」為鍵回掃舊清單。
const REVIEW = resolve(ROOT, "out/seg-review.md");
const done = new Set<string>();
try {
  for (const m of readFileSync(REVIEW, "utf8").matchAll(/^- \[x\] \*\*(\d+) [^*]*\*\*（行 (\d+)）/gm)) {
    done.add(`${m[1]}@${m[2]}`);
  }
} catch { /* 首輪沒有舊檔 */ }
const checked = rows.filter((r) => done.has(`${r.entry.split(" ")[0]}@${r.line}`)).length;
// 百分比用 half-up 整數（不用 Math.round 對 .5 的銀行家行為？这里就是 half-up），並處理 total=0
const pct = rows.length ? Math.floor((checked / rows.length) * 100 + 0.5) : 0;

const md: string[] = [
  "# `<段/>` 義項分段複核清單",
  "",
  `- 受影響詞條行：**${rows.length} 行**，插入標記 **${cutTotal} 處**`,
  "- 對照基準：`out/matches/dfb-v2-text.txt`（上一版中間檔）。每行都驗過「新版去掉 `<段/>` 等於舊版」，不是抄記憶。",
  "- 判準：序號前有句讀邊界 `[。．：；！？）」』】]`、且其後第一個可見字不是 `[。，、；：）]`，才算義項首、才切。",
  "- 核過一條就把該行的 `- [ ]` 改成 `- [x]`，再跑 `bun src/seg-review.ts` 重生本檔（打勾會保留）。",
  `- 進度：已核對 ${checked} 處／待核對 ${rows.length - checked} 處（總 ${rows.length}，${pct}%）`,
  "",
];
for (const r of rows) {
  const key = `${r.entry.split(" ")[0]}@${r.line}`;
  md.push(`- [${done.has(key) ? "x" : " "}] **${r.entry}**（行 ${r.line}，切 ${r.n} 段）`);
  md.push(`  - 舊：${r.before}`);
  md.push(`  - 新：${r.after}`);
  md.push("");
}
writeFileSync(REVIEW, md.join("\n"), "utf8");
console.log(`${rows.length} 行、${cutTotal} 处标记（已核对 ${checked}）-> out/seg-review.md`);
for (const r of rows.slice(0, 3)) console.log(`  ${r.entry}：切 ${r.n} 段`);
