#!/usr/bin/env bun
/**
 * （二）经名核对 + 质量闸门。
 *
 * backlink 按“引文优先”搜出候选页并记下命中页所属大正书名（match.book）。
 * 这里做作者要的第二道：用经名核对它挑的本经对不对，并据此产出保留集。
 *
 * 题面复原三件事：
 *   1. 回指继承：同/又/同疏/同輔行/同嘉祥疏…继承前文已确定的经。
 *      **回指必须拿原始题面判**（v1 的错：先用 NOISE 把「同經」的“同”洗掉再判 ANA，
 *      于是题面变成裸字“經”，回指分支永远进不去；那颗单字“經”又靠子序列规则
 *      配上了「佛說阿彌陀經」，判成“简称/异写一致”——是假通过，不是核对成功）。
 *      回溯目标按两处找，先近后远：
 *        a. **本条正文里、这段引文之前**最近出现的经名。作者举的例正是这种：
 *           「佛說阿彌陀經之異名。…同經曰：『汝等眾生…』」——先行词在正文里，
 *           不在上一条引文里，只按引用顺序继承会回溯不到。
 *        b. 退回首条：同词条内上一条已确定的经名。
 *   2. 题面去噪 + 品名剥离：則法華經 / 嘉祥之法華經 洗掉引导词；法華經譬喻品 → 法華經。
 *   3. 简称展开：data/title-map.tsv（用两库自己的 書 表反推）。
 *      比对必须用**子序列**：法華經 不是 妙法蓮華經 的连续子串（中间有“蓮”），
 *      用子串比会把正确锚点判成不符。但子序列只对**两字以上**的经名有效——
 *      单字体裁字（經/論/疏…）是任何标题的子序列，比了必假。
 *
 * 闸门（作者 2026-11-15 裁定）：剔除 经名不符 与 候选>100（短通用引文，位置基本靠猜）。
 * 输出 out/gate-keep-<slug>.json（保留的 qIndex 集合）供重新套用打包。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
// 换批次只给 --slug：backlink 的中间档一律叫 `<slug>-matches.json` / `<slug>-quotes.json`。
// 旧批次的档留着不覆盖，两批结果才能并排比（dfb-v3 是加了 <段/> 分段之后重跑的那一批）。
const SLUG = (() => {
  const i = process.argv.indexOf("--slug");
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : "dfb-v2";
})();
const ADB = resolve(ROOT, `out/matches/${SLUG}-matches.json`);
const QJ = resolve(ROOT, `out/matches/${SLUG}-quotes.json`);
const KEEP = resolve(ROOT, `out/gate-keep-${SLUG}.json`);
const LINES = resolve(ROOT, "out/dfb-lines.txt");
const CITE = resolve(ROOT, "out/cite-all.tsv");
const TMAP = resolve(ROOT, "data/title-map.tsv");
// 回指的正文回溯要用原书释文（cite-all 只有题面＋引文，沒有「引文前面寫了什麼」）
const BODY = resolve(ROOT, "../fodict/data/佛學大辭典.tsv");
// sound 尺 v2 的三張底表（src/dump-corpus-titles.ts / collect-needs-map.ts / make-title-overlay.ts 產出，
// 手寫那兩張由 src/verify-title-tables.ts 校驗）
const CORPUS_TITLES = resolve(ROOT, "data/corpus-titles.tsv");
const TITLE_VARIANT = resolve(ROOT, "data/title-variant.tsv");
const TITLE_MASTER = resolve(ROOT, "data/title-master.tsv");
console.log(`slug=${SLUG}`);

type Match = { qIndex: number; line: number; anchor: string; book: string; hint: number; cands: number; j?: string; matched: number; quoteHan: string; cue: string };
const matches = JSON.parse(readFileSync(ADB, "utf8")) as Match[];
const quotes = JSON.parse(readFileSync(QJ, "utf8")) as { line: number; raw: string; han: string }[];
// qIndex 就是 quotes 的直接下标（先前以为要重映射，是我想错了）
console.log(`matches ${matches.length}、quotes ${quotes.length}`);

// 行号 → 词条 id（backlink 的 line 是 1 起算行序）
const lineToEntry: number[] = [];
{
  const lines = readFileSync(LINES, "utf8").replace(/\r\n/g, "\n").split("\n");
  let cur = 0;
  for (const l of lines) {
    const m = l.match(/^<詞 id="(\d+)"/);
    if (m) cur = Number(m[1]);
    lineToEntry.push(cur);
  }
}

type Cite = { entry: number; title: string; quote: string; han: string };
const citeLoose = new Map<number, Cite[]>();
{
  const lines = readFileSync(CITE, "utf8").replace(/\r\n/g, "\n").trim().split("\n").slice(1);
  for (const l of lines) {
    const c = l.split("\t");
    if (c.length < 5) continue;
    const entry = Number(c[0]);
    (citeLoose.get(entry) ?? citeLoose.set(entry, []).get(entry)!).push({
      entry,
      title: c[2] ?? "",
      quote: c[4] ?? "",
      han: norm(c[4] ?? ""),
    });
  }
}

const tmap = new Map<string, { kind: string; list: string[] }>();
for (const l of readFileSync(TMAP, "utf8").replace(/\r\n/g, "\n").trim().split("\n").slice(1)) {
  const c = l.split("\t");
  tmap.set(c[0], { kind: c[2] ?? "", list: (c[3] ?? "").split("|").filter(Boolean) });
}

const ANA = /^(同|又|前|次|本|此|是)/;
const NOISE = /^(則|即|如|出|見|案|按|又|同|此|是|本|前|次)+/;
const OWN = /^(?:.{1,6}?)之(法華經|涅槃經|金剛經|華嚴經|大經|如來)/;
const PIN = /^(.{2,12}?(?:經|論|疏|鈔|記|集|章|訣|頌|律|名義|玄義|文句))(?:[一二三四五六七八九十百\d]+)?(?:品|卷|篇|章)?/;
// 修訂版品名剝離：**尾巴必須真的有卷品章節才剝**。舊 PIN 的尾巴是選填的，
// 於是任何含體裁字的多節書名都會從第一個體裁字處被截斷——
// 「法華經玄義」→「法華經」、「四分律刪繁補闕行事鈔」→「四分律」、
// 「四十二章經」→「四十二章」：把不同的書當成同一部，專造假「一致」。
const PIN_TAIL = /^(?:[第]?[一二三四五六七八九十百千\d]+(?:[上下中])?|第|[上下中]|[卷品篇章]|.{1,8}?[卷品篇章])/;
// 剥掉回指导词后若为空、或只剩这种“体裁字”，说明题面没点名是哪部经 → 真回指。
const GENERIC = /^(經|論|疏|鈔|記|集|章|訣|頌|律|藏|書|篇|偈|部|典|語|品|中|上|下|前|後|注|註|卷|文句|玄義|名義|義疏|[一二三四五六七八九十百\d第]+)$/;
// 光杆一字：整個題面就是一個體裁／位置字（「偈曰」「中曰」「註云」「品」），
// 沒有引導詞也照樣是回指——它點不出書名。
const BARE = /^(經|論|疏|鈔|記|集|章|訣|頌|律|藏|書|篇|偈|部|典|語|品|中|上|下|前|後|注|註|卷)$/;
// 對照開關只為把兩處改動的效果分開計數；正式產出兩個都開。
const KEEP_BARE = process.argv.includes("--keep-bare");
const KEEP_PIN = process.argv.includes("--keep-pin");
function norm(s: string): string {
  return s.replace(/[^\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g, "");
}
/** 回指判定用**原始**题面：以引导词起头且剥掉后只剩体裁字；或整个题面就是光杆一字。 */
function isAnaphora(t: string): boolean {
  const s = t.trim();
  if (!KEEP_BARE && BARE.test(s)) return true;
  if (!ANA.test(s)) return false;
  const rest = s.replace(ANA, "").replace(/^[（(。、，：；\s]+/, "").trim();
  // 「同經法師品」「同經妙音菩薩品」這種＝同經＋章品名：經字仍是泛指，
  // 書名照樣要回溯。不認它會把「經法師品」這種假書名寫進 last，
  // 傳染給同詞條後面的「同品」（詞条 61 實測就是這樣錯的）。
  return rest === "" || GENERIC.test(rest) || /^(經|論|疏|記|鈔).{1,6}(品|卷|章|篇)$/.test(rest);
}
function cleanTitle(t: string): string {
  let s = t.trim().replace(NOISE, "");
  const own = s.match(OWN);
  if (own) s = own[1];
  // 「金剛經第」這種尾巴「第」是卷次的引導字，號碼在 cite-all 的卷欄裡，
  // 留在書名上會把整條比對卡死（沒有書名以「第」結尾）。
  s = s.replace(/第$/, "");
  return s;
}
function stripPin(t: string): string {
  if (KEEP_PIN) {
    const m = t.match(PIN);
    return m && m[1].length >= 2 ? m[1] : t;
  }
  const m = t.match(/^(.{2,12}?(?:經|論|疏|鈔|記|集|章|訣|頌|律|名義|玄義|文句))([\s\S]+)$/);
  if (!m) return t;
  return PIN_TAIL.test(m[2]) && m[1].length >= 2 ? m[1] : t;
}
// 子序列比对：简称常跳字构成（法華經 ← 妙法蓮華經 去“蓮”）。
// 一字经名不做子序列——单字是任何标题的子序列，比了必假。
function isSubseq(small: string, big: string): boolean {
  if (small.length < 2) return false;
  let i = 0;
  for (let j = 0; j < big.length && i < small.length; j++) if (big[j] === small[i]) i++;
  return i === small.length;
}

/* ---- 回指正文回溯：书名词汇 ----
 * 底層是 matches 裡 backlink 實際報過的 book 值（就是本要對質的那批大正書名），
 * 再疊上 title-map 的**簡稱形**（「法華經」↔《妙法蓮華經》）。
 * 只認全稱會漏掉丁福保最慣用的寫法：詞条 61 正文寫「法華經為甚深秘密之要法」，
 * 而大正書名是「妙法蓮華經」——不含簡稱就回溯不到，「同經信解品」只能記成無先行詞。
 * 命中簡稱時：唯一對應就展開成全稱；多解則留簡稱本字，交給比對層的簡稱規則處理。
 * 已知偏向：詞匯來自候選本身＋兩庫反推的 title-map，所以「正文回溯」只會把判據
 * 從「題名未解」提升到「可比對」，不會憑空造書名——正文沒寫經名的照样回溯不到。 */
const bookNames = [...new Set(matches.map((m) => m.book).filter((b) => !!b && b.length >= 2))];
/** 词面上的书名 → 可接受的大正书名列表 */
const vocab = new Map<string, string[]>();
for (const b of bookNames) vocab.set(b, [b]);
for (const [k, v] of tmap) {
  if (vocab.has(k) || v.list.length === 0 || (v.kind !== "精确" && v.kind !== "简称展开")) continue;
  if (k.length < 2) continue;
  vocab.set(k, v.list);
}
const byFirst = new Map<string, string[]>();
for (const b of vocab.keys()) {
  const list = byFirst.get(b[0]);
  if (list) list.push(b);
  else byFirst.set(b[0], [b]);
}
for (const list of byFirst.values()) list.sort((a, b) => b.length - a.length);

const bodyNorm = new Map<number, string>();
{
  const lines = readFileSync(BODY, "utf8").split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split("\t");
    if (c.length < 3) throw new Error(`释文源第 ${i + 1} 行列数不足`);
    bodyNorm.set(Number(c[0]), norm(c[2].replace(/\\n/g, "")));
  }
}
console.log(`词条释文 ${bodyNorm.size} 条、书名空间 ${bookNames.length} 部`);

