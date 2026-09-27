// src/pages/CompanyStock.tsx
// Stock by Company. Implementation lives in StockPage, shared with Owner stock;
// only the field list, labels and service calls differ between the two.

import { Building2 } from "lucide-react";
import StockPage, { type StockPageConfig } from "./StockPage";
import {
  fetchCompanyStocks,
  createCompanyStock,
  updateCompanyStock,
  deleteCompanyStock,
} from "../services/companyStock";
import type { CompanyStock } from "../types/companyStock";

const config: StockPageConfig = {
  heading: "Stock by Company",
  noun: "company stock records",
  nounSingular: "company stock record",
  recordLabel: "Company Stock",
  addLabel: "Add Stock",
  icon: <Building2 size={20} />,
  accent: "purple",
  crumbs: [{ label: "Stock" }, { label: "Stock by Company" }],
  purpose:
    "Record stock received from a company against a company product. Add the first record to start tracking deliveries.",
  describe: (r) =>
    [r.company_name, r.product_name].filter(Boolean).join(" · ") || "Untitled record",
  searchKeys: ["company_name", "product_name", "folder_no", "metal_type", "folio_number"],
  fields: [
    { key: "company_name", label: "Company Name", placeholder: "Supplier company" },
    { key: "product_name", label: "Product Name", placeholder: "Product or grade" },
    { key: "metal_type", label: "Metal Type", placeholder: "e.g. non-ferrous" },
    { key: "processed_metal_type", label: "Processed Metal Type", placeholder: "After processing" },
    { key: "folder_no", label: "Folder No", placeholder: "e.g. F-104" },
    { key: "folio_number", label: "Folio Number", placeholder: "e.g. 12" },
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
      header: "Company",
      cell: (r) => <span className="font-semibold text-text">{String(r.company_name || "—")}</span>,
    },
    {
      header: "Product",
      cell: (r) => <span className="text-text">{String(r.product_name || "—")}</span>,
    },
    {
      header: "Metal Type",
      hideBelow: "lg",
      cell: (r) => <span className="text-text-muted">{String(r.metal_type || "—")}</span>,
    },
    {
      header: "Folder / Folio",
      hideBelow: "lg",
      cell: (r) => (
        <span className="text-text-muted">
          {String(r.folder_no || "—")}
          {r.folio_number ? ` / ${r.folio_number}` : ""}
        </span>
      ),
    },
  ],
};

export default function CompanyStockPage() {
  return (
    <StockPage<CompanyStock>
      config={config}
      api={{
        list: fetchCompanyStocks,
        create: (input) => createCompanyStock(input),
        update: (id, input) => updateCompanyStock(id, input),
        remove: deleteCompanyStock,
      }}
    />
  );
}
