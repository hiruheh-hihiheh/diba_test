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

/**
 * What a folder is FOR.
 *
 * `labour` and `with_material` are the two job families the worker app files work
 * under; `general` is a job folder that takes either. `billing` is new: a folder
 * in the Billing section, which holds BILLS and nothing else.
 *
 * The Billing folder boundary is enforced by the database, not by this union —
 * see migration 0009's `enforce_billing_folder_items` trigger. This type only
 * names what a caller is allowed to ask for, and keeps a billing folder out of the
 * job-folder filters in the first place.
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
  folder_type: FolderKind | null;
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
