// supabase/functions/_selftest/challan-fixture.ts
//
// Delivery Challan worksheets for the self-tests, built in code.
//
// The layout is the supplied production challan template, cell for cell: title
// "DELIVERY CHALLAN" in B2, seller block B3:B7, customer down column B from row 8
// beside CHALLAN NO / Your Challan No. / Purchase-or-Service Order No. / Transporter
// Mode in column D (values in F, dates in H), the item table headed at row 15 with
// SR.NO. | DESCRIPTION | HSN CODE | UOM | Quantity | REMARKS, the job kind beside
// Total Quantity on row 32, the receipt line and "For <company>" on row 33 and the
// signatures on row 38 — then the same block again for the DUPLICATE copy.
//
// Only the identities differ: every name, number and address is a placeholder.
// The real workbook carries live GSTINs, phone numbers and e-mail addresses, so it
// is never committed; generating the sheet keeps the test reproducible without it.

import type { Sheet, SheetCell } from "../process-bill-upload/_shared/xlsx.ts";

export interface ChallanItem {
  description: string[];
  hsn: string;
  uom: string;
  quantity: number;
  remarks?: string;
}

export interface ChallanSpec {
  sheetName: string;
  challanNo: string;
  /** Excel date serial. */
  date: number;
  yourChallanNo?: string;
  yourChallanDate?: number;
  orderLabel?: "Purchase Order No.:" | "Service Order No.:";
  orderNo?: string;
  orderDate?: number;
  transporterMode?: string;
  jobKind: "LABOUR JOB" | "WITHMETAL";
  items: ChallanItem[];
  /** Copy blocks to write; the template has ORIGINAL and DUPLICATE. */
  copies?: ("ORIGINAL" | "DUPLICATE" | "TRIPLICATE")[];
}

const BLOCK_ROWS = 48;

export function makeChallanSheet(spec: ChallanSpec): Sheet {
  const cells = new Map<string, SheetCell>();
  let maxRow = 0;
  let maxCol = 0;
  const put = (row: number, col: number, value: string | number | undefined): void => {
    if (value === undefined || value === "") return;
    cells.set(`${row}:${col}`, { row, col, type: typeof value === "number" ? "number" : "inline", value });
    maxRow = Math.max(maxRow, row);
    maxCol = Math.max(maxCol, col);
  };
  const [B, C, D, E, F, G, H] = [1, 2, 3, 4, 5, 6, 7];
  const copies = spec.copies ?? ["ORIGINAL", "DUPLICATE"];

  copies.forEach((label, n) => {
    const o = n * BLOCK_ROWS;
    put(o + 0, B, label);
    put(o + 1, B, "DELIVERY CHALLAN");
    put(o + 2, B, "EXAMPLE ENGINEERING WORKS");
    put(o + 3, B, "Manufacturing Traders of Machinery,Precision Job Works & Industrial Products");
    put(o + 4, B, "GST No.27AAAAA0000A1Z5  MSME NO.UDYAM-XX-00-0000000");
    put(o + 5, B, "Office Address: Unit No.1, Example Estate, Example City - 000 001");
    put(o + 6, B, "Email (1):office@example.com Mob.0000000000");
    put(o + 7, B, "M/s. Example Cookers Ltd.,");
    put(o + 7, D, "CHALLAN NO");
    put(o + 7, F, spec.challanNo);
    put(o + 7, G, "Date:");
    put(o + 7, H, spec.date);
    put(o + 8, B, "C-21,22 \"U\" Road,");
    put(o + 8, D, "Your Challan No.:");
    put(o + 8, F, spec.yourChallanNo);
    put(o + 8, G, "Date:");
    put(o + 8, H, spec.yourChallanDate);
    put(o + 9, B, "Example Industrial Estate,");
    put(o + 9, D, spec.orderLabel ?? "Service Order No.:");
    put(o + 9, F, spec.orderNo);
    put(o + 9, G, "Date:");
    put(o + 9, H, spec.orderDate);
    put(o + 10, B, "Example City - 000 001.");
    put(o + 10, D, "Transporter Mode");
    put(o + 10, F, spec.transporterMode ?? "TEMPO");
    put(o + 11, B, "State: Maharashtra       State Code:27");
    put(o + 12, B, "Party's GST No.27AAAAA0000A1Z5");
    put(o + 14, B, "SR.NO.");
    put(o + 14, C, "D E S C R I P T I O N");
    put(o + 14, D, "HSN CODE");
    put(o + 14, E, "UOM");
    put(o + 14, F, "Quantity");
    put(o + 14, G, "REMARKS");
    let row = o + 15;
    spec.items.forEach((item, i) => {
      put(row, B, i + 1);
      put(row, C, item.description[0]);
      put(row, D, item.hsn);
      put(row, E, item.uom);
      put(row, F, item.quantity);
      put(row, G, item.remarks);
      row++;
      for (const more of item.description.slice(1)) {
        put(row, C, more);
        row++;
      }
    });
    if (row > o + 31) throw new Error("too many item rows for one challan block");
    put(o + 31, B, spec.jobKind);
    put(o + 31, D, "Total Quantity");
    put(o + 31, F, spec.items.reduce((sum, it) => sum + it.quantity, 0));
    put(o + 32, B, "Received above material in good & condition");
    put(o + 32, E, "For EXAMPLE ENGINEERING WORKS");
    put(o + 37, B, "(Receivers Signature)");
    put(o + 37, H, "(Proprietor)");
  });

  return { name: spec.sheetName, cells, maxRow, maxCol };
}

/**
 * A 20-sheet challan workbook shaped like the supplied one: sheet names "341 L"…
 * with a mix of LABOUR JOB and WITHMETAL, one- to three-item challans and wrapped
 * descriptions.
 */
export function challanWorkbookSheets(count = 20, firstNo = 341): Sheet[] {
  return Array.from({ length: count }, (_, i) => {
    const no = firstNo + i;
    const labour = i % 3 !== 2;
    const items: ChallanItem[] = Array.from({ length: (i % 3) + 1 }, (_, k) => ({
      description: k % 2 === 0 ? [`TOOL ${no}-${k + 1} BODY FLANGE BLANKING TOOL-EJECTOR FOR`, "TR"] : [`TOOL ${no}-${k + 1} SWAGING ROLLER ASSY`],
      hsn: k % 2 === 0 ? "82073000" : "84663020",
      uom: "NOS",
      quantity: k + 1,
      remarks: k === 1 ? "RETURN AFTER JOB WORK" : undefined,
    }));
    return makeChallanSheet({
      sheetName: labour ? `${no} L` : `${no}`,
      challanNo: `EXW/${no}/2026-27`,
      date: 46306 + i,
      yourChallanNo: i % 4 === 0 ? undefined : `EX/OGC/${260000 + no}`,
      yourChallanDate: i % 4 === 0 ? undefined : 46300 + i,
      orderLabel: labour ? "Service Order No.:" : "Purchase Order No.:",
      orderNo: `EX/${labour ? "SO" : "PO"}/${600000 + no}`,
      orderDate: 46299 + i,
      transporterMode: i % 2 === 0 ? "TEMPO" : "HAND DELIVERY",
      jobKind: labour ? "LABOUR JOB" : "WITHMETAL",
      items,
    });
  });
}

/** A copy of `sheet` under another name: the name must never affect classification. */
export function renamed(sheet: Sheet, name: string): Sheet {
  return { ...sheet, name, cells: new Map(sheet.cells) };
}
