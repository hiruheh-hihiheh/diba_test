// src/pages/BillingOverview.tsx
//
// The Billing entry point: one page, two cards, one click to either section.
//
// The two sections already exist and are untouched (`/bills` and `/challan-bills`).
// What they lacked was a place to be chosen from, so this page is that choice, plus
// the three numbers that tell an admin what is behind each card.
//
// THE NUMBERS ARE NOT ALL "COUNT THE UPLOADS"
//
// A hand-built bill has a synthetic `bill_uploads` row, so counting upload rows would
// count manual bills as Excel workbooks and let their creation time become the "latest
// upload". `fetchBillUploadSummary` therefore counts only rows whose
// `creation_source` is not `manual`, while the record count comes from the section's
// own bill query and therefore still includes manual bills. Nothing here reads a PDF
// or a workbook.

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, FileSpreadsheet, Receipt } from "lucide-react";

import { fetchBillUploadSummary, fetchBills } from "../services/bills";
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
  { title: string; description: string; icon: ReactNode; noun: string; singular: string }
> = {
  tax_invoice: {
    title: "Tax Invoice Billing",
    description:
      "Access all your Tax Invoice Excel workbooks, uploaded bills and generated PDF copies.",
    icon: <FileSpreadsheet size={22} />,
    noun: "Invoices",
    singular: "invoice",
  },
  delivery_challan: {
    title: "Challan Billing",
    description:
      "Access all your Delivery Challan Excel workbooks, uploaded challans and generated PDF copies.",
    icon: <Receipt size={22} />,
    noun: "Challans",
    singular: "challan",
  },
};

/** Tax first, then challans: the order the sections were introduced in. */
const CARD_ORDER: BillDocumentType[] = ["tax_invoice", "delivery_challan"];

function StatSkeleton() {
  return (
    <div className="min-w-0" aria-hidden="true">
      <div className="h-2.5 w-16 animate-pulse rounded bg-surface-hover" />
      <div className="mt-2 h-3.5 w-12 animate-pulse rounded bg-surface-hover" />
    </div>
  );
}

function StatCell({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-2 min-w-0" : "min-w-0"}>
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
      /* Workbook count and newest Excel upload come from the provenance-aware
         summary; the record count comes from the section's own bill query, which
         includes manual bills. `pageSize: 1` because only the `count` is used. */
      const [uploads, firstPage] = await Promise.all([
        fetchBillUploadSummary(type),
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
          const emptySection = !state.loading && !state.error && state.summary.bills === 0;

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
              ) : state.loading ? (
                <dl
                  className="grid grid-cols-3 gap-3 border-t border-border pt-4"
                  aria-busy="true"
                  aria-label={`Counting ${info.section}`}
                >
                  <StatSkeleton />
                  <StatSkeleton />
                  <StatSkeleton />
                </dl>
              ) : (
                <dl className="grid grid-cols-3 gap-3 border-t border-border pt-4">
                  <StatCell label="Workbooks" value={state.summary.workbooks.toLocaleString()} />
                  <StatCell label={content.noun} value={state.summary.bills.toLocaleString()} />
                  <StatCell
                    label="Latest upload"
                    value={
                      state.summary.latestUpload
                        ? formatUploadDate(state.summary.latestUpload)
                        : "No Excel uploads yet"
                    }
                  />
                </dl>
              )}

              {!state.loading && !state.error && (
                <div className="space-y-1">
                  {state.summary.workbooks === 0 && (
                    <p className="text-[11px] text-text-muted">No Excel workbooks uploaded yet.</p>
                  )}
                  {emptySection && (
                    <p className="text-[11px] text-text-muted">
                      This section is empty — open it to create a {content.singular} or upload a
                      workbook.
                    </p>
                  )}
                </div>
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
