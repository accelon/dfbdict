// 找 <段 n> 的实际发射手法：扫母区文字中间档与产生器源码，命中就打印原文。
import { readdirSync, readFileSync, existsSync } from "node:fs";

const dirs = ["../dfbdict/out/matches", "build", "ts/src/accelon26", "cmd/tei2adb", "ts/src"];
const hits: string[] = [];
for (const d of dirs) {
  if (!existsSync(d)) continue;
  for (const f of readdirSync(d, { withFileTypes: true })) {
    if (!f.isFile()) continue;
    if (!/\.(txt|go|ts|json)$/.test(f.name)) continue;
    const p = `${d}/${f.name}`;
    let t = "";
    try { t = readFileSync(p, "utf8"); } catch { continue; }
    if (!t.includes("<段 n=")) continue;
    const lines = t.split("\n").filter((l) => l.includes("<段 n=")).slice(0, 2);
    hits.push(`${p}: 命中 ${t.split("<段 n=").length - 1} 处`);
    for (const l of lines) hits.push("    " + l.slice(0, 150));
    // 看闭合方式
    const closed = /<段 n="[^"]*">[^<]{0,80}<\/段>/.exec(t);
    if (closed) hits.push("    闭合例: " + closed[0].slice(0, 120));
  }
}
console.log(hits.length ? hits.join("\n") : "未在扫过的目录里找到 <段 n=>");
