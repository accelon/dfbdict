// 抽検：把指定詞頭在建庫輸出裡的正文打出来，肉眼核対 diacritic→Unicode 是否真的生效。
import { readFileSync } from "node:fs";
const lines = readFileSync("out/dfb-lines.txt", "utf8").replace(/\r\n/g, "\n").split("\n");
const want = process.argv.slice(2);
for (const h of want) {
  const i = lines.findIndex((l) => new RegExp(`^<詞 [^>]*>${h}</詞>$`).test(l));
  if (i < 0) { console.log(`### ${h}：未找到`); continue; }
  const body: string[] = [];
  for (let k = i + 1; k < lines.length; k++) {
    if (/^<詞 /.test(lines[k]) || /^<\/檔/.test(lines[k])) break;
    if (lines[k] === "") continue;
    body.push(lines[k]);
  }
  console.log(`\n### ${h}  （${body.length} 行）`);
  for (const b of body.slice(0, 4)) console.log("   ", b.length > 170 ? b.slice(0, 170) + "…" : b);
}
