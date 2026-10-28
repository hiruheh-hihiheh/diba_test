import { decideWorkbookSnapshot, snapshotsEqual } from "../process-bill-upload/_shared/snapshotConsistency.ts";

let failures = 0;
const check = (ok: boolean, label: string): void => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
};

const A = { paymentDays: 40, company: "Acme" };
const B = { paymentDays: 30, company: "Other" };
const AReordered = { company: "Acme", paymentDays: 40 };

console.log("\nsnapshot consistency");
check(decideWorkbookSnapshot(undefined, [null, null]).ok, "all-null snapshots are accepted");
check(decideWorkbookSnapshot(undefined, [A, A]).ok, "identical non-null snapshots are accepted");
check(!decideWorkbookSnapshot(undefined, [A, B]).ok, "different non-null snapshots are rejected");
check(!decideWorkbookSnapshot(A, [null, null]).ok, "all-null chunk after non-null snapshot is rejected");
check(!decideWorkbookSnapshot(undefined, [null, A]).ok, "mixed null/non-null chunk is rejected");
check(!decideWorkbookSnapshot(null, [A]).ok, "non-null snapshot after all-null chunk is rejected");
check(snapshotsEqual(A, AReordered), "structurally equal objects with different key order compare equal");
check(!snapshotsEqual([1, 2], [2, 1]), "arrays preserve their order");

console.log(
  failures === 0
    ? "\nSNAPSHOT CONSISTENCY CHECKS: all passed."
    : `\nSNAPSHOT CONSISTENCY CHECKS: ${failures} failure(s).`
);
if (failures > 0) process.exitCode = 1;
