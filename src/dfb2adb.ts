#!/usr/bin/env bun
/**
 * dfb2adb — data/dfb.tsv → Accelon3 詞典模型 dfb.adb（不依 ptk）
 *
 * 依作者 2026-11-15 四項裁定：
 *  一) 工作區 D:\2026\dfbdict；資料由 D:\2026\fodict 校勘定稿後帶入。
 *  二) 起首類別標籤（術語／名數／雜語…共 87 種）轉語義標籤 `<例 t="體例"/>`，標籤名取原文。
 *  三) 交叉引用 `(參見：X)` → `<聯 n="X">X</聯>`，只包本庫確有的詞頭；死鏈留原样文字。
 *  四) 同形詞頭按 entryid 升序：第一人無 a=，其後 a="2"、a="3"…
 *
 * 其他体例决定（依原书结构，可核）：
 *  - 書證「X曰：『…』」逐條各一行（作者惯例：書證必逐條一行）。
 *  - `【又】` 是原书义项分隔符，保留为内文文字，不当体例分区。
 *  - 正文转义：& < > → ＆ ＜ ＞（同 cyd 范本，保 VA）。
 *  - 硬换行仅 2 条（id=19430 悉曇表、id=27621 欧文佛书），按行切开各成一段。
 *
 * 用法: bun run src/dfb2adb.ts [tsv] [-o out/dfb.adb] [--dbname dfb] [--dbcname 佛學大辭典] [--dry]
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { authorAdb } from "../../adb-converter/ts/src/adbauthor";

const args = process.argv.slice(2);
const opt = (n: string, d: string) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const valueArgs = new Set<string>();
for (let i = 0; i < args.length; i++) if (args[i].startsWith("-")) valueArgs.add(args[i + 1] ?? "");
const tsvPath = args.find((a) => !a.startsWith("-") && !valueArgs.has(a)) ?? "data/dfb.tsv";
const out = opt("-o", "out/dfb.adb");
const dbname = opt("--dbname", "dfb");
const dbcname = opt("--dbcname", "佛學大辭典");
const dry = args.includes("--dry");

const esc = (s: string) => s.replace(/&/g, "＆").replace(/</g, "＜").replace(/>/g, "＞");
const attrEsc = (s: string) => s.replace(/&/g, "＆").replace(/</g, "＜").replace(/>/g, "＞").replace(/"/g, "＂").replace(/[\r\n]+/g, " ");

/**
 * （一）旧 diacritic 表式 → Unicode。依作者 2026-11-15 指示，规则表 = data/translit-cbdia-map.tsv
 *   `!` → 下方一点（U+0323）；`%` → 上方一点（U+0307）或长音（U+0304）——**随基字变**，
 *   故必须按 (记号, 基字) 二元键查表，不能“一记号一音符”。
 *   表由 D:\2026\fodict 的 M5 残差普查反推、771/771 回验通过；含 3 条 1 票镜像实证与 1 条裁定补入。
 *   表内没有的组合（e/ a/ j/ j! N! 共 46 处）**保持原样**：经查证是两版连基字都不同
 *   （BAUS N!a ↔ 镜像 Ḍa；BAUS j/ ↔ 镜像 ṛ），单值规则表达不了，不硬凑。
 *   注：此项反转了先前“③ 全部不套”的裁定，但只反转在 **adb 建置侧**；
 *   原始抓取档 data/佛學大辭典.tsv 不动，仍保 BAUS 原样。
 */
