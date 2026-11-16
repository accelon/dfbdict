// 探針：看 fuyan 線成品 adb 的詞條行是不是自成一行的體例。
import { openAdb } from "../../adb-converter/ts/tools/adb-skill/engine";

const target = process.argv[2] ?? "D:/accelon3/fgdict.legacy.adb";
const want = Number(process.argv[3] ?? 24);
const db = await openAdb(target);
console.log(`${target}  lines=${db.lines}`);
let printed = 0;
for (let i = 0; i < db.lines && printed < want; i++) {
  const l = db.raw(i);
  if (!/<詞 /.test(l)) continue;
  // 從詞條行起，連同後兩行一起印，看換行體例
  for (let k = 0; k < 3 && i + k < db.lines; k++) console.log(String(i + k).padStart(7) + "|" + db.raw(i + k).slice(0, 90));
  console.log("---");
  printed += 3;
  i += 2;
}
await db.close?.();
