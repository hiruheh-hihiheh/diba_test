import type { MaterialCategory } from "../types/dispatch";

/** The only categories a new dispatch may use, in display order. */
export const ACTIVE_MATERIAL_CATEGORIES: readonly MaterialCategory[] = [
  "metal",
  "non_metal",
  "other",
];

/** Upper bound shared with the form's `maxLength` and the database check. */
export const MAX_CUSTOM_MATERIAL_LENGTH = 80;

/**
 * Normalises the free-text Other value: surrounding whitespace goes, and a
 * run of spaces becomes one space. Returns null when nothing meaningful is
 * left, which is exactly what submission validation treats as "not filled in".
 */
export function normaliseCustomMaterial(value: string): string | null {
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.length > 0 ? trimmed.slice(0, MAX_CUSTOM_MATERIAL_LENGTH) : null;
}

/**
 * Which material field is still missing, or null when the selection is ready.
 *
 * `material` means no category has been chosen at all; `customMaterial` means
 * Other was chosen but the replacement text is blank. The two are mutually
 * exclusive, so the form reports one error and one scroll target, not both.
 */
export function missingMaterialField(
  type: MaterialCategory | null,
  customMaterial: string,
): "material" | "customMaterial" | null {
  if (!type) return "material";
  if (type === "other" && normaliseCustomMaterial(customMaterial) === null) {
    return "customMaterial";
  }
  return null;
}

/** The value persisted as `custom_material` for the current selection. */
export function resolveCustomMaterial(
  type: MaterialCategory | null,
  customMaterial: string,
): string | null {
  return type === "other" ? normaliseCustomMaterial(customMaterial) : null;
}

/**
 * The Other text is only relevant while Other is selected. Call this when the
 * worker changes category so a previous custom value can never ride along with
 * Metal or Non-metal (or be re-submitted after they switch away).
 */
export function customMaterialForCategory(
  type: MaterialCategory,
  previousCustomMaterial: string,
): string {
  return type === "other" ? previousCustomMaterial : "";
}