const TR: Map<string, string> = (() => {
  const m = new Map<string, string>();
  const lines = readFileSync("data/translit-cbdia-map.tsv", "utf8").replace(/\r\n/g, "\n").split("\n").slice(1);
  for (const l of lines) {
    if (!l.trim()) continue;
    const c = l.split("\t");
    if (!c[0] || !c[1] || !c[2]) continue;
    const cp = parseInt(String(c[2]).replace(/^U\+/i, ""), 16);
    if (!Number.isFinite(cp)) throw new Error(`转写表 combining 栏不可解析：${l.slice(0, 60)}`);
    m.set(`${c[0]}|${c[1]}`, String.fromCodePoint(c[1].codePointAt(0)!, cp).normalize("NFC"));
  }
  return m;
})();
const MARKCHARS = "%!^~/.:'_;:,;".split("");
function toUnicodeDiacritics(s: string): { text: string; hit: number; left: Map<string, number> } {
  let hit = 0;
  const left = new Map<string, number>();
  const chars = [...s];
  let o = "";
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    const n = chars[i + 1];
    if (/[A-Za-z]/.test(c) && n && MARKCHARS.includes(n)) {
      const key = `${n}|${c}`;
      const rep = TR.get(key);
      if (rep !== undefined) {
        o += rep;
        i++;
        hit++;
        continue;
      }
      left.set(`${c}${n}`, (left.get(`${c}${n}`) ?? 0) + 1);
    }
    o += c;
  }
  return { text: o, hit, left };
}
const trStats = { hit: 0, left: new Map<string, number>() };
function diac(s: string): string {
  const r = toUnicodeDiacritics(s);
  trStats.hit += r.hit;
  for (const [k, v] of r.left) trStats.left.set(k, (trStats.left.get(k) ?? 0) + v);
  return r.text;
}

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

type Row = { id: number; head: string; body: string };
const rows: Row[] = [];
{
  const lines = readFileSync(tsvPath, "utf8").replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.startsWith("entryid")) lines.shift();
  for (const l of lines) {
    if (!l.trim()) continue;
    const c = l.split("\t");
    if (c.length < 3) throw new Error(`列栏数不足 3：${l.slice(0, 60)}`);
    rows.push({ id: Number(c[0]), head: unesc(c[1] ?? ""), body: unesc(c[2] ?? "") });
  }
}
rows.sort((a, b) => a.id - b.id);
if (rows.some((r) => !Number.isInteger(r.id) || r.id <= 0)) throw new Error("entryid 非正整数");

const heads = new Set(rows.map((r) => r.head));

const seq = new Map<string, number>();
const attrOf = (head: string): string => {
  const n = (seq.get(head) ?? 0) + 1;
  seq.set(head, n);
  return n === 1 ? "" : ` a="${n}"`;
};

let linkHit = 0;
let linkDead = 0;
const deadList = new Map<string, number>();
function links(s: string): string {
  return s.replace(/\(參見：([^)]{1,40})\)/g, (whole, t: string) => {
    const target = t.trim();
    if (heads.has(target)) {
      linkHit++;
      return `<聯 n="${attrEsc(target)}">${esc(target)}</聯>`;
    }
    linkDead++;
    deadList.set(target, (deadList.get(target) ?? 0) + 1);
    return esc(whole);
  });
}

const schemeNames = new Map<string, number>();
function splitHeadCategory(body: string): { label: string | null; rest: string } {
  const m = body.match(/^　?（([^）\n]{1,6})）/);
  if (!m) return { label: null, rest: body };
  if (/[。，、；：！？]/.test(m[1])) return { label: null, rest: body };
  return { label: m[1], rest: body.slice(m[0].length) };
}

// 引文闭合后断行：只在「下一个非空字符不是标点」时断，避免把「曰：「…」，又曰」硬切
function segment(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let depth = 0;
  const chars = [...s];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    cur += c;
    if (c === "「") depth++;
    else if (c === "」") {
      depth = Math.max(0, depth - 1);
      if (depth === 0) {
        const rest = chars.slice(i + 1).join("");
        const nxt = rest.replace(/^[\s　]+/, "")[0];
        if (nxt && !/[，、；：。（）「」『』！？]/.test(nxt)) {
          out.push(cur.trim());
          cur = "";
        }
      }
    } else if (c === "\n") {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    }
  }
  if (cur.trim()) out.push(cur.trim());
  // 只丢真空串。范本里“纯标点行也丢”的过滤器不能照搬：
  // id=2938「種子」正文就是「　（術語）。」，剥掉体例标签后只剩一个「。」，那是要保留的内容。
  return out.filter((x) => x.length > 0);
}

