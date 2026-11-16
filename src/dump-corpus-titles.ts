#!/usr/bin/env bun
/**
 * 落盘两库的完整书名表（大正藏＋卍续藏），供「省称／异写／注家代称」对照用。
 * 以前这张表只在 build-title-map.ts 内存里用一次就丢了，导致：
 *   · sound 尺只能拿 backlink 命中过的 907 部当词表（覆盖不全，省称判不出来）；
 *   · 想核「玄应音义→一切经音义」这类对照时没有全量底表可查。
 * 只读 adb，产出 data/corpus-titles.tsv。
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { openAdb } from "../../adb-converter/ts/tools/adb-skill/engine";

const ROOT = resolve(import.meta.dir, "..");
const sources = [
  ["D:/accelon3/taisho.adb", "taisho"],
  ["D:/accelon3/wxzj.adb", "wxzj"],
] as const;

const map = new Map<string, Set<string>>();
for (const [path, label] of sources) {
  const t0 = Date.now();
  const db = await openAdb(path);
  const titles = (await db.reader.cachedStrings("書")) as string[];
  console.log(`${label}：cachedStrings('書') = ${titles.length} 部（${((Date.now() - t0) / 1000).toFixed(0)}s）`);
  for (const t of titles) {
    const clean = t.replace(/\s+/g, "");
    if (!clean) continue;
    if (!map.has(clean)) map.set(clean, new Set());
    map.get(clean)!.add(label);
  }
  db.reader.close?.();
}
const rows = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], "ja"));
writeFileSync(
  resolve(ROOT, "data/corpus-titles.tsv"),
  ["title\tcorpora\tlen"].concat(rows.map(([t, s]) => `${t}\t${[...s].join(",")}\t${[...t].length}`)).join("\n") + "\n",
  "utf8",
);
console.log(`去重后 ${rows.size ?? rows.length} 种 -> data/corpus-titles.tsv`);
const lenHist = new Map<number, number>();
for (const [t] of rows) lenHist.set([...t].length, (lenHist.get([...t].length) ?? 0) + 1);
console.log(`长度分布：${[...lenHist.entries()].sort((a, b) => a[0] - b[0]).slice(0, 14).map(([k, v]) => `${k}字:${v}`).join(" ")}`);
console.log(`样例：${rows.slice(0, 6).map(([t]) => t).join(" | ")}`);
