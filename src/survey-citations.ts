// （二）前置测量：丁福保书证到底能不能对到大正/卍续，以及能对上的比例。
// 不猜：先把引文语料切出来、量长度分布与卷数形态，再抽样去 taisho.adb / wxzj.adb 实搜。
import { readFileSync, writeFileSync } from "node:fs";
import { openAdb } from "../../adb-converter/ts/tools/adb-skill/engine";

const unesc = (s: string) => {
  let o = "";
  for (let k = 0; k < s.length; k++) {
    if (s[k] === "\\" && k + 1 < s.length) {
      const n = s[++k];
      o += n === "n" ? "\n" : n === "t" ? "\t" : n;
      continue;
    }
    o += s[k];
  }
  return o;
};

const rows: { id: number; head: string; body: string }[] = [];
{
  const lines = readFileSync("data/dfb.tsv", "utf8").replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.startsWith("entryid")) lines.shift();
  for (const l of lines) {
    if (!l.trim()) continue;
    const c = l.split("\t");
    if (c.length < 3) continue;
    rows.push({ id: Number(c[0]), head: unesc(c[1] ?? ""), body: unesc(c[2] ?? "") });
  }
}

// 引文形态：《书名+卷数》曰：「引文」
const citeRe = /([^，。；：「」『』\n（）()]{1,24}?)(?:卷)?([〇一二三四五六七八九十百千\d]{0,6})(?:上|中|下)?(?:之[一二三四五六\d])?\s*(?:曰|云|言|说|說|道|出|载|載)\s*[:：]?\s*「([^」]{4,200})」/g;
type Quote = { id: number; head: string; title: string; juan: string; text: string };
const quotes: Quote[] = [];
for (const r of rows) {
  for (const m of r.body.matchAll(citeRe)) {
    quotes.push({ id: r.id, head: r.head, title: m[1].trim(), juan: (m[2] ?? "").trim(), text: m[3].trim() });
  }
}
console.log(`引文抽取：${quotes.length} 条，来自 ${new Set(quotes.map((q) => q.id)).size} 个词条`);
const lens = quotes.map((q) => [...q.text].length).sort((a, b) => a - b);
console.log(`  引文长度：min ${lens[0]}、中位 ${lens[Math.floor(lens.length / 2)]}、p90 ${lens[Math.floor(lens.length * 0.9)]}、max ${lens[lens.length - 1]}`);
const titles = new Map<string, number>();
for (const q of quotes) titles.set(q.title, (titles.get(q.title) ?? 0) + 1);
console.log(`  书名去重 ${titles.size} 种；Top: ${[...titles.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => `${k}(${v})`).join(" ")}`);
const withJuan = quotes.filter((q) => q.juan).length;
console.log(`  带卷数 ${withJuan} 条（${((withJuan / quotes.length) * 100).toFixed(1)}%）`);

// 抽样实搜：每 400 条取 1，去 taisho / wxzj 找
const taisho = await openAdb("D:/accelon3/taisho.adb");
const wxzj = await openAdb("D:/accelon3/wxzj.adb");
console.log(`\ntaisho: ${taisho.lines} 行 tags=${taisho.tags.join(",")}`);
console.log(`wxzj  : ${wxzj.lines} 行 tags=${wxzj.tags.join(",")}`);

const sample = quotes.filter((_, i) => i % 400 === 0).slice(0, 40);
let hitT = 0;
let hitW = 0;
let hitAny = 0;
const rows2: string[] = ["entryid\ttitle\tjuan\tquote_len\ttaisho_total\twxzj_total"];
for (const q of sample) {
  // 用引文中段做检索串，避开首尾被原书断行/异体影响的字
  const key = [...q.text].slice(2, 14).join("");
  const st = await taisho.search(key, 3);
  const sw = await wxzj.search(key, 3);
  if (st.total > 0) hitT++;
  if (sw.total > 0) hitW++;
  if (st.total > 0 || sw.total > 0) hitAny++;
  rows2.push(`${q.id}\t${q.title}\t${q.juan}\t${[...q.text].length}\t${st.total}\t${sw.total}`);
}
console.log(`\n抽样 ${sample.length} 条实搜结果：taisho 命中 ${hitT}、wxzj 命中 ${hitW}、至少一处 ${hitAny}（${((hitAny / sample.length) * 100).toFixed(0)}%）`);
writeFileSync("out/cite-survey.tsv", rows2.join("\n") + "\n", "utf8");
writeFileSync("out/cite-all.tsv", ["entryid\theadword\ttitle\tjuan\tquote"].concat(quotes.map((q) => [q.id, q.head, q.title, q.juan, q.text.replace(/\t/g, " ")].join("\t"))).join("\n") + "\n", "utf8");
console.log("全量引文 -> out/cite-all.tsv；抽样命中 -> out/cite-survey.tsv");