const MAXLINE = 3800;
function wrap(line: string): string[] {
  if ([...line].length <= MAXLINE) return [line];
  const o: string[] = [];
  let cur = "";
  for (const p of line.split(/(?<=[。！？；：、])/g)) {
    if ([...cur + p].length > MAXLINE && cur) {
      o.push(cur);
      cur = p;
    } else cur += p;
  }
  if (cur) o.push(cur);
  return o;
}

/* ---- 義項序號前插 <段/>（作者 2026-11-15：「（一）…（二）…（三）…」擠在一起不好看） ----
 *
 * 為什麼用 `<段/>` 而不是 `<段 n="…">`：n= 是巴利藏那幾庫的**跨庫對齊鍵**
 * （parallel.ts：閱讀器長出 `¶12` 晶片、點了去對讀同結構的庫），丁福保沒有對讀對象，
 * 亂發 n= 會憑空造出一排可點卻無處可點的小晶片。沒帶 n 的 `<段/>` 才是單純的段落分隔
 * （render_accelon3.ts:992-998 → `<br class="para">` ＋段首縮排）。
 * 它落在**同一行內**、不另起源碼行，所以 VA 不斷片、全文檢索不受影響
 * （print 版體例的「區內原始分行不得合併」照常成立）。
 *
 * 判準（客觀、可複算；實測见 out/seg-plan.tsv）：
 *   前有句讀邊界 PARA_BOUND → 這個序號像義項首
 *   後緊接 PARA_STOP        → 這個序號是上一句的尾注（例 273「一相法門」…法門（一）。），不動
 *   兩個條件缺一律不切——寧少切，不乱切。
 * 另外三道安全閘：序號已在行首不切（segment()/wrap() 已讓它自成一段）；
 * 序號相連（（一）（二）無內文）不切；位置落在 `<聯 …>…</聯>` 或任何標記內部不切，
 * 免得把連結標記截斷。
 */
const ENUM_CHARS = new Set(["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"]);
const PARA_BOUND = /[。．：；！？）」』】]/;
const PARA_STOP = /[。，、；：）]/;
const segStats = { 插: 0, 跳行首: 0, 跳尾注: 0, 跳無邊界: 0, 跳標記內: 0, 跳相連: 0 };

/** 序號「（一）」這類：回傳從 i 起算的長度，不是序號則 0。手扫不用正則，免掉字串索引與字元索引錯位。 */
function enumLen(chars: string[], i: number): number {
  if (chars[i] !== "（") return 0;
  let j = i + 1;
  let n = 0;
  while (j < chars.length && ENUM_CHARS.has(chars[j]) && n < 3) { j++; n++; }
  if (n === 0 || chars[j] !== "）") return 0;
  return j - i + 1;
}

