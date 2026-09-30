// src/types/folder.ts

export type FolderItemType =
  | "owner_stock"
  | "company_stock"
  | "bill_group"
  | "drawing_group"
  | "job"
  /**
   * The new Bills section: one parsed tax invoice from an uploaded workbook.
   *
   * Distinct from `bill_group`, which is the older Group Bills feature (a photo
   * group). A folder item of this type is a single invoice; the three print
   * copies live with it and are chosen per bill, never as three folder entries.
   */
  | "bill";

export interface AdminFolder {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface FolderItem {
  id: string;
  folder_id: string;
  item_type: FolderItemType;
  item_id: string;
  position: number;
  created_at: string;
}

/** Enriched folder item with display label resolved from the linked record */
export interface FolderItemDisplay extends FolderItem {
  label: string;
  /**
   * Optional second line under the label, e.g. a bill's job classification.
   *
   * Kept OUT of `label` on purpose: the label is used for search, for
   * accessibility labels and for dialog headings, and none of those should
   * change because a bill gained a classification.
   */
  subtitle?: string | null;
}
