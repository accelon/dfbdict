// 找 <段/> 后面不是義項序號的那一处（F 报 1 处），打印原文供人工判读。
import { openAdb } from "../../adb-converter/ts/tools/adb-skill/engine";

const db = await openAdb(process.argv[2] ?? "out/dfb-linked.adb");
const SEG = "<段/>";
for (let i = 0; i < db.lines; i++) {
  const l = db.raw(i);
  if (!l.includes(SEG)) continue;
  let idx = l.indexOf(SEG);
  while (idx >= 0) {
    const rest = l.slice(idx + SEG.length).replace(/^[\s　]+/, "");
    if (!/^（[一二三四五六七八九十]{1,3}）/.test(rest)) {
      console.log(`行 ${i + 1}`);
      console.log(`  前：…${l.slice(Math.max(0, idx - 70), idx)}`);
      console.log(`  後：${rest.slice(0, 70)}…`);
    }
    idx = l.indexOf(SEG, idx + SEG.length);
  }
}
await db.close?.();