type Hit = { at: number; title: string };
const hitsCache = new Map<number, Hit[]>();
/** 该词条正文里书名的出现位置；同一位置只取最长的那个（法華經 与 法華經玄義 同时命中时要后者）。 */
function titleHits(entry: number): Hit[] {
  const cached = hitsCache.get(entry);
  if (cached) return cached;
  const t = bodyNorm.get(entry) ?? "";
  const out: Hit[] = [];
  for (let i = 0; i < t.length; i++) {
    const cands = byFirst.get(t[i]);
    if (!cands) continue;
    for (const b of cands) {
      if (t.startsWith(b, i)) {
        out.push({ at: i, title: b });
        break; // 同起点已按长度降序，取最长的就走
      }
    }
  }
  hitsCache.set(entry, out);
  return out;
}
/** 引文之前最近的书名（作者举例那种：「…佛說阿彌陀經之異名。…同經曰：『…』」）。
 *  命中简称时展开：唯一对应→全称；多解→看已命中的候选书里有没有落在展开表内，
 *  有就用那一个（这才是“先查引文、再核经名”要对质的对象），都没有才留简称本字。 */
function nearestBefore(entry: number, quoteHan: string, hitBooks: string[]): string {
  const t = bodyNorm.get(entry);
  if (!t || quoteHan.length < 4) return "";
  const at = t.indexOf(quoteHan.slice(0, 12));
  if (at < 0) return "";
  let best: Hit | null = null;
  for (const h of titleHits(entry)) if (h.at + h.title.length <= at && (!best || h.at > best.at)) best = h;
  if (!best) return "";
  const list = vocab.get(best.title) ?? [best.title];
  if (list.length === 1) return list[0];
  for (const b of hitBooks) if (list.includes(b)) return b;
  return best.title;
}
/** 该词条各候选锚点命中的大正书名（供简称展开时择一） */
const booksOfEntry = new Map<number, string[]>();
for (const m of matches) {
  const e = lineToEntry[m.line - 1] ?? 0;
  if (!e) continue;
  const l = booksOfEntry.get(e) ?? [];
  if (m.book && !l.includes(m.book)) l.push(m.book);
  booksOfEntry.set(e, l);
}

