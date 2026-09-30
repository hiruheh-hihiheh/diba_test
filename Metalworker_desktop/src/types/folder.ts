// src/types/folder.ts

export type FolderItemType =
  | "owner_stock"
  | "company_stock"
  | "bill_group"
  | "drawing_group"
  | "job"
  | "bill";

export interface AdminFolder {
  id: string;
  name: string;
  folder_type?: "labour" | "with_material" | "general" | null;
  created_at: string;
  updated_at: string;
  itemCount?: number;
  labourCount?: number;
  withMaterialCount?: number;
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
   * `aria-label`s, for toasts and for the "Details for …" heading, and none of
   * those should change because a bill gained a classification.
   */
  subtitle?: string | null;
}
