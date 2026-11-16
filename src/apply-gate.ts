#!/usr/bin/env bun
/**
 * （三）套闸门：把 check-titles 的保留集落到 backlink 的 matches 上。
 *
 * 不自己重打包——改的是 `build/<slug>-matches.json`，接着用
 * `backlink.ts --reuse --slug <slug>` 走**产品自己的套用＋打包**那段。
 * 理由：锚点的偏移换算、重叠去重、`<聯 i>` 属性转义、caches／resources 沿用
 * 都在 backlink 里，重写一份就会有第二套口径（本项目已经因为「两侧规则不一致」
 * 假报过 401 与 79.5%）。
 *
 * 用法：bun src/apply-gate.ts <slug>
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const BUILD = resolve(ROOT, "../adb-converter/build");
const slug = process.argv[2];
if (!slug) {
  console.error("用法: bun src/apply-gate.ts <slug>");
  process.exit(2);
}

const keepPath = resolve(ROOT, `out/gate-keep-${slug}.json`);
const matchesPath = resolve(BUILD, `${slug}-matches.json`);
const archived = resolve(ROOT, `out/matches/${slug}-matches.json`);

for (const p of [keepPath, matchesPath, archived]) {
  if (!existsSync(p)) throw new Error(`缺档：${p}`);
}
// 只吃刚跑完那一批的档：out/matches 里的副本必须与 build/ 里逐字节相同，
// 否则说明中途有别的批次覆盖过，宁停不比。
const cur = readFileSync(matchesPath);
const old = readFileSync(archived);
if (cur.compare(old) !== 0) throw new Error(`build/${slug}-matches.json 与 out/matches 副本不一致，拒绝套用`);

const keep = new Set<number>(JSON.parse(readFileSync(keepPath, "utf8")) as number[]);
const matches = JSON.parse(cur.toString("utf8")) as { qIndex: number; anchor: string }[];
const kept = matches.filter((m) => keep.has(m.qIndex) && m.anchor);
console.log(`matches ${matches.length} → 保留 ${kept.length}（剔除 ${matches.length - kept.length}）；keep 集 ${keep.size}`);
if (kept.length === 0) throw new Error("保留集为空，拒绝产出空链库");
if (kept.length === matches.length) console.log("  注意：闸门没有剔掉任何一条，检查 gate-keep 是否来自同批次");

// 备份原始 matches，写过滤后的到 matches 位置（backlink --reuse 只认这个名字）
writeFileSync(resolve(ROOT, `out/matches/${slug}-matches-all.json`), cur);
writeFileSync(matchesPath, JSON.stringify(kept, null, 1), "utf8");
console.log(`-> 已把过滤后的 matches 放回 ${matchesPath}\n   原始档留档：out/matches/${slug}-matches-all.json`);