/* ---------------- sound 尺：這個書名在語料裡到底有沒有對應 ----------------
 * 注家代稱（「天台疏」「嘉祥之法華經」「佛祖統紀智顗傳」）字面上像書名，語料裡卻沒有；
 * 拿它當前先行詞，後面整串回指一起錯（詞条 864 即如此）。
 *
 * v1 的教訓：用「跳字子序列」判 sound，15 種省稱裡 11 種是僥倖撞上來的——
 * 「佛地論」配到《佛性論》、「唯識述記」配到《成唯識論述記**集成編**》、
 * 「千手合藥經」配到《千手經》（兩部不同的書），還有一條靠 norm() 把悉曇字
 * 整段剝掉後才互含。**跳字一律不准**，改成四條都有連字／表內證據的規則：
 *   ① 對照表 data/title-master.tsv（省稱·注家·譯本別稱，逐條经 verify-title-tables.ts 校驗）
 *   ② 精確（原文或異寫正規後）命中語料書名表
 *   ③ 連字包含：丁福保的省稱是某部語料書名的**連續**子串（≥3 字才准，兩字省稱一律走①）
 *   ④ 削尾後再③：書名後掛的卷次品次（行事鈔下／資持記上／唯識述記一本）先削掉
 * ②③ 用同一張底表 data/corpus-titles.tsv（大正 3,000＋卍續 1,236 部，去重 4,108）。 */
