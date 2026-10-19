// Run with: npm run test:material
//
// Node 23.6+ (or Node 22.6+ with --experimental-strip-types) executes the
// TypeScript helper directly via type stripping; the module has no runtime
// imports, so this needs no test framework or bundler.
import test from "node:test";
import assert from "node:assert/strict";

import {
  ACTIVE_MATERIAL_CATEGORIES,
  customMaterialForCategory,
  missingMaterialField,
  normaliseCustomMaterial,
  resolveCustomMaterial,
} from "../src/utils/materialSelection.ts";
import { getMaterialDisplayLabel } from "../src/utils/materialLabels.ts";

// Only the keys read by the label helper are needed at runtime.
const t = {
  other: "Other",
  metal_material: "Metal",
  non_metal_material: "Non-metal",
  scrap_metal: "Scrap",
  ferrous_metal: "Ferrous",
  non_ferrous_metal: "Non-ferrous",
};

test("only Metal, Non-metal and Other are offered", () => {
  assert.deepEqual([...ACTIVE_MATERIAL_CATEGORIES], ["metal", "non_metal", "other"]);
});

test("Metal and Non-metal are complete without a custom value", () => {
  assert.equal(missingMaterialField("metal", ""), null);
  assert.equal(missingMaterialField("non_metal", ""), null);
  assert.equal(resolveCustomMaterial("metal", "leftover"), null);
  assert.equal(resolveCustomMaterial("non_metal", "leftover"), null);
});

test("Other requires a non-blank description", () => {
  assert.equal(missingMaterialField("other", ""), "customMaterial");
  assert.equal(missingMaterialField("other", "   "), "customMaterial");
  assert.equal(missingMaterialField("other", "brass fittings"), null);
});

test("no category selected reports the category field", () => {
  assert.equal(missingMaterialField(null, "brass"), "material");
});

test("custom text is trimmed and internal runs of spaces collapse", () => {
  assert.equal(normaliseCustomMaterial("  brass   fittings  "), "brass fittings");
  assert.equal(resolveCustomMaterial("other", "  plastic  "), "plastic");
});

test("switching away from Other drops the old custom value", () => {
  assert.equal(customMaterialForCategory("metal", "brass"), "");
  assert.equal(customMaterialForCategory("non_metal", "brass"), "");
  assert.equal(resolveCustomMaterial("metal", "brass"), null);
});

test("saved records display their category and Other text", () => {
  assert.equal(getMaterialDisplayLabel("metal", null, t), "Metal");
  assert.equal(getMaterialDisplayLabel("non_metal", null, t), "Non-metal");
  assert.equal(getMaterialDisplayLabel("other", "  brass fittings ", t), "Other: brass fittings");
  assert.equal(getMaterialDisplayLabel("other", null, t), "Other");
});

test("historical Ferrous / Non-ferrous / Scrap records are not reclassified", () => {
  assert.equal(getMaterialDisplayLabel("ferrous", null, t), "Ferrous");
  assert.equal(getMaterialDisplayLabel("non_ferrous", null, t), "Non-ferrous");
  assert.equal(getMaterialDisplayLabel("scrap", null, t), "Scrap");
});

test("switching back to Other cannot resurrect a dropped value", () => {
  // The form applies this helper on every category change, so the stored value
  // is already empty by the time Other is selected again.
  const afterMetal = customMaterialForCategory("metal", "brass");
  assert.equal(customMaterialForCategory("other", afterMetal), "");
  assert.equal(missingMaterialField("other", afterMetal), "customMaterial");
});