function addPara(line: string): string {
  const chars = [...line];
  // blocked[i]：第 i 個字符在標記本體（<…>）內，或在 <聯 …>…</聯> 的正文裡——都不能插東西
  const blocked = new Array<boolean>(chars.length).fill(false);
  let tagStart = -1;
  let linkEnd = -1; // > 0 表示仍在 <聯>…</聯> 之内
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (c === "<" && tagStart < 0) tagStart = i;
    else if (c === ">" && tagStart >= 0) {
      const tag = chars.slice(tagStart, i + 1).join("");
      if (/^<聯[^>]*[^/]>$/.test(tag)) linkEnd = 1;
      else if (tag === "</聯>") linkEnd = Math.max(0, linkEnd - 1);
      for (let k = tagStart; k <= i; k++) blocked[k] = true;
      tagStart = -1;
    }
    if (tagStart >= 0 || linkEnd > 0) blocked[i] = true;
  }
  const cuts: number[] = [];
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] !== "（") continue;
    const len = enumLen(chars, i);
    if (!len) continue;
    if (blocked[i]) { segStats["跳標記內"]++; continue; }
    if (i === 0) { segStats["跳行首"]++; continue; }
    let p = i - 1;
    while (p >= 0 && /[\s　]/.test(chars[p])) p--;
    if (p < 0) { segStats["跳行首"]++; continue; }
    if (blocked[p]) { segStats["跳標記內"]++; continue; }
    // 序號相連（…（一）（二）…）：前一個已是段首，不再切
    if (enumLen(chars, p - 2) > 0 || enumLen(chars, p - 3) > 0 || enumLen(chars, p - 4) > 0) { segStats["跳相連"]++; continue; }
    if (!PARA_BOUND.test(chars[p])) { segStats["跳無邊界"]++; continue; }
    let q = i + len;
    while (q < chars.length && /[\s　]/.test(chars[q])) q++;
    if (q >= chars.length) { segStats["跳尾注"]++; continue; }
    // 後面第一個「可見」字才算數：跨過標記本體
    if (chars[q] === "<") {
      let r = q;
      while (r < chars.length && chars[r] !== ">") r++;
      q = r + 1;
      while (q < chars.length && /[\s　]/.test(chars[q])) q++;
    }
    if (q >= chars.length || PARA_STOP.test(chars[q])) { segStats["跳尾注"]++; continue; }
    cuts.push(i);
    i = q - 1;
  }
  if (!cuts.length) return line;
  segStats["插"] += cuts.length;
  for (const c of cuts.reverse()) chars.splice(c, 0, ...[..."<段/>"]);
  return chars.join("");

}

const L: string[] = [];
const stats = { 詞: 0, 聯: 0, 例: 0, 無體例: 0, 行數: 0 };

// 档头 <集 scheme="…"> 是 <例 t>／<詞 t> 的**配色顺序表**（render_accelon3.ts:862-881：
// 不在表内的标签会往后动态补色相）。先前这里写的是“體例,釋義,書證,連結”——
// 四个标签在输出里根本不存在，白占 0..3 号色相，真实的 87 个类别名从 4 号起排。
// 现按实际出现频次降序把真实类别名写进表里（顺序稳定、可复现）。
// 因为 <集> 在正文循环之前就发出，必须先预扫一遍统计。
const preCats = new Map<string, number>();
for (const r of rows) {
  const m = r.body.match(/^　?（([^）\n]{1,6})）/);
  if (!m || /[。，、；：！？]/.test(m[1])) continue;
  preCats.set(m[1], (preCats.get(m[1]) ?? 0) + 1);
}
const SCHEME_ORDER = [...preCats.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([k]) => k);

L.push(`<檔 n="${dbname}.xml">`);
L.push(`<集 scheme="${SCHEME_ORDER.map((s) => attrEsc(s)).join(",")}">${esc(dbcname)}</集>`);
L.push(`<英文名>Ding Fubao Dictionary of Buddhist Studies</英文名>`);
L.push(`<來源>中華電子佛典協會（BAUS）佛學辭典線上查詢，dictid=1；2026-11-15 抓取</來源>`);
L.push(`<授權>公有領域</授權>`);
L.push("");
L.push(`<樹 s="$詞" t="詞">佛學大辭典</樹>`);
L.push(`<樹 s="*詞" t="詞">全文檢索</樹>`);
L.push(`</檔>`);