const corpusTitles = readFileSync(CORPUS_TITLES, "utf8").replace(/\r\n/g, "\n").trim().split("\n").slice(1)
  .map((l) => l.split("\t")[0]).filter(Boolean);

const variantPairs: [string, string][] = readFileSync(TITLE_VARIANT, "utf8").replace(/\r\n/g, "\n").trim().split("\n").slice(1)
  .map((l) => l.split("\t")).filter((c) => c.length >= 2 && c[0] && c[1]).map((c) => [c[0], c[1]] as [string, string]);
/** 異寫正規：把丁福保寫法統一到大正題名用字（增一→增壹、秘→祕…） */
function canonVariant(s: string): string {
  let t = s;
  for (const [a, b] of variantPairs) t = t.split(a).join(b);
  return t;
}
const masterTable = new Map<string, string[]>();
for (const l of readFileSync(TITLE_MASTER, "utf8").replace(/\r\n/g, "\n").trim().split("\n").slice(1)) {
  const c = l.split("\t");
  if (c.length < 2 || !c[0]) continue;
  masterTable.set(c[0], c[1].split("|").map((s) => s.trim()).filter(Boolean));
}
// 對照表同時進「正文回溯」的詞彩：丁福保正文寫「玄應音義」「寄歸傳」時，
// 沒有這張表就回溯不到，646＋213 條引用會一直掛在「語料無此書」上。
for (const [k, list] of masterTable) if (!vocab.has(k)) vocab.set(k, list);
const corpusSet = new Set(corpusTitles);
const corpusCanon = corpusTitles.map((t) => canonVariant(norm(t)));
const corpusCanonSet = new Set(corpusCanon);
/** 削掉書名尾巴上的卷次／品次（最多三層，削到少于三字就停） */
function stripVolumeTail(s: string): string[] {
  const out: string[] = [];
  let t = s;
  for (let i = 0; i < 3; i++) {
    const next = t.replace(/(?:[上中下末卷品篇章]|[一二三四五六七八九十百\d]+)$/, "");
    if (!next || next === t || [...next].length < 3) break;
    out.push(next);
    t = next;
  }
  return out;
}
type SoundHow = "对照表" | "精确" | "异写精确" | "连字包含" | "削尾后包含" | "拒";
const soundMemo = new Map<string, SoundHow>();
function soundWhy(title: string): SoundHow {
  if (!title) return "拒";
  const memo = soundMemo.get(title);
  if (memo) return memo;
  let r: SoundHow = "拒";
  if ((masterTable.get(title) ?? []).length) r = "对照表";
  else if (corpusSet.has(title)) r = "精确";
  else {
    const n = canonVariant(norm(title));
    if (n && corpusCanonSet.has(n)) r = n === norm(title) ? "精确" : "异写精确";
    else if ([...n].length >= 3 && corpusCanon.some((c) => c.includes(n))) r = "连字包含";
    else {
      for (const t of stripVolumeTail(n)) {
        if (corpusCanonSet.has(t) || corpusCanon.some((c) => c.includes(t))) { r = "削尾后包含"; break; }
      }
    }
  }
  soundMemo.set(title, r);
  return r;
}
/** 尺一（严）：只看词表精确等值，或 tmap 展开后正落在词表里。保留作对照。 */
function inCorpusExact(title: string): boolean {
  if (!title) return false;
  if (vocab.has(title)) return true;
  return (tmap.get(title)?.list ?? []).some((b) => vocab.has(b));
}
/** 尺二 v2：连字／表内证据，不再靠跳字。 */
function inCorpusRuler(title: string): boolean {
  return soundWhy(title) !== "拒";
}
type Guard = "off" | "exact" | "ruler";
const LAST_GUARD: Guard = process.argv.includes("--last-guard-exact") ? "exact"
  : process.argv.includes("--last-guard") ? "ruler" : "off";
