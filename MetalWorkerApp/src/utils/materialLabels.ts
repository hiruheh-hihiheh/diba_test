import type { TranslationDictionary } from "../constants/translations";
import type { MaterialType } from "../types/dispatch";

/**
 * Translation key for a material value. Historical values keep their original
 * labels instead of being folded into the new categories.
 */
export function getMaterialLabelKey(type: MaterialType): keyof TranslationDictionary {
  switch (type) {
    case "metal": return "metal_material";
    case "non_metal": return "non_metal_material";
    case "other": return "other";
    case "scrap": return "scrap_metal";
    case "ferrous": return "ferrous_metal";
    case "non_ferrous": return "non_ferrous_metal";
    default: return "other";
  }
}

/**
 * What to show for a dispatch's material, including the free-text Other value.
 *
 * Rows created before the category change carry no `custom_material`, so they
 * render with their original label rather than being guessed at.
 */
export function getMaterialDisplayLabel(
  type: MaterialType,
  customMaterial: string | null | undefined,
  t: TranslationDictionary,
): string {
  if (type === "other") {
    const custom = customMaterial?.trim();
    return custom ? `${t.other}: ${custom}` : t.other;
  }
  return t[getMaterialLabelKey(type)];
}
