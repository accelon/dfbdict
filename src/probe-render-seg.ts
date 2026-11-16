// 证明「资料层 → 渲染层」这一段真的会分段：拿 dfb 真实那一行喂给产品自己的渲染器。
import { Accelon3Renderer } from "../../adb-converter/ts/src/accelon26/render_accelon3";
import { readFileSync } from "node:fs";

const lines = readFileSync("out/dfb-lines.txt", "utf8").split("\n");
const hit = lines.find((l) => l.includes("<段/>"));
if (!hit) throw new Error("dfb-lines.txt 里没有 <段/>，探针无对象");
const ctxOf = () => ({ depthOf: new Map<string, number>(), levels: 0 });

for (const indent of [true, false]) {
  const r = new Accelon3Renderer(ctxOf(), { dictEntries: true, indent });
  const { html } = r.lineInfo(hit, 1);
  const br = (html.match(/<br class="para">/g) ?? []).length;
  const pi = (html.match(/class="paraIndent"/g) ?? []).length;
  const segChip = html.includes("segChip");
  console.log(`indent=${indent}：para 断行 ${br}、缩排 ${pi}、¶ 晶片 ${segChip}；<段/> 残留 ${html.includes("<段")}`);
}
console.log(`样例行：${hit.slice(0, 60)}…`);
// 反面对照：不带 n 的 <段/> 不该长出可点的段码晶片（那是巴利藏跨库对读用的）
const r2 = new Accelon3Renderer(ctxOf(), { dictEntries: true, indent: true });
const withN = r2.lineInfo(hit.replace(/<段\/>/g, '<段 n="1"/>'), 1);
console.log(`对照 <段 n="1"/>：会多长 ¶ 晶片 = ${withN.html.includes("segChip")}（所以我们发的是不带 n 的形式）`);