const TRACE_LAST = process.argv.includes("--trace-last");
/** 順帶記下被擋掉不進 last 的書名，好讓人抽查（不擋也不行：見 audit-master-names.ts） */
const blockedLast = new Map<string, number>();
/** --trace-last：基準（不開閘）每一條回指的繼承來源與兩把尺的裁決 */
type Trace = { entry: number; at: number; raw: string; via: string; inherited: string; exact: boolean; ruler: boolean };
const trace: Trace[] = [];

// 每个词条按引用顺序解出“应属之书”（回指必须按顺序继承）。
// **两条解析路径都按锚点命中过的书名各跑一遍**：
//   plain  ＝不给任何书名提示（简称多解时留简称本字），保守口径；
//   guided ＝允许简称在“本词条候选命中过的书名”里择一展开。
// 两者的差就是“书名提示”带来的全部影响，量化后才敢用 guided。
type Expect = { title: string; how: string };
function resolveEntry(entry: number, list: Cite[], guided: boolean, guard: Guard = LAST_GUARD): Expect[] {
  const hitBooks = guided ? booksOfEntry.get(entry) ?? [] : [];
  let last = "";
  const arr: Expect[] = [];
  for (const c of list) {
    let title: string;
    let how: string;
    if (isAnaphora(c.title)) {
      const fromBody = nearestBefore(entry, c.han, hitBooks);
      if (fromBody) { title = fromBody; how = "回指·正文回溯"; }
      else if (last) { title = last; how = "回指·顺序继承"; }
      else { title = ""; how = "回指且前无经名"; }
      // 主流程對每個詞条都跑 guided/plain 兩遍，這裡只記 guided 那遍，
      // 否則每條回指會被記兩次（第一版就因此報出「149 條基準、尺一拒 288」這種大於總數的數）。
      if (TRACE_LAST && guard === "off" && guided && title && !fromBody) {
        trace.push({ entry, at: arr.length, raw: c.title, via: "顺序继承", inherited: title, exact: inCorpusExact(title), ruler: inCorpusRuler(title) });
      }
      if (title) last = title;
    } else {
      const cleaned = cleanTitle(c.title);
      title = cleaned;
      how = cleaned !== c.title.trim() ? "题面去噪" : "原样";
      const sp = stripPin(title);
      if (sp !== title) { title = sp; how = "品名剥离"; }
      const tm = tmap.get(title);
      if (tm?.kind === "简称展开") {
        how = tm.list.length === 1 ? "简称展开" : `简称歧义(${tm.list.length})`;
        if (tm.list.length === 1) title = tm.list[0];
        else if (guided) for (const b of hitBooks) { if (tm.list.includes(b)) { title = b; how = "简称展开·命中择一"; break; } }
      } else if (tm?.kind === "精确") how = "精确";
      else if (tm?.kind === "对不上") how = "语料无此书";
      // title-map 认不出时再查注家／省稱對照表：「玄應音義」「俱舍光記」「寄歸傳」
      // 这类写法在语料里另有题名，不查就会一直挂在「语料无此书」上。
      const mm = masterTable.get(title);
      if (mm && mm.length && (!tm || tm.kind === "对不上")) {
        const pick = mm.length === 1 ? mm[0] : guided ? mm.find((b) => hitBooks.includes(b)) ?? "" : "";
        if (pick) { title = pick; how = "注家对照"; }
        else if (mm.length > 1) how = `注家歧义(${mm.length})`;
      }
      if (title) {
        // 「同偈」「同註」這種回指，繼承的該是**上一個真在語料裡的經名**。
        // 中問遇到「天台疏」這種代稱時若照寫 last，後面整串回指會一起錯到
        // 一個根本不存在的書名上（詞条 864 實測即如此）。故：比對照舊用它，
        // 但不准它污染 last。
        const sound = guard === "exact" ? inCorpusExact(title) : inCorpusRuler(title);
        if (guard !== "off" && !sound) {
          blockedLast.set(title, (blockedLast.get(title) ?? 0) + 1);
          how = how === "语料无此书" ? "语料无此书（不继承）" : `${how}（不继承）`;
        } else last = title;
      }
    }
    arr.push({ title, how });
  }
  return arr;
}
const expectOf = new Map<number, Expect[]>();
const expectPlain = new Map<number, Expect[]>();
const anaStat = { 正文回溯: 0, 顺序继承: 0, 无先行词: 0, 回指計: 0, 题面計: 0 };
for (const [entry, list] of citeLoose) {
  expectOf.set(entry, resolveEntry(entry, list, true));
  expectPlain.set(entry, resolveEntry(entry, list, false));
  for (const e of expectOf.get(entry)!) {
    anaStat["题面計"]++;
    if (e.how.startsWith("回指")) {
      anaStat["回指計"]++;
      if (e.how === "回指·正文回溯") anaStat["正文回溯"]++;
      else if (e.how === "回指·顺序继承") anaStat["顺序继承"]++;
      else anaStat["无先行词"]++;
    }
  }
}
console.log(`回指解析：题面 ${anaStat["题面計"]} 条，判为回指 ${anaStat["回指計"]} 条 → 正文回溯 ${anaStat["正文回溯"]}、顺序继承 ${anaStat["顺序继承"]}、前无经名 ${anaStat["无先行词"]}`);
console.log(`last 污染闸门：${LAST_GUARD === "off" ? "关（默认）" : LAST_GUARD === "exact" ? "开·尺一（精确等值）" : "开·尺二（与经名核对同尺）"}，挡住 ${blockedLast.size} 种语料查无的书名、共 ${[...blockedLast.values()].reduce((s, n) => s + n, 0)} 次不回写 last`);
console.log(`  被挡 Top：${[...blockedLast.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k}(${v})`).join(" ")}`);

/* ---- --trace-last：把「149→5 與 149→49 的差」摊到每一行 ----
 * 同一份基準（不開閘）的 149 條順序繼承，逐條過兩把尺；再各開一次閘，
 * 看實際剩多少、少掉的那些流落到哪一档（含聯動：擋掉一個 last 之後，
 * 同詞条後面的回指會改繼承更早的書名，所以「149−被拒」不等於實測值）。*/
if (TRACE_LAST) {
  const tally = (g: Guard) => {
    const c = { 正文回溯: 0, 顺序继承: 0, 无先行词: 0 };
    for (const [e, list] of citeLoose) {
      for (const x of resolveEntry(e, list, true, g)) {
        if (x.how === "回指·正文回溯") c["正文回溯"]++;
        else if (x.how === "回指·顺序继承") c["顺序继承"]++;
        else if (x.how === "回指且前无经名") c["无先行词"]++;
      }
    }
    return c;
  };
  const off = { 正文回溯: anaStat["正文回溯"], 顺序继承: anaStat["顺序继承"], 无先行词: anaStat["无先行词"] };
  const r1 = tally("exact"), r2 = tally("ruler");
  const rejE = trace.filter((t) => !t.exact).length, rejR = trace.filter((t) => !t.ruler).length;
  console.log(`\n[trace] 順序繼承基準 ${off["顺序继承"]} 條，其中繼承來源：尺一拒 ${rejE}、尺二拒 ${rejR}、兩尺都拒 ${trace.filter((t) => !t.exact && !t.ruler).length}`);
  console.log(`[trace] 開閘後實際：尺一 正文回溯 ${r1["正文回溯"]}/顺序继承 ${r1["顺序继承"]}/无先行词 ${r1["无先行词"]}；尺二 ${r2["正文回溯"]}/${r2["顺序继承"]}/${r2["无先行词"]}`);
  const rescued = trace.filter((t) => !t.exact && t.ruler);
  const kinds = new Map<string, number>();
  /** 機制直接取自 soundWhy，不再另算一套（避免「尺」與「解释尺的腳本」兩份口徑打架） */
  const mech = new Map<string, string>();
  for (const t of rescued) {
    const k = t.inherited;
    kinds.set(k, (kinds.get(k) ?? 0) + 1);
    if (!mech.has(k)) mech.set(k, soundWhy(k));
  }
  const byCount = new Map<string, number>();
  for (const [k] of kinds) { const m = mech.get(k) ?? "?"; byCount.set(m, (byCount.get(m) ?? 0) + 1); }
  console.log(`[trace] 尺二 v2 救回 ${rescued.length} 條／${kinds.size} 種書名，按依據分（種數）：${[...byCount.entries()].map(([k, v]) => `${k} ${v} 种`).join("、")}`);
  const countInherits = (mode: Guard) => {
    let n = 0;
    for (const [e, list] of citeLoose) for (const x of resolveEntry(e, list, true, mode)) if (x.how === "回指·顺序继承") n++;
    return n;
  };
  const rejected = trace.filter((t) => !t.ruler).length;
  /* 「基準減被拒」常不等於「實得」：擋掉某個壞 last 後，同詞条後面的回指
   * 不再卡在壞先行詞上，會改繼承更早的書名——這部分是聯動，要報出來才對得上賬。 */
  console.log(`[trace] 尺二：基准 ${off["顺序继承"]} − 被拒 ${rejected} = ${off["顺序继承"] - rejected}，实得 ${countInherits("ruler")}（差 ${countInherits("ruler") - (off["顺序继承"] - rejected)} 条来自联动）`);
  console.log(`[trace] 尺一：基准 ${off["顺序继承"]} − 被拒 ${rejE} = ${off["顺序继承"] - rejE}，实得 ${countInherits("exact")}`);
  console.log(`[trace] 尺二救回的書名（前 20，按條數）：`);
  for (const [k, v] of [...kinds.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`   ${String(v).padStart(4)}  ${k}　[${mech.get(k)}]`);
  console.log(`[trace] 仍被拒的繼承來源 Top（這些才是真該擋的注家代稱／外典）：`);
  const both = new Map<string, number>();
  for (const t of trace.filter((x) => !x.ruler)) both.set(`${t.inherited}`, (both.get(t.inherited) ?? 0) + 1);
  for (const [k, v] of [...both.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)) console.log(`   ${String(v).padStart(4)}  ${k}　[${soundWhy(k)}]`);
  writeFileSync(resolve(ROOT, "out/last-trace.tsv"),
    ["entry\t序號\t題面繼承自\t尺一\t尺二\t依据"].concat(trace.map((t) => [t.entry, t.at, t.inherited, t.exact ? "y" : "n", t.ruler ? "y" : "n", soundWhy(t.inherited)].join("\t"))).join("\n") + "\n", "utf8");
  console.log("[trace] -> out/last-trace.tsv");
  process.exit(0);
}

const verdicts = new Map<string, number>();
const verdictsPlain = new Map<string, number>();
let guidedDelta = 0; // 书名提示改变判定的行数（guided 与 plain 不同）
const rowsOut: string[] = [];
const keep = new Set<number>();
const bad: string[] = [];
/** 判定用的分类器（书名提示与否两条路都走它，保证差别只来自输入） */
function judge(want: string, how: string, book: string, hint: number): string {
  const wn = norm(want), bn = norm(book);
  if (!want) return how === "语料无此书" ? "外典无书" : how === "回指且前无经名" ? "回指无先行词" : "题名未解";
  if (wn === bn) return "一致";
  // 单字体裁字（經/論/疏/記…）不能拿来比：它是任何书名的子串。
  // `bn.includes(wn)` 这条旁路与 isSubseq 同源，上轮只堵了子序列、没堵 includes。
  if (wn.length < 2 || bn.length < 2) return "题名过短不可比";
  if (bn.includes(wn) || wn.includes(bn) || isSubseq(wn, bn) || isSubseq(bn, wn)) return "简称/异写一致";
  if (hint && (bn.includes(wn.slice(0, 2)) || wn.includes(bn.slice(0, 2)))) return "部分相符";
  return "不符";
}
for (const m of matches) {
  // backlink 的 quote/match `line` 是**0 起算**的數組下標（backlink.ts:170 `line: i`），
  // 舊版此處按 1 起算寫成 m.line - 1。實測 14,235 條裡兩者歸屬完全相同（0 條差異），
  // 因為詞條標題行與它下面的正文行本來就屬同一詞條——**是運氣，不是對的**：
  // 一旦哪天引文行前面是空行或跨檔頭，就會整批算到上一個詞條頭上。故改成正確基準。
  const entry = lineToEntry[m.line] ?? 0;
  if (!entry) { verdicts.set("行号未映到词条", (verdicts.get("行号未映到词条") ?? 0) + 1); continue; }
  const q = quotes[m.qIndex];
  if (!q) { verdicts.set("qIndex 越界", (verdicts.get("qIndex 越界") ?? 0) + 1); continue; }
  const qh = norm(q.han ?? q.raw);
  const list = citeLoose.get(entry) ?? [];
  const arr = expectOf.get(entry) ?? [];
  let ci = list.findIndex((x) => x.han.length >= 4 && qh.startsWith(x.han.slice(0, 12)));
  if (ci < 0) ci = list.findIndex((x) => x.han.slice(0, 12).startsWith(qh.slice(0, 12)) && qh.length >= 4);
  // 我的引文正则只收到 22,652 条，backlink 收到 27,024 条：差额是“无引号、收到句末标点即止”
  // 那批。这类没有题面记录可比，属抽取范围限制，不能算成经名不符。
  if (ci < 0) {
    verdicts.set("无题面记录（无引号引文）", (verdicts.get("无题面记录（无引号引文）") ?? 0) + 1);
    // 保守路也计这一档：否则两栏的分母不同（12,014 vs 14,235），并排看会误读成
    // “保守路把这 2,221 条判成了别的”。
    verdictsPlain.set("无题面记录（无引号引文）", (verdictsPlain.get("无题面记录（无引号引文）") ?? 0) + 1);
    rowsOut.push([m.qIndex, entry, "", m.book, m.cands, m.hint, "无题面记录", ""].join("\t"));
    if (m.cands <= 100) keep.add(m.qIndex);
    continue;
  }
  const exp = arr[ci];
  const want = exp?.title ?? "";
  const how = exp?.how ?? "未解";
  const v = judge(want, how, m.book, m.hint);
  // 不給書名提示的保守版，同一條再判一次：兩者之差＝「書名提示」這一步的全部影響
  const pexp = expectPlain.get(entry)?.[ci];
  const vp = judge(pexp?.title ?? "", pexp?.how ?? "", m.book, m.hint);
  verdictsPlain.set(vp, (verdictsPlain.get(vp) ?? 0) + 1);
  if (vp !== v) guidedDelta++;
  verdicts.set(v, (verdicts.get(v) ?? 0) + 1);
  rowsOut.push([m.qIndex, entry, want, m.book, m.cands, m.hint, v, how].join("\t"));
  if (v === "不符") {
    if (bad.length < 12) bad.push(`经名不符：词条 ${entry}《${list[ci].title}》→ 期望「${want}」(${how})｜实际「${m.book}」候选 ${m.cands}｜页 ${m.anchor}｜引文 ${(q.raw ?? "").slice(0, 26)}`);
  } else if (m.cands > 100) {
    if (bad.length < 12) bad.push(`候选>100：词条 ${entry}《${list[ci].title}》→「${m.book}」候选 ${m.cands}｜引文 ${(q.raw ?? "").slice(0, 26)}`);
  } else keep.add(m.qIndex);
}

const total = matches.length;
console.log("\n=== 经名核对（闸门用『引导』路；括号内是不给书名提示的保守路）===");
for (const [k, v] of [...verdicts.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(6)}  ${((v / total) * 100).toFixed(1)}%  ${k}　（保守路 ${verdictsPlain.get(k) ?? 0}）`);
console.log(`书名提示使 ${guidedDelta} 条判定发生变化（两路不同）`);
console.log(`\n闸门保留 ${keep.size} / ${total}（${((keep.size / total) * 100).toFixed(1)}%）；剔除 ${total - keep.size}`);
console.log("剔除样例：");
for (const x of bad.slice(0, 8)) console.log("  ", x);

// 作者点名的那条要能指名复核：词条 60「一切諸佛所護念經」题面「同經」→ 应认佛說阿彌陀經
{
  const rows = rowsOut.filter((r) => r.split("\t")[1] === "60");
  console.log("\n=== 指名复核：词条 60（…同經曰：汝等眾生，當信是…）===");
  console.log(`  题面解析：${JSON.stringify(expectOf.get(60) ?? [])}`);
  console.log(rows.length ? rows.map((r) => "  " + r).join("\n") : "  本轮该词条没有候选锚点（引文未被 backlink 命中）");
}

writeFileSync(`out/title-verdicts-${SLUG}.tsv`, ["qIndex\tentry\twant\tbook\tcands\thint\tverdict\thow"].concat(rowsOut).join("\n") + "\n", "utf8");
writeFileSync(KEEP, JSON.stringify([...keep].sort((a, b) => a - b)), "utf8");
writeFileSync(`out/title-check-bad-${SLUG}.tsv`, bad.join("\n") + "\n", "utf8");
console.log(`\n-> out/title-verdicts-${SLUG}.tsv、${KEEP}、out/title-check-bad-${SLUG}.tsv`);
