// src/pages/BillingOverview.tsx
//
// The Billing entry point: one page, two cards, one click to either section.
//
// The two sections already exist and are untouched (`/bills` and `/challan-bills`).
// What they lacked was a place to be chosen from: the sidebar used to list them as
// two destinations, which made "billing" look like two unrelated features. This page
// is only that choice, plus the three numbers that tell an admin which section they
// are about to open.
//
// The counts come from the same services the sections use — `fetchBillUploads(type)`
// and `fetchBills({ documentType: type })` — so a card cannot invent a figure, and
// the calls are scoped to one document type each. Nothing here reads a PDF or a
// workbook: the cards count rows, they do not download them.

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, FileSpreadsheet, Receipt } from "lucide-react";

import { fetchBillUploads, fetchBills } from "../services/bills";
import { DOCUMENT_TYPE_INFO, type BillDocumentType } from "../services/billDocumentTypes";
import {
  formatUploadDate,
  summarizeBilling,
  type BillingSummary,
} from "../services/billingOverview";
import { usePageMeta } from "../hooks/usePageMeta";

/** What one card is showing: a summary, a load, or the reason it could not load. */
interface CardState {
  summary: BillingSummary;
  loading: boolean;
  error: string | null;
}

const EMPTY: BillingSummary = { workbooks: 0, bills: 0, latestUpload: null };

const CARD_CONTENT: Record<
  BillDocumentType,
  { title: string; description: string; icon: ReactNode; noun: string }
> = {
  tax_invoice: {
    title: "Tax Invoice Billing",
    description:
      "Access all your Tax Invoice Excel workbooks, uploaded bills and generated PDF copies.",
    icon: <FileSpreadsheet size={22} />,
    noun: "Invoices",
  },
  delivery_challan: {
    title: "Challan Billing",
    description:
      "Access all your Delivery Challan Excel workbooks, uploaded challans and generated PDF copies.",
    icon: <Receipt size={22} />,
    noun: "Challans",
  },
};

/** Tax first, then challans: the order the sections were introduced in. */
const CARD_ORDER: BillDocumentType[] = ["tax_invoice", "delivery_challan"];

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-bold uppercase tracking-[0.08em] text-text-muted">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-bold text-text tabular-nums">{value}</dd>
    </div>
  );
}

export default function BillingOverviewPage() {
  const [cards, setCards] = useState<Record<BillDocumentType, CardState>>({
    tax_invoice: { summary: EMPTY, loading: true, error: null },
    delivery_challan: { summary: EMPTY, loading: true, error: null },
  });

  const loadType = useCallback(async (type: BillDocumentType) => {
    setCards((prev) => ({ ...prev, [type]: { ...prev[type], loading: true, error: null } }));
    try {
      /* Two reads, both already part of the section: the upload list answers
         "how many workbooks, and when was the newest one", and a one-row page answers
         "how many records" using the same `count` the list itself trusts. `pageSize: 1`
         is deliberate — the row is not used, and fetching 20 would not be more true. */
      const [uploads, firstPage] = await Promise.all([
        fetchBillUploads(type),
        fetchBills({ documentType: type, page: 1, pageSize: 1 }),
      ]);
      setCards((prev) => ({
        ...prev,
        [type]: {
          summary: summarizeBilling(uploads, firstPage.total),
          loading: false,
          error: null,
        },
      }));
    } catch (err) {
      /* One card failing must not blank the other: each is its own request. */
      setCards((prev) => ({
        ...prev,
        [type]: {
          ...prev[type],
          loading: false,
          error: err instanceof Error ? err.message : "This section could not be counted.",
        },
      }));
    }
  }, []);

  useEffect(() => {
    void loadType("tax_invoice");
    void loadType("delivery_challan");
  }, [loadType]);

  usePageMeta(
    {
      title: "Billing Overview",
      crumbs: [{ label: "Documents" }, { label: "Billing" }],
      subtitle: "Tax invoices and delivery challans, kept separate",
      selfTitles: true,
    },
    []
  );

  const anyError = CARD_ORDER.some((type) => cards[type].error !== null);

  return (
    <div className="space-y-5">
      <p className="max-w-2xl text-sm text-text-muted">
        Choose the billing section you want. Each one lists its own Excel workbooks,
        records and generated PDF copies — a Tax Invoice never appears under Challans,
        and a challan never appears under Tax Invoices.
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        {CARD_ORDER.map((type) => {
          const info = DOCUMENT_TYPE_INFO[type];
          const content = CARD_CONTENT[type];
          const state = cards[type];

          return (
            <Link
              key={type}
              to={info.route}
              className="group panel flex h-full flex-col gap-4 p-5 transition-all duration-150 hover:border-primary/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              aria-label={`Open ${content.title}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-muted text-primary">
                    {content.icon}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-base font-bold text-text">{content.title}</p>
                    <p className="text-xs text-text-muted">{info.section}</p>
                  </div>
                </div>
                <ArrowRight
                  size={18}
                  className="mt-1 shrink-0 text-text-muted transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-primary"
                />
              </div>

              <p className="text-sm leading-relaxed text-text-secondary">{content.description}</p>

              {state.error ? (
                <p className="rounded-lg border border-danger/30 bg-danger-muted px-3 py-2 text-xs text-danger">
                  {state.error}
                </p>
              ) : (
                <dl className="grid grid-cols-3 gap-3 border-t border-border pt-4">
                  <StatCell
                    label="Workbooks"
                    value={state.loading ? "—" : state.summary.workbooks.toLocaleString()}
                  />
                  <StatCell
                    label={content.noun}
                    value={state.loading ? "—" : state.summary.bills.toLocaleString()}
                  />
                  <StatCell
                    label="Latest upload"
                    value={state.loading ? "—" : formatUploadDate(state.summary.latestUpload)}
                  />
                </dl>
              )}

              <span className="mt-auto inline-flex items-center gap-1.5 text-xs font-semibold text-primary">
                Open {info.section}
                <ArrowRight size={13} />
              </span>
            </Link>
          );
        })}
      </div>

      {anyError && (
        <button
          type="button"
          onClick={() => {
            void loadType("tax_invoice");
            void loadType("delivery_challan");
          }}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border text-xs font-semibold text-text-muted hover:text-text hover:bg-surface-hover transition-colors cursor-pointer"
        >
          Try again
        </button>
      )}
    </div>
  );
}
