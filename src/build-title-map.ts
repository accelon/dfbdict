#!/usr/bin/env bun
/**
 * （二）前置：把「先引文查询、再核对经名」所需的两个东西量出来、建出来。
 *   1. 回指（同經/同前/又/次/本…）有多少——这类引文的“书名”不是书名，
 *      必须先解析成上一条已确定的经，否则挑本经会挑错（backlink 用“引文前 30 字
 *      与大正 書 标题的最长共同子串”优先挑本经，遇到“同經”就失效）。
 *   2. 简称对照表：用 taisho.adb / wxzj.adb 自己的 `書` 标题做词表，
 *      把丁福保写的简称（法華經 → 妙法蓮華經）对回去；一对多的标为歧义，不硬选。
 * 只读，不改任何 adb。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { openAdb } from "../../adb-converter/ts/tools/adb-skill/engine";

const quotes = readFileSync("out/cite-all.tsv", "utf8").replace(/\r\n/g, "\n").trim().split("\n").slice(1).map((l) => {
  const c = l.split("\t");
  return { id: Number(c[0]), head: c[1] ?? "", title: c[2] ?? "", juan: c[3] ?? "", text: c[4] ?? "" };
});
console.log(`引文 ${quotes.length} 条`);

// ---- 1. 回指形态 ----
const ANA = /^(同|又|前|次|本|此|是|上述|已見|已见|上|經前|前經)/;
const ana = quotes.filter((q) => ANA.test(q.title));
const anaTitles = new Map<string, number>();
for (const q of ana) anaTitles.set(q.title, (anaTitles.get(q.title) ?? 0) + 1);
console.log(`\n[回指] ${ana.length} 条（${((ana.length / quotes.length) * 100).toFixed(1)}%）书名位是回指词`);
console.log(`  Top: ${[...anaTitles.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k}(${v})`).join(" ")}`);

// ---- 2. 语料书名表 ----
const corpora: { db: string; label: string; titles: string[] }[] = [];
for (const [path, label] of [["D:/accelon3/taisho.adb", "taisho"], ["D:/accelon3/wxzj.adb", "wxzj"]] as const) {
  const db = await openAdb(path);
  const t = (await db.reader.cachedStrings("書")) as string[];
  corpora.push({ db: label, label, titles: t });
  console.log(`\n[${label}] cachedStrings('書') = ${t.length} 部；样例：${t.slice(0, 3).join(" | ")}`);
  db.reader.close?.();
}
const allTitles = new Map<string, string[]>();
for (const c of corpora) for (const t of c.titles) {
  const clean = t.replace(/\s+/g, "");
  if (!allTitles.has(clean)) allTitles.set(clean, []);
  allTitles.get(clean)!.push(c.db);
}
console.log(`\n语料书名去重 ${allTitles.size} 种`);

// 丁福保题名 → 语料书名：先精确，再“简称是全称的子串”
const titleSet = new Map<string, number>();
for (const q of quotes) titleSet.set(q.title, (titleSet.get(q.title) ?? 0) + 1);
const exact: string[] = [];
const abbr = new Map<string, string[]>();
const none: string[] = [];
for (const [t, n] of titleSet) {
  if (allTitles.has(t)) {
    exact.push(t);
    continue;
  }
  // 简称：去掉“經/論”等尾缀后是否为某全称的子串；要求 t 至少 3 字以免误配
  const cands = t.length >= 3 ? [...allTitles.keys()].filter((full) => full.includes(t) && full !== t) : [];
  if (cands.length) abbr.set(t, cands);
  else none.push(t);
}
console.log(`\n[题名对照] 丁福保题名 ${titleSet.size} 种：精确命中 ${exact.length}、简称可展开 ${abbr.size}、对不上 ${none.length}`);
console.log(`  覆盖引文条数：精确 ${[...exact].reduce((a, t) => a + (titleSet.get(t) ?? 0), 0)}、简称 ${[...abbr.keys()].reduce((a, t) => a + (titleSet.get(t) ?? 0), 0)}、对不上 ${none.reduce((a, t) => a + (titleSet.get(t) ?? 0), 0)}`);
const amb = [...abbr.entries()].filter(([, v]) => v.length > 1);
console.log(`  简称歧义（一对多）${amb.length} 种，例：${amb.slice(0, 6).map(([k, v]) => `${k}→${v.slice(0, 3).join("/")}`).join("  ")}`);
console.log(`  简称无歧义例：${[...abbr.entries()].filter(([, v]) => v.length === 1).slice(0, 8).map(([k, v]) => `${k}→${v[0]}`).join("  ")}`);
console.log(`  对不上例（前 20）：${none.slice(0, 20).join("、")}`);

writeFileSync(
  "data/title-map.tsv",
  ["dfb_title\tcount\tkind\tcorpus_titles\tambiguous"].concat(
    [...titleSet.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([t, n]) => {
        const kind = allTitles.has(t) ? "精确" : abbr.has(t) ? "简称展开" : "对不上";
        const list = allTitles.has(t) ? [t] : abbr.get(t) ?? [];
        return `${t}\t${n}\t${kind}\t${list.slice(0, 6).join("|")}\t${list.length > 1 ? "是" : ""}`;
      })
  ).join("\n") + "\n",
  "utf8"
);
writeFileSync(
  "data/title-anaphora.tsv",
  ["entryid\theadword\tanaphora_token\tjuan\tquote_head"].concat(ana.map((q) => `${q.id}\t${q.head}\t${q.title}\t${q.juan}\t${q.text.slice(0, 40)}`)).join("\n") + "\n",
  "utf8"
);
console.log("\n-> data/title-map.tsv（题名对照）、data/title-anaphora.tsv（回指清单）");
