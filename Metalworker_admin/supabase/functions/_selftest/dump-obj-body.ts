// Print the decoded content of specific pdf objects, so a file's operator style can be
// read before an interpreter is written against it. Verification only.
import { resolve } from "node:path";

import { raw, streamObjects, objectDict } from "./pdf-read.ts";

const src = raw(resolve(process.argv[2]));
const streams = new Map(streamObjects(src).map((o) => [o.num, o]));

for (const arg of process.argv.slice(3)) {
  const num = Number(arg);
  const o = streams.get(num);
  if (!o) {
    console.log(`\n=== obj ${num}: no stream ===`);
    const d = objectDict(src, num);
    if (d) console.log(`  dict: ${d.slice(0, 400)}`);
    continue;
  }
  console.log(`\n=== obj ${num}  ${o.data.length}B decoded ===`);
  console.log(`  dict: ${o.dict.replace(/\s+/g, " ").slice(0, 300)}`);
  console.log("  ---");
  console.log(o.data.slice(0, Number(process.env.PREVIEW ?? 900)));
}