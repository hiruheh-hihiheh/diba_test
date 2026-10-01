// src/types/folder.ts

export type FolderItemType =
  | "owner_stock"
  | "company_stock"
  | "bill_group"
  | "drawing_group"
  | "job"
  | "bill";

/**
 * What a folder is FOR.
 *
 * `labour` and `with_material` are the two job families the worker app files work
 * under; `general` is a job folder that takes either. `billing` is new: a folder
 * in the Billing section, which holds BILLS and nothing else.
 *
 * The Billing folder boundary is enforced by the database, not by this union —
 * see migration 0009's `enforce_billing_folder_items` trigger.
 */
export type FolderKind = "labour" | "with_material" | "general" | "billing";

/** The `folder_type` value that marks a folder as a Billing folder. */
export const BILLING_FOLDER_KIND: FolderKind = "billing";

export interface AdminFolder {
  id: string;
  name: string;
  /**
   * `null` on every folder created before the Billing section existed — those are
   * general job folders and must keep behaving exactly as they did.
   */
  folder_type?: FolderKind | null;
  created_at: string;
  updated_at: string;
  itemCount?: number;
  labourCount?: number;
  withMaterialCount?: number;
  /** Bills linked to this folder. Only ever non-zero for a `billing` folder. */
  billCount?: number;
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