L.push(`<檔 n="${dbname}1.xml">`);
for (const r of rows) {
  const { label, rest } = splitHeadCategory(r.body);
  const cat = label ?? "";
  if (cat) schemeNames.set(cat, (schemeNames.get(cat) ?? 0) + 1);
  else stats["無體例"]++;

  // 类别并入词头属性（作者 2026-11-15 裁定）：`<詞 id=".." t="術語">`，
  // 阅读端在词头前渲染色块（word-spec.ts liLabel + render_accelon3 dictLi）。
  // 不再发 `<例 t="…"/>` 里程碑行——否则同一类别会显示两次。
  const tAttr = cat ? ` t="${attrEsc(cat)}"` : "";
  L.push(`<詞 id="${r.id}"${tAttr}${attrOf(r.head)}>${esc(diac(r.head))}</詞>`);
  stats["詞"]++;
  if (cat) stats["例"]++;
  else stats["無體例"]++;
  const prepared = links(diac(rest.replace(/^　/, "")));
  stats["聯"] += (prepared.match(/<聯/g) ?? []).length;
  for (const seg of segment(prepared)) for (const w of wrap(seg)) {
    L.push(addPara(w));
    stats["行數"]++;
  }
  L.push("");
}
L.push(`</檔>`);
while (L.length && L[L.length - 1] === "") L.pop();

const over = L.filter((l) => l.length * 2 > 8192).length;
if (over) {
  console.error(`有 ${over} 行超 4096 字，终止`);
  process.exit(1);
}
const dupSeq = [...seq.values()].filter((n) => n > 1).length;
console.log(
  `（一）diacritic→Unicode：转换 ${trStats.hit} 处；表内无规则而保留原样 ${[...trStats.left.values()].reduce((a, b) => a + b, 0)} 处（${trStats.left.size} 种：${[...trStats.left.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}(${v})`).join(" ")}）\n` +
    `体例标签 ${schemeNames.size} 种、覆盖 ${stats["例"]} 条（无体例 ${stats["無體例"]} 条）\n` +
    `  Top: ${[...schemeNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k}:${v}`).join(" ")}\n` +
    `同形词头 ${dupSeq} 条带 a=，最大序号 ${Math.max(...[...seq.values()])}\n` +
    `交叉引用：成链 ${linkHit}、死链留原文 ${linkDead}\n` +
    `  死链 Top: ${[...deadList.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}(${v})`).join("、")}\n` +
    `義項分段 <段/>：插入 ${segStats["插"]} 处｜跳过 行首 ${segStats["跳行首"]}、尾注 ${segStats["跳尾注"]}、無邊界 ${segStats["跳無邊界"]}、標記內 ${segStats["跳標記內"]}、相連 ${segStats["跳相連"]}\n` +
    `行 ${L.length}、<詞> ${stats["詞"]}、<聯> ${stats["聯"]}、<例> ${stats["例"]}、正文行 ${stats["行數"]}`
);
writeFileSync("out/dfb-lines.txt", L.join("\n") + "\n", "utf8");
if (dry) {
  console.log("\n--dry：不建库");
  process.exit(0);
}

// 类别已并入 <詞 t>，不再发 <例> 行；白名单里留着“例”会每次报一条误导性的“没命中”
const VALID = ["檔", "集", "英文名", "來源", "授權", "樹", "詞", "聯", "段"];
const res = await authorAdb({
  dbname,
  dbcname,
  lines: L,
  dbtype: 2,
  validTags: VALID,
  cachedTags: ["詞"],
  dropNumeric: true,
  log: (m: string) => console.error("  " + m),
});
const target = resolve(out);
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, res.file);
const missing = VALID.filter((t) => !res.tagNames.includes(t));
console.log(
  `built ${target}: ${(res.file.length / 1048576).toFixed(2)} MiB — ${res.lines} lines, ` +
    `${res.tokens} tokens / ${res.tokenHits} hits, tags: ${res.tagNames.join(" ")}, caches=${res.cachedKeys.join("/")}\n` +
    `<詞> ${stats["詞"]}、<聯> ${stats["聯"]}、<例 t=體例> ${stats["例"]}（${schemeNames.size} 种）` +
    (missing.length ? `\nWARN 沒命中: ${missing.join(" ")}` : "")
);
