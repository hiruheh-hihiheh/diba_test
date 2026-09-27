// src/pages/OwnerStock.tsx
// Stock by Owner. Implementation lives in StockPage, shared with Company stock;
// only the field list, labels and service calls differ between the two.

import { Package } from "lucide-react";
import StockPage, { formatAmount, type StockPageConfig } from "./StockPage";
import {
  fetchOwnerStocks,
  createOwnerStock,
  updateOwnerStock,
  deleteOwnerStock,
} from "../services/ownerStock";
import type { OwnerStock } from "../types/ownerStock";

const config: StockPageConfig = {
  heading: "Stock by Owner",
  noun: "owner stock records",
  nounSingular: "owner stock record",
  recordLabel: "Owner Stock",
  addLabel: "Add Stock",
  icon: <Package size={20} />,
  accent: "primary",
  crumbs: [{ label: "Stock" }, { label: "Stock by Owner" }],
  purpose:
    "Record metal bought in from an owner, with the folder and folio it came from. Add the first record to start tracking purchases.",
  describe: (r) => String(r.source_of_metal || r.folder_no || "Untitled record"),
  searchKeys: ["source_of_metal", "folder_no", "metal_type", "folio_number", "tn_no", "paint"],
  fields: [
    { key: "source_of_metal", label: "Source of Metal", placeholder: "Who the metal came from" },
    { key: "folder_no", label: "Folder No", placeholder: "e.g. F-104" },
    { key: "folio_number", label: "Folio Number", placeholder: "e.g. 12" },
    { key: "metal_type", label: "Metal Type", placeholder: "e.g. ferrous" },
    { key: "tn_no", label: "TN No", placeholder: "Transport note number" },
    { key: "paint", label: "Paint", placeholder: "Paint / grade reference" },
    { key: "amount_purchase", label: "Amount Purchase", type: "number", placeholder: "0" },
    { key: "recorded_time", label: "Recorded Time", placeholder: "When it was booked in" },
    {
      key: "processing_start",
      label: "Processing Start",
      placeholder: "YYYY-MM-DD",
      help: "Dates are free text. Use YYYY-MM-DD so records sort predictably.",
    },
    {
      key: "processing_end",
      label: "Processing End",
      placeholder: "YYYY-MM-DD",
      help: "Leave empty if processing has not started.",
    },
  ],
  columns: [
    {
      header: "Source",
      cell: (r) => (
        <span className="font-semibold text-text">{String(r.source_of_metal || "—")}</span>
      ),
    },
    {
      header: "Folder / Folio",
      cell: (r) => (
        <span className="text-text">
          {String(r.folder_no || "—")}
          {r.folio_number ? ` / ${r.folio_number}` : ""}
        </span>
      ),
    },
    {
      header: "Metal Type",
      hideBelow: "lg",
      cell: (r) => <span className="text-text-muted">{String(r.metal_type || "—")}</span>,
    },
    {
      header: "Amount",
      hideBelow: "lg",
      cell: (r) => (
        <span className="text-text-muted tabular-nums">
          {r.amount_purchase === null || r.amount_purchase === undefined
            ? "—"
            : formatAmount(r.amount_purchase)}
        </span>
      ),
    },
  ],
};

export default function OwnerStockPage() {
  return (
    <StockPage<OwnerStock>
      config={config}
      api={{
        list: fetchOwnerStocks,
        create: (input) => createOwnerStock(input),
        update: (id, input) => updateOwnerStock(id, input),
        remove: deleteOwnerStock,
      }}
    />
  );
}
