#!/usr/bin/env bun
/**
 * 把②（只有卷次/品次）与③（注家·注書省稱）两型的判定逐条摊开看，
 * 附上词条正文里那个题面出现的位置与前后的文字——**眼见**过再决定要不要改规则。
 * 只读。
 *
 * 用法：bun run src/peek-classes.ts [slug=dfb-v3]
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const SLUG = process.argv[2] ?? "dfb-v3";

const VOL = /^(第?[一二三四五六七八九十百千0-9]+|卷[第]?[一二三四五六七八九十百千0-9]+|上|中|下|上卷|中卷|下卷|前卷|後卷|本卷|初|末)$/;
const PIN2 = /^(第?[一二三四五六七八九十百千0-9]+)?(品|章|句|偈|喻|分|集|卷|篇)$/;
const COM = /^(輔行|嘉祥|凈影|淨影|章安|智者|荆溪|圭峰|溫陵|圓暉|測疏|新疏|舊疏|疏主|記主|鈔主|演|述|贊|註|注|序|引|解|義|判|要|玄義|文句|釋文|音義|行記|傳|論|律|疏|記|鈔|集)$/;

const body = new Map<number, string>();
{
  const lines = readFileSync(resolve(ROOT, "../fodict/data/佛學大辭典.tsv"), "utf8").split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split("\t");
    if (c.length < 3) throw new Error(`释文源第 ${i + 1} 行列数不足`);
    body.set(Number(c[0]), c[2].replace(/\\n/g, ""));
  }
}
const rows = readFileSync(resolve(ROOT, `out/title-verdicts-${SLUG}.tsv`), "utf8").replace(/\r\n/g, "\n").trim().split("\n").slice(1);

const list: { cls: string; drop: boolean; entry: string; want: string; book: string; ctx: string }[] = [];
for (const l of rows) {
  const c = l.split("\t");
  if (c.length < 7) continue;
  const [, entry, want, book, , , verdict, how] = c;
  if (how && how.startsWith("回指")) continue;
  const cls = VOL.test(want) || PIN2.test(want) ? "②" : COM.test(want) ? "③" : "";
  if (!cls) continue;
  const t = body.get(Number(entry)) ?? "";
  const at = t.lastIndexOf(want);
  list.push({
    cls, drop: verdict === "不符", entry, want, book,
    ctx: at >= 0 ? t.slice(Math.max(0, at - 16), at + want.length + 16) : t.slice(0, 34),
  });
}
const drops = list.filter((x) => x.drop);
console.log(`②③两型共 ${list.length} 个锚点，其中现判「不符」被剔 ${drops.length}`);
for (const g of [["②", "只有卷次/品次"], ["③", "注家·注書省稱"]] as const) {
  const sub = drops.filter((x) => x.cls === g[0]);
  console.log(`\n--- ${g[0]} ${g[1]}：被剔 ${sub.length}，共 ${list.filter((x) => x.cls === g[0]).length} ---`);
  for (const x of sub.slice(0, 14)) console.log(`  词条 ${x.entry}｜题面「${x.want}」vs 命中「${x.book}」\n      正文 …${x.ctx}…`);
}
