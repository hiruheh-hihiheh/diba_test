// src/pages/JobImport.tsx
//
// Excel import.
//
// Problems this page had, and what changed:
//  * The destination folder was chosen inside a confirm dialog that appeared
//    only after the preview, so users could not tell where their jobs would
//    land until the moment they committed. It is now chosen up front, on the
//    page, and the chosen folder is named in the result summary.
//  * Picking a `labour` folder silently skipped every `with_material` row. The
//    page now counts and announces exactly how many rows will be skipped for
//    that reason *before* you import.
//  * Two submit paths existed (the header button and the dialog button) and
//    neither was disabled while running, so a double click could start a second
//    import. There is now one button, disabled while running, behind a
//    non-dismissable progress dialog.
//  * The result modal was the only place results appeared; closing it threw
//    them away. Results are now a persistent panel with a link to the folder.
//  * The preview rendered every row of the sheet. It is now filtered,
//    searchable, selectable and paged.
//  * All `alert()` calls became inline validation or a toast.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  UploadCloud,
  FileSpreadsheet,
  AlertTriangle,
  Info,
  CheckCircle2,
  Eye,
  Database,
  Download,
  Loader2,
  SearchX,
  FolderOpen,
  FolderPlus,
  FileCheck2,
  CopyCheck,
  XCircle,
  ArrowRight,
  Layers,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { parseExcelFile } from "../services/jobImportParser";
import { processJobImport } from "../services/jobImport";
import { fetchFolders, createFolder } from "../services/folders";
import type { ParserResult, ParsedExcelRow, ImportResult } from "../types/jobImport";
import type { AdminFolder } from "../types/folder";
import { getJobTypeLabel } from "../types/job";
import Modal from "../components/ui/Modal";
import EmptyState from "../components/ui/EmptyState";
import SearchInput from "../components/ui/SearchInput";
import IconButton from "../components/ui/IconButton";
import Pagination, { usePagination } from "../components/ui/Pagination";
import SelectAllCheckbox from "../components/ui/SelectAllCheckbox";
import { useSelection } from "../hooks/useSelection";
import { useToast } from "../components/ui/Toast";
import { usePageMeta } from "../contexts/PageMetaContext";
import { readableError } from "../utils/readableError";

type RowFilter = "all" | "ready" | "warnings" | "errors";
type Destination = { kind: "new"; name: string } | { kind: "existing"; id: string } | null;

const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** Skip reasons the import pipeline produces, grouped for the summary. */
function isDuplicateMessage(msg?: string) {
  if (!msg) return false;
  return /already exists|duplicate in this file/i.test(msg);
}

export default function JobImportPage() {
  const navigate = useNavigate();
  const toast = useToast();

  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [result, setResult] = useState<ParserResult | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const [importing, setImporting] = useState(false);
  const [progressNote, setProgressNote] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  const [inspectRow, setInspectRow] = useState<ParsedExcelRow | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [folders, setFolders] = useState<AdminFolder[]>([]);
  const [foldersLoading, setFoldersLoading] = useState(true);
  const [destination, setDestination] = useState<Destination>(null);

  const [rowFilter, setRowFilter] = useState<RowFilter>("all");
  const [rowSearch, setRowSearch] = useState("");
  const [dragging, setDragging] = useState(false);
  const rowSelection = useSelection();

  usePageMeta(
    {
      title: "Import from Excel",
      crumbs: [{ label: "Jobs" }, { label: "Import from Excel" }],
      subtitle: selectedFile
        ? `${selectedFile.name} — ${result?.summary.totalRows ?? 0} rows`
        : "Upload a workbook to preview and import jobs",
      /* The body header already explains the three steps, so the TopBar must not
         repeat the same sentence above the page name. */
      selfTitles: true,
    },
    [selectedFile?.name, result?.summary.totalRows]
  );

  useEffect(() => {
    fetchFolders()
      .then(setFolders)
      .catch(() => {
        toast.error({
          title: "Could not load folders",
          description:
            "You can still import by creating a new folder, but existing folders will not be listed.",
        });
      })      .finally(() => setFoldersLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Row classification ────────────────────────────── */

  const isRowEligible = useCallback(
    (r: ParsedExcelRow) =>
      r.errors.length === 0 && !!r.normalized.job_no && r.normalized.job_type !== null,
    []
  );

  const eligibleRows = useMemo(
    () => (result?.rows.filter(isRowEligible) ?? []),
    [result, isRowEligible]
  );

  const eligibleIds = useMemo(() => eligibleRows.map((r) => r.rowNumber).map(String), [eligibleRows]);

  /* Everything eligible starts selected, matching the previous "import all
     valid rows" behaviour, but now it is visible and adjustable. */
  useEffect(() => {
    if (result) rowSelection.replace(eligibleIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  const rowsWithWarnings = useMemo(
    () => eligibleRows.filter((r) => r.warnings.length > 0).length,
    [eligibleRows]
  );
  const rowsWithErrors = useMemo(
    () => (result?.rows.length ?? 0) - eligibleRows.length,
    [result, eligibleRows]
  );

  const targetFolder = useMemo(() => {
    if (!destination) return null;
    if (destination.kind === "existing") {
      return folders.find((f) => f.id === destination.id) ?? null;
    }
    return null;
  }, [destination, folders]);

  const targetFolderType = useMemo(() => {
    if (destination?.kind === "existing") return targetFolder?.folder_type ?? null;
    // A newly created folder is always general, so every job type is allowed.
    return destination?.kind === "new" ? ("general" as const) : null;
  }, [destination, targetFolder]);

  /* Rows the pipeline will skip because the chosen folder is typed. Surfacing
     this up front is the single most useful thing this page can do. */
  const typeMismatchRows = useMemo(() => {
    if (!targetFolderType || targetFolderType === "general") return 0;
    return eligibleIds.reduce((n, id) => {
      const row = result?.rows.find((r) => String(r.rowNumber) === id);
      return row && row.normalized.job_type !== targetFolderType ? n + 1 : n;
    }, 0);
  }, [eligibleIds, result, targetFolderType]);

  const selectedRows = useMemo(() => {
    if (!result) return [];
    return result.rows.filter((r) => rowSelection.selected.has(String(r.rowNumber)));
  }, [result, rowSelection.selected]);

  const destinationLabel =
    destination?.kind === "new"
      ? `new folder “${destination.name}”`
      : destination?.kind === "existing"
        ? `folder “${targetFolder?.name ?? "…"}”`
        : null;

  /* ── Preview filtering ────────────────────────────── */

  const filteredRows = useMemo(() => {
    if (!result) return [];
    const q = rowSearch.trim().toLowerCase();
    return result.rows.filter((r) => {
      if (rowFilter === "ready" && !isRowEligible(r)) return false;
      if (rowFilter === "warnings" && !(r.warnings.length > 0 && r.errors.length === 0)) return false;
      if (rowFilter === "errors" && !(r.errors.length > 0 || !r.normalized.job_no)) return false;
      if (!q) return true;
      return (
        (r.normalized.job_no ?? "").toLowerCase().includes(q) ||
        (r.normalized.tool_description ?? "").toLowerCase().includes(q) ||
        (r.normalized.tool_part ?? "").toLowerCase().includes(q) ||
        (r.normalized.status ?? "").toLowerCase().includes(q)
      );
    });
  }, [result, rowFilter, rowSearch, isRowEligible]);

  const rowPagination = usePagination(filteredRows.length, 50);
  const pageRows = useMemo(
    () => rowPagination.pageItems(filteredRows),
    [rowPagination.pageItems, filteredRows]
  );

  /* ── File handling ────────────────────────────────── */

  const handleFile = useCallback(async (file: File) => {
    if (!/\.(xlsx|xls)$/i.test(file.name)) {
      setParseError(
        `“${file.name}” is not an Excel workbook. Choose a .xlsx or .xls file.`
      );
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setParseError(
        `“${file.name}” is ${(file.size / 1024 / 1024).toFixed(1)} MB, over the ${MAX_FILE_BYTES / 1024 / 1024} MB limit. Split it into smaller files and import them one at a time.`
      );
      return;
    }

    setSelectedFile(file);
    setParsing(true);
    setParseError(null);
    setResult(null);
    setInspectRow(null);
    setImportResult(null);
    setImportError(null);
    setDestination(null);
    setRowFilter("all");
    setRowSearch("");

    try {
      const res = await parseExcelFile(file);
      setResult(res);
      if (res.error) {
        setParseError(res.error);
      } else if (res.rows.length === 0) {
        setParseError(
          `No job rows were found in sheet “${res.selectedSheet ?? "unknown"}”. Check that the file uses the expected Hawkins column layout.`
        );
      }
    } catch (err) {
      setParseError(
        readableError(err, {
          subject: `“${file.name}”`,
          fallback: `Could not read “${file.name}”. The file may be corrupt, password protected, or not really a spreadsheet.`,
          byKind: {
            /* A parser error usually means the columns did not line up, which is
               a data problem the user can fix, not a fault to apologise for. */
            schema: `“${file.name}” could not be read because a column it needs is missing. Check the sheet has the expected Hawkins column layout.`,
            connection: `“${file.name}” could not be read because the server could not be reached. Check your connection and try again.`,
          },
        }).message
      );
    } finally {
      setParsing(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, []);

  function handleReset() {
    setResult(null);
    setSelectedFile(null);
    setInspectRow(null);
    setImportResult(null);
    setImportError(null);
    setParseError(null);
    setDestination(null);
    setRowFilter("all");
    setRowSearch("");
  }

  async function handleRefreshFolders() {
    setFoldersLoading(true);
    try {
      setFolders(await fetchFolders());
    } catch {
      toast.error({ title: "Could not reload folders", description: "Please try again." });
    } finally {
      setFoldersLoading(false);
    }
  }

  /* ── Import ───────────────────────────────────────── */

  async function handleImport() {
    if (!result || !selectedFile || importing) return;

    if (!destination) {
      toast.warning("Choose a destination folder first.");
      return;
    }
    if (destination.kind === "new" && !destination.name.trim()) {
      toast.warning("Enter a name for the new folder.");
      return;
    }
    if (rowSelection.count === 0) {
      toast.warning("Select at least one row to import.");
      return;
    }

    setShowConfirm(false);
    setImporting(true);
    setImportError(null);
    setImportResult(null);
    setProgressNote(
      rowSelection.count > 500
        ? `Importing ${rowSelection.count} rows. Large imports can take a minute — please keep this window open.`
        : null
    );

    let targetFolderId = "";
    let createdFolderName: string | null = null;

    try {
      if (destination.kind === "new") {
        const name = destination.name.trim();
        setProgressNote("Creating the destination folder…");
        const { ok, data, error } = await createFolder(name, "general");
        if (!ok || !data) {
          setImportError(`The folder “${name}” could not be created. ${error ?? ""}`.trim());
          setImporting(false);
          setProgressNote(null);
          toast.error({
            title: "Could not create folder",
            description: error || "Import did not start. Check the folder name and try again.",
          });
          return;
        }
        targetFolderId = data.id;
        createdFolderName = name;
      } else {
        targetFolderId = destination.id;
      }

      setProgressNote(
        `Adding ${rowSelection.count} record${rowSelection.count === 1 ? "" : "s"}…`
      );

      /* Only the chosen rows are handed to the pipeline; the service is
         unchanged, it simply receives a smaller row set. */
      const payload: ParserResult = {
        selectedSheet: result.selectedSheet,
        ignoredSheets: result.ignoredSheets,
        rows: selectedRows,
        summary: {
          totalRows: selectedRows.length,
          validRows: selectedRows.filter((r) => r.warnings.length === 0).length,
          warningRows: selectedRows.filter((r) => r.warnings.length > 0).length,
          errorRows: selectedRows.filter((r) => r.errors.length > 0).length,
          labourRows: selectedRows.filter((r) => r.normalized.job_type === "labour").length,
          withMaterialRows: selectedRows.filter((r) => r.normalized.job_type === "with_material")
            .length,
          unknownJobTypeRows: selectedRows.filter((r) => r.normalized.job_type === null).length,
        },
        error: null,
      };

      const res = await processJobImport(selectedFile.name, payload, targetFolderId);
      setImportResult(res);

      const duplicates = res.rowResults.filter(
        (r) => r.status === "skipped" && isDuplicateMessage(r.message)
      ).length;
      const otherSkipped = res.skippedRows - duplicates;

      const headline =
        res.status === "failed"
          ? `Import failed — ${res.failedRows || res.totalRows} record(s) could not be saved`
          : `${res.createdRows} record${res.createdRows === 1 ? "" : "s"} imported${
              duplicates > 0 ? ` — ${duplicates} duplicate${duplicates === 1 ? "" : "s"}` : ""
            }${otherSkipped > 0 ? `, ${otherSkipped} skipped` : ""}${
              res.failedRows > 0 ? `, ${res.failedRows} failed` : ""
            }`;

      const savedTo = `Saved to ${
        createdFolderName ? `the new folder “${createdFolderName}”` : `“${targetFolder?.name}”`
      }.`;

      // A partial folder link means the rows exist but the folder does not
      // contain them. That must be an error toast, not a green success one.
      if (res.error) {
        toast.error({
          title: `${headline} — with problems`,
          description: `${savedTo} ${res.error}`,
        });
      } else {
        toast[res.status === "failed" ? "error" : "success"]({
          title: headline,
          description: savedTo,
        });
      }
    } catch (err) {
      const message = readableError(err, {
        subject: "the import",
        fallback:
          "The import could not be completed. Nothing was saved — please try again.",
        byKind: {
          "not-found":
            "The folder this import was going into no longer exists, so nothing was saved. Pick another folder and try again.",
          forbidden:
            "Your account does not have permission to add jobs to that folder, so nothing was saved.",
          connection:
            "The server could not be reached partway through, so the import stopped. Nothing was saved — check your connection and try again.",
        },
      }).message;
      setImportError(message);
      toast.error({ title: "Import failed", description: message });
    } finally {
      setImporting(false);
      setProgressNote(null);
    }
  }

  /* ── Mapping report ───────────────────────────────── */

  function handleDownloadReport() {
    if (!result || !selectedFile) return;

    const lines: string[] = [];
    const push = (s = "") => lines.push(s);

    push("============================================================");
    push("HAWKINS EXCEL MAPPING AUDIT REPORT");
    push("============================================================");
    push();
    /* The original used `lines.push("File:", name)`, which Array#push joins
       with commas — every two-part line in the report came out as
       "File:,workbook.xlsx". Template strings keep the label and value apart. */
    push(`File: ${selectedFile.name}`);
    push(`Selected Sheet: ${result.selectedSheet || "None"}`);
    push(`Ignored Sheets: ${result.ignoredSheets.join(", ") || "None"}`);
    push(`Destination: ${destinationLabel ?? "not chosen"}`);
    push(`Generated: ${new Date().toISOString()}`);
    push();
    push("SUMMARY");
    push("-------");
    push(`Total Rows: ${result.summary.totalRows}`);
    push(`Valid Rows: ${result.summary.validRows}`);
    push(`Warning Rows: ${result.summary.warningRows}`);
    push(`Error Rows: ${result.summary.errorRows}`);
    push(`Labour Rows: ${result.summary.labourRows}`);
    push(`With Material Rows: ${result.summary.withMaterialRows}`);
    push(`Unknown Job Type Rows: ${result.summary.unknownJobTypeRows}`);
    push(`Rows selected for import: ${rowSelection.count}`);
    push();

    if (importResult) {
      push("============================================================");
      push("IMPORT RESULT");
      push("============================================================");
      push();
      push(`Status: ${importResult.status}`);
      push(`Total Processed: ${importResult.totalRows}`);
      push(`Created: ${importResult.createdRows}`);
      push(`Skipped: ${importResult.skippedRows}`);
      push(`Failed: ${importResult.failedRows}`);
      push();
    }

    push("============================================================");
    push("HEADER / COLUMN MAPPING");
    push("============================================================");
    push();

    if (result.rows.length > 0) {
      const canonicalMap: Record<string, string> = {
        srno: "job_no",
        labourlwithmaterialbo: "job_type",
        jobtype: "job_type",
        jobgivendate: "job_given_date",
        postatus: "po_status",
        postatuspendingornumber: "po_status",
        tooldisc: "tool_description",
        tooldescription: "tool_description",
        toolpart: "tool_part",
        quantity: "quantity",
        expectedcompdate: "expected_completion_date",
        expectedcompletiondate: "expected_completion_date",
        currentmcingstatus: "current_machining_status",
        machiningstatus: "current_machining_status",
        statusiporcomp: "status",
        status: "status",
        drgstatus: "drawing_status",
        modelstatus: "model_status",
      };

      for (const k of Object.keys(result.rows[0].raw)) {
        const norm = String(k).toLowerCase().trim().replace(/[^a-z0-9]/g, "");
        lines.push(`"${k}" -> ${canonicalMap[norm] || "unmapped"}`);
      }
    } else {
      push("No rows found.");
    }
    push();

    for (const r of result.rows) {
      push("============================================================");
      push(`ROW ${r.rowNumber}`);
      push("============================================================");
      push();
      push("RAW EXCEL DATA:");
      for (const [k, v] of Object.entries(r.raw)) push(`  "${k}": ${JSON.stringify(v)}`);
      push();
      push("MAPPED / NORMALIZED DATA:");
      for (const [k, v] of Object.entries(r.normalized)) push(`  ${k}: ${JSON.stringify(v)}`);
      push();
      push("WARNINGS:");
      if (r.warnings.length > 0) for (const w of r.warnings) push(`  - ${w}`);
      else push("  None");
      push();
      push("ERRORS:");
      if (r.errors.length > 0) for (const err of r.errors) push(`  - ${err}`);
      else push("  None");
      const rowRes = importResult?.rowResults.find((x) => x.rowNumber === r.rowNumber);
      if (rowRes) {
        push();
        push("IMPORT OUTCOME:");
        push(`  status: ${rowRes.status}`);
        if (rowRes.message) push(`  message: ${rowRes.message}`);
      }
      push();
      push("------------------------------------------------------------");
      push();
    }

    push("============================================================");
    push("VALIDATION / ISSUES");
    push("============================================================");
    push();

    const issueRows = result.rows.filter((r) => r.warnings.length > 0 || r.errors.length > 0);
    if (issueRows.length === 0) {
      push("No issues found.");
    } else {
      for (const r of issueRows) {
        push(`- Excel row number: ${r.rowNumber}`);
        push(`- Job No: ${r.normalized.job_no || "null"}`);
        push(`- Raw values: ${JSON.stringify(r.raw)}`);
        push(`- warnings: ${JSON.stringify(r.warnings)}`);
        push(`- errors: ${JSON.stringify(r.errors)}`);
        push();
      }
    }

    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "Hawkins-Jobs-Status-Mapping-Audit.txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /* ── Derived summary of the import outcome ────────── */

  const outcome = useMemo(() => {
    if (!importResult) return null;
    const duplicates = importResult.rowResults.filter(
      (r) => r.status === "skipped" && isDuplicateMessage(r.message)
    );
    const otherSkipped = importResult.rowResults.filter(
      (r) => r.status === "skipped" && !isDuplicateMessage(r.message)
    );
    const failed = importResult.rowResults.filter((r) => r.status === "failed");
    return {
      duplicates,
      otherSkipped,
      failed,
      created: importResult.createdRows,
      total: importResult.totalRows,
    };
  }, [importResult]);

  /* The destination has to be usable before the primary action is live.

     The button used to be enabled with no destination chosen and only
     complained when clicked, which left the import looking ready to run and
     turned the first click into an error. Now the button is disabled until the
     destination is genuinely usable, and `destinationHint` says which of the
     two problems is outstanding. */
  const destinationReady =
    destination?.kind === "new"
      ? destination.name.trim().length > 0
      : destination?.kind === "existing"
        ? destination.id.length > 0
        : false;

  const destinationHint =
    destination?.kind === "new" && destination.name.trim().length === 0
      ? "give the new folder a name"
      : destination?.kind === "existing" && !destination.id
        ? "pick a folder from the list"
        : "choose where these jobs should go";

  const canStartImport =
    !!result && rowSelection.count > 0 && !parsing && !importing && destinationReady;

  /* ── Render ───────────────────────────────────────── */

  return (
    <div className="space-y-6 animate-fade-in">
      {/* ── Header ──
          No <h1>: the TopBar already says "Import from Excel". What remains
          states the three-step flow, which is the thing a first-time user
          actually needs to know about this page. */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 rounded-xl bg-primary-muted flex items-center justify-center shrink-0">
            <FileSpreadsheet size={22} className="text-primary" />
          </div>
          <p className="text-sm text-text-muted min-w-0 max-w-xl">
            Upload a workbook, check the columns line up, review every row, then
            choose which folder the jobs go into. Nothing is written until you
            confirm.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {result && (
            <>
              <IconButton
                label="Download the column-mapping report"
                icon={<Download size={17} />}
                onClick={handleDownloadReport}
                variant="surface"
                size="md"
              />
              <button
                type="button"
                onClick={handleReset}
                disabled={importing}
                className="px-4 py-2.5 rounded-xl bg-surface border border-border text-sm font-semibold text-text hover:bg-surface-hover transition-colors cursor-pointer disabled:opacity-50"
              >
                Choose another file
              </button>
            </>
          )}
          {!result && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={parsing}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-white text-sm font-bold transition-all shadow-lg shadow-primary/20 cursor-pointer disabled:opacity-60"
            >
              {parsing ? <Loader2 size={18} className="animate-spin" /> : <UploadCloud size={18} />}
              {parsing ? "Reading file…" : "Upload Excel"}
            </button>
          )}
        </div>
      </div>

      <input
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        ref={fileInputRef}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
      />

      {/* ── Step 1: upload ── */}
      {!result && !parsing && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files?.[0];
            if (f) handleFile(f);
          }}
          className={`border-2 border-dashed rounded-3xl bg-surface/30 transition-colors ${
            dragging ? "border-primary bg-primary/5" : "border-border"
          }`}
        >
          <EmptyState
            icon={<FileSpreadsheet size={30} />}
            title="Select a workbook to preview"
            description="Drop an .xlsx or .xls file here, or browse. The correct sheet is detected automatically and nothing is saved until you confirm the import."
            action={
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 px-6 py-3 rounded-xl bg-primary hover:bg-primary-hover text-white font-bold transition-all shadow-xl shadow-primary/20 cursor-pointer"
              >
                <UploadCloud size={20} />
                Browse Files
              </button>
            }
          />
        </div>
      )}

      {parsing && (
        <div
          className="flex flex-col items-center justify-center py-24 gap-4"
          role="status"
          aria-live="polite"
        >
          <Loader2 size={36} className="text-primary animate-spin" />
          <p className="text-base font-semibold text-text">Reading {selectedFile?.name}…</p>
          <p className="text-sm text-text-muted">Large workbooks can take a few seconds.</p>
        </div>
      )}

      {parseError && !parsing && (
        <div
          role="alert"
          className="flex items-start gap-3 px-4 py-3.5 rounded-xl bg-danger-muted border border-danger/25 text-danger"
        >
          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-bold">That file could not be used</p>
            <p className="text-sm mt-0.5">{parseError}</p>
          </div>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="text-sm font-bold underline underline-offset-2 cursor-pointer shrink-0"
          >
            Try another
          </button>
        </div>
      )}

      {/* ── Step 2: preview ── */}
      {result && !importing && (
        <div className="space-y-5">
          {/* Import outcome — persistent, not a throwaway modal. */}
          {outcome && (
            <section
              aria-label="Import result"
              className={`rounded-2xl border p-5 ${
                importResult?.status === "failed"
                  ? "bg-danger-muted/30 border-danger/30"
                  : outcome.failed.length > 0
                    ? "bg-warning-muted/20 border-warning/30"
                    : "bg-success-muted/20 border-success/30"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0">
                  <div
                    className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 ${
                      importResult?.status === "failed"
                        ? "bg-danger/15 text-danger"
                        : outcome.failed.length > 0
                          ? "bg-warning/15 text-warning"
                          : "bg-success/15 text-success"
                    }`}
                  >
                    {importResult?.status === "failed" ? (
                      <AlertTriangle size={22} />
                    ) : outcome.failed.length > 0 ? (
                      <Info size={22} />
                    ) : (
                      <CheckCircle2 size={22} />
                    )}
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-base font-extrabold text-text">
                      {outcome.created} of {outcome.total} record
                      {outcome.total === 1 ? "" : "s"} imported
                      {outcome.duplicates.length > 0 && ` — ${outcome.duplicates.length} duplicate${
                        outcome.duplicates.length === 1 ? "" : "s"
                      }`}
                      {outcome.otherSkipped.length > 0 && `, ${outcome.otherSkipped.length} skipped`}
                      {outcome.failed.length > 0 && `, ${outcome.failed.length} failed`}
                    </h2>
                    <p className="text-sm text-text-muted mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                      <span>
                        Saved to{" "}
                        {destination?.kind === "new" ? (
                          <strong className="text-text">
                            the new folder “{destination.name.trim()}”
                          </strong>
                        ) : (
                          <strong className="text-text">“{targetFolder?.name}”</strong>
                        )}
                      </span>
                      {destination?.kind === "existing" && targetFolder && (
                        <>
                          <ArrowRight size={13} />
                          <button
                            type="button"
                            onClick={() => navigate(`/folders/${targetFolder.id}`)}
                            className="font-bold text-primary hover:underline cursor-pointer"
                          >
                            Open folder
                          </button>
                        </>
                      )}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => navigate("/jobs/labour")}
                    className="px-3.5 py-2 rounded-lg border border-border text-xs font-bold text-text hover:bg-surface-hover transition-colors cursor-pointer"
                  >
                    View Labour Jobs
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate("/jobs/with-material")}
                    className="px-3.5 py-2 rounded-lg border border-border text-xs font-bold text-text hover:bg-surface-hover transition-colors cursor-pointer"
                  >
                    View With Material Jobs
                  </button>
                  <button
                    type="button"
                    onClick={handleReset}
                    className="px-3.5 py-2 rounded-lg bg-primary text-xs font-bold text-white hover:bg-primary-hover transition-colors cursor-pointer"
                  >
                    Import another file
                  </button>
                </div>
              </div>

              {(outcome.duplicates.length > 0 ||
                outcome.otherSkipped.length > 0 ||
                outcome.failed.length > 0) && (
                <details className="mt-4 group">
                  <summary className="cursor-pointer text-sm font-bold text-text-muted hover:text-text transition-colors select-none">
                    {/* A noun phrase rather than "the N rows that were not
                        imported": at N = 1 the sentence needed "was", and the
                        preview table below separately marks rows as "Not
                        imported" for problems found while parsing, which are not
                        in this count. Saying "Not imported (n)" next to the
                        reason list keeps the two apart. */}
                    Not imported ({outcome.duplicates.length + outcome.otherSkipped.length + outcome.failed.length})
                    {" — open to see why"}
                  </summary>
                  <div className="mt-3 max-h-64 overflow-y-auto scrollbar-thin space-y-1.5 pr-1">
                    {outcome.failed.map((r) => (
                      <IssueRow key={`f-${r.rowNumber}`} tone="failed" rowNumber={r.rowNumber} message={r.message} />
                    ))}
                    {outcome.duplicates.map((r) => (
                      <IssueRow key={`d-${r.rowNumber}`} tone="duplicate" rowNumber={r.rowNumber} message={r.message} />
                    ))}
                    {outcome.otherSkipped.map((r) => (
                      <IssueRow key={`s-${r.rowNumber}`} tone="skipped" rowNumber={r.rowNumber} message={r.message} />
                    ))}
                  </div>
                </details>
              )}
            </section>
          )}

          {importError && (
            <div
              role="alert"
              className="flex items-start gap-3 px-4 py-3.5 rounded-xl bg-danger-muted border border-danger/25 text-danger"
            >
              <AlertTriangle size={18} className="shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-bold">The import did not run</p>
                <p className="text-sm mt-0.5">{importError}</p>
              </div>
            </div>
          )}

          {/* Summary cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <SummaryCard
              icon={<FileSpreadsheet size={18} />}
              tone="primary"
              title="File"
              rows={[
                { label: "Name", value: selectedFile?.name ?? "—" },
                { label: "Sheet", value: result.selectedSheet || "none" },
                {
                  label: "Ignored sheets",
                  value: result.ignoredSheets.length
                    ? `${result.ignoredSheets.length}`
                    : "0",
                },
              ]}
            />
            <SummaryCard
              icon={<Layers size={18} />}
              tone="info"
              title="Rows"
              rows={[
                { label: "Total", value: result.summary.totalRows },
                { label: "Labour (L)", value: result.summary.labourRows },
                { label: "Material (BO)", value: result.summary.withMaterialRows },
              ]}
            />
            <SummaryCard
              icon={<CheckCircle2 size={18} />}
              tone="success"
              title="Ready to import"
              rows={[
                { label: "Clean", value: eligibleRows.length - rowsWithWarnings },
                { label: "With warnings", value: rowsWithWarnings, tone: "warning" },
                { label: "Cannot import", value: rowsWithErrors, tone: "danger" },
              ]}
            />
            <SummaryCard
              icon={<FileCheck2 size={18} />}
              tone="primary"
              title="Selection"
              rows={[
                { label: "Selected", value: rowSelection.count },
                { label: "Not selected", value: eligibleIds.length - rowSelection.count },
                { label: "Rows shown", value: filteredRows.length },
              ]}
            />
          </div>

          {/* Destination */}
          <section className="bg-surface border border-border rounded-2xl p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="text-base font-bold text-text flex items-center gap-2">
                  <FolderOpen size={17} className="text-primary" />
                  Where should these jobs go?
                </h2>
                <p className="text-sm text-text-muted mt-0.5">
                  Every imported job is filed into this folder. You can move them later.
                </p>
              </div>
              <button
                type="button"
                onClick={handleRefreshFolders}
                disabled={foldersLoading}
                className="text-xs font-bold text-primary hover:underline cursor-pointer disabled:opacity-50"
              >
                {foldersLoading ? "Loading folders…" : "Refresh folder list"}
              </button>
            </div>

            <div
              role="radiogroup"
              aria-label="Destination"
              className="grid grid-cols-1 sm:grid-cols-2 gap-3"
            >
              <DestinationOption
                selected={destination?.kind === "new"}
                onSelect={() => {
                  setDestination({
                    kind: "new",
                    name: `${(selectedFile?.name ?? "Jobs").replace(/\.[^/.]+$/, "")} - ${format(
                      new Date(),
                      "dd MMM yyyy"
                    )}`,
                  });
                }}
                icon={<FolderPlus size={17} />}
                title="Create a new folder"
                hint="Recommended for a fresh import"
              >
                <input
                  type="text"
                  value={destination?.kind === "new" ? destination.name : ""}
                  onChange={(e) => setDestination({ kind: "new", name: e.target.value })}
                  onFocus={() => setDestination({ kind: "new", name: "" })}
                  placeholder="Folder name"
                  aria-label="New folder name"
                  className="mt-2.5 w-full px-3 py-2 rounded-lg bg-bg border border-border text-sm text-text placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </DestinationOption>

              <DestinationOption
                selected={destination?.kind === "existing"}
                onSelect={() => setDestination({ kind: "existing", id: destination?.kind === "existing" ? destination.id : "" })}
                icon={<FolderOpen size={17} />}
                title="Add to an existing folder"
                hint={
                  folders.length === 0
                    ? "No folders yet"
                    : `${folders.length} folder${folders.length === 1 ? "" : "s"} available`
                }
              >
                <select
                  value={destination?.kind === "existing" ? destination.id : ""}
                  onChange={(e) => setDestination({ kind: "existing", id: e.target.value })}
                  disabled={folders.length === 0}
                  aria-label="Existing folder"
                  className="mt-2.5 w-full px-3 py-2 rounded-lg bg-bg border border-border text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                >
                  <option value="">Select a folder…</option>
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                      {f.folder_type ? ` (${f.folder_type.replace(/_/g, " ")} folder)` : ""}
                    </option>
                  ))}
                </select>
              </DestinationOption>
            </div>

            {typeMismatchRows > 0 && (
              <div className="mt-3.5 flex items-start gap-2.5 px-4 py-3 rounded-xl bg-warning-muted/40 border border-warning/30 text-warning">
                <AlertTriangle size={17} className="shrink-0 mt-0.5" />
                <p className="text-sm">
                  <strong className="font-bold">
                    {typeMismatchRows} selected row
                    {typeMismatchRows === 1 ? "" : "s"} will be skipped.
                  </strong>{" "}
                  “{targetFolder?.name}” is a {targetFolderType === "labour" ? "Labour" : "With Material"}{" "}
                  folder, so it cannot hold{" "}
                  {targetFolderType === "labour" ? "With Material" : "Labour"} jobs. Choose a general
                  folder, or create a new one, to import everything.
                </p>
              </div>
            )}
          </section>

          {/* Row table */}
          <div className="bg-surface border border-border rounded-2xl overflow-hidden flex flex-col">
            <div className="p-4 border-b border-border space-y-3">
              <div className="flex flex-col lg:flex-row gap-3 lg:items-center justify-between">
                <SearchInput
                  value={rowSearch}
                  onChange={setRowSearch}
                  scope="rows in this file"
                  unit="row"
                  resultCount={filteredRows.length}
                  totalCount={result.rows.length}
                  placeholder="Search job no, tool, status…"
                  className="lg:max-w-sm"
                />
                <div
                  className="flex items-center gap-1.5 overflow-x-auto scrollbar-none"
                  role="group"
                  aria-label="Filter rows"
                >
                  {(
                    [
                      ["all", `All (${result.rows.length})`],
                      ["ready", `Ready (${eligibleRows.length})`],
                      ["warnings", `Warnings (${rowsWithWarnings})`],
                      ["errors", `Cannot import (${rowsWithErrors})`],
                    ] as [RowFilter, string][]
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setRowFilter(key)}
                      aria-pressed={rowFilter === key}
                      className={`px-3.5 py-2 rounded-lg text-[13px] font-bold transition-colors whitespace-nowrap cursor-pointer border ${
                        rowFilter === key
                          ? "bg-primary text-white border-primary"
                          : "bg-bg border-border text-text-muted hover:text-text hover:bg-surface-hover"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {eligibleIds.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-xs font-semibold text-text cursor-pointer">
                    <SelectAllCheckbox
                      ids={eligibleIds}
                      selection={rowSelection}
                      label={`Select all ${eligibleIds.length} importable rows`}
                    />
                    Select all {eligibleIds.length} importable row
                    {eligibleIds.length === 1 ? "" : "s"}
                  </label>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-text-muted">
                      <strong className="text-text">{rowSelection.count}</strong> selected for import
                    </span>
                    {rowSelection.count > 0 && (
                      <button
                        type="button"
                        onClick={rowSelection.clear}
                        className="text-xs font-bold text-primary hover:underline cursor-pointer"
                      >
                        Clear selection
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {filteredRows.length === 0 ? (
              <EmptyState
                icon={<SearchX size={24} />}
                title="No rows in this view"
                description={
                  rowSearch.trim()
                    ? `Nothing in the workbook matches “${rowSearch.trim()}”.`
                    : `There are no ${rowFilter === "all" ? "" : rowFilter.replace("cannot import", "rows that cannot be imported")} rows.`
                }
                action={
                  <button
                    type="button"
                    onClick={() => {
                      setRowSearch("");
                      setRowFilter("all");
                    }}
                    className="px-4 py-2.5 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-hover transition-colors cursor-pointer"
                  >
                    Show all rows
                  </button>
                }
              />
            ) : (
              <>
                <div className="overflow-auto scrollbar-thin max-h-[60vh]">
                  <table className="w-full min-w-[64rem]">
                    <thead className="sticky-head">
                      <tr className="border-b border-border">
                        <th className="w-11 px-4 py-3">
                          <span className="sr-only">Select row</span>
                        </th>
                        <th className="px-4 py-3 text-left text-[11px] font-bold text-text-muted uppercase tracking-wider w-16">
                          Row
                        </th>
                        {importResult && (
                          <th className="px-4 py-3 text-left text-[11px] font-bold text-text-muted uppercase tracking-wider w-28">
                            Outcome
                          </th>
                        )}
                        <th className="px-4 py-3 text-left text-[11px] font-bold text-text-muted uppercase tracking-wider">
                          Job No
                        </th>
                        <th className="px-4 py-3 text-left text-[11px] font-bold text-text-muted uppercase tracking-wider">
                          Type
                        </th>
                        <th className="px-4 py-3 text-left text-[11px] font-bold text-text-muted uppercase tracking-wider">
                          Given
                        </th>
                        <th className="px-4 py-3 text-left text-[11px] font-bold text-text-muted uppercase tracking-wider">
                          PO
                        </th>
                        <th className="px-4 py-3 text-left text-[11px] font-bold text-text-muted uppercase tracking-wider">
                          Tool / Part
                        </th>
                        <th className="px-4 py-3 text-left text-[11px] font-bold text-text-muted uppercase tracking-wider">
                          Qty
                        </th>
                        <th className="px-4 py-3 text-left text-[11px] font-bold text-text-muted uppercase tracking-wider">
                          Exp. Comp
                        </th>
                        <th className="px-4 py-3 text-left text-[11px] font-bold text-text-muted uppercase tracking-wider">
                          Status
                        </th>
                        <th className="px-4 py-3 text-left text-[11px] font-bold text-text-muted uppercase tracking-wider w-72">
                          Issues
                        </th>
                        <th className="sticky-actions sticky-head-cell px-4 py-3 w-16">
                          <span className="sr-only">Inspect</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {pageRows.map((row) => {
                        const key = String(row.rowNumber);
                        const rowRes = importResult?.rowResults.find(
                          (r) => r.rowNumber === row.rowNumber
                        );
                        const eligible = isRowEligible(row);
                        const checked = rowSelection.isSelected(key);

                        const bgClass = rowRes
                          ? rowRes.status === "created"
                            ? "bg-success-muted/20"
                            : rowRes.status === "failed"
                              ? "bg-danger-muted/30"
                              : "bg-surface-hover/30"
                          : row.errors.length > 0
                            ? "bg-danger-muted/20"
                            : row.warnings.length > 0
                              ? "bg-warning-muted/20"
                              : "";

                        return (
                          <tr
                            key={row.rowNumber}
                            className={`transition-colors ${bgClass} ${
                              checked ? "ring-1 ring-inset ring-primary/30" : ""
                            }`}
                          >
                            <td className="px-4 py-3">
                              {eligible ? (
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => rowSelection.toggle(key)}
                                  aria-label={`Import Excel row ${row.rowNumber}${
                                    row.normalized.job_no ? ` (job ${row.normalized.job_no})` : ""
                                  }`}
                                  className="w-4 h-4 rounded accent-primary cursor-pointer"
                                />
                              ) : (
                                <span
                                  title="This row cannot be imported"
                                  aria-label="This row cannot be imported"
                                  className="inline-flex text-text-muted/40"
                                >
                                  <XCircle size={15} />
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm text-text-muted tabular-nums">
                              {row.rowNumber}
                            </td>
                            {importResult && (
                              <td className="px-4 py-3">
                                {rowRes?.status === "created" && (
                                  <span className="px-2 py-1 bg-success-muted text-success rounded text-[11px] font-bold">
                                    Added
                                  </span>
                                )}
                                {rowRes?.status === "skipped" && (
                                  <span className="px-2 py-1 bg-surface-hover text-text-muted rounded text-[11px] font-bold">
                                    {isDuplicateMessage(rowRes.message) ? "Duplicate" : "Skipped"}
                                  </span>
                                )}
                                {rowRes?.status === "failed" && (
                                  <span className="px-2 py-1 bg-danger-muted text-danger rounded text-[11px] font-bold">
                                    Failed
                                  </span>
                                )}
                                {!rowRes && (
                                  <span className="text-[11px] text-text-muted">Not imported</span>
                                )}
                              </td>
                            )}
                            <td className="px-4 py-3 text-sm font-semibold text-text">
                              {row.normalized.job_no || "—"}
                            </td>
                            <td className="px-4 py-3">
                              {row.normalized.job_type ? (
                                <span className="px-2 py-1 bg-surface-hover rounded text-xs text-text whitespace-nowrap">
                                  {getJobTypeLabel(row.normalized.job_type)}
                                </span>
                              ) : (
                                <span className="px-2 py-1 bg-warning-muted text-warning rounded text-[11px] font-bold">
                                  Unknown
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm text-text whitespace-nowrap">
                              {row.normalized.job_given_date || "—"}
                            </td>
                            <td className="px-4 py-3 text-sm text-text whitespace-nowrap">
                              {row.normalized.po_status || "—"}
                            </td>
                            <td
                              className="px-4 py-3 text-sm text-text max-w-[16rem] truncate"
                              title={`${row.normalized.tool_description ?? ""}${
                                row.normalized.tool_part ? " / " + row.normalized.tool_part : ""
                              }`}
                            >
                              {row.normalized.tool_description || "—"}
                              {row.normalized.tool_part ? ` / ${row.normalized.tool_part}` : ""}
                            </td>
                            <td className="px-4 py-3 text-sm text-text font-mono">
                              {row.normalized.quantity || "—"}
                            </td>
                            <td className="px-4 py-3 text-sm text-text whitespace-nowrap">
                              {row.normalized.expected_completion_date ||
                                row.normalized.expected_completion_note ||
                                "—"}
                            </td>
                            <td className="px-4 py-3 text-sm text-text whitespace-nowrap">
                              {row.normalized.status || "—"}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex flex-col gap-1">
                                {rowRes?.message ? (
                                  <span
                                    className={`text-[11px] font-bold flex items-start gap-1 ${
                                      rowRes.status === "failed" ? "text-danger" : "text-warning"
                                    }`}
                                  >
                                    <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                                    {rowRes.message}
                                  </span>
                                ) : (
                                  <>
                                    {row.errors.map((e, i) => (
                                      <span
                                        key={i}
                                        className="text-[11px] font-medium text-danger flex items-start gap-1"
                                      >
                                        <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                                        {e}
                                      </span>
                                    ))}
                                    {row.warnings.map((w, i) => (
                                      <span
                                        key={i}
                                        className="text-[11px] font-medium text-warning flex items-start gap-1"
                                      >
                                        <Info size={12} className="shrink-0 mt-0.5" />
                                        {w}
                                      </span>
                                    ))}
                                    {row.errors.length === 0 && row.warnings.length === 0 && (
                                      <span className="text-[11px] text-text-muted">—</span>
                                    )}
                                  </>
                                )}
                              </div>
                            </td>
                            <td className="sticky-actions px-4 py-3">
                              <IconButton
                                label={`Inspect the raw values in Excel row ${row.rowNumber}`}
                                size="sm"
                                tooltipPlacement="top-end"
                                icon={<Eye size={14} />}
                                onClick={() => setInspectRow(row)}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <Pagination {...rowPagination} itemLabel="rows" />
              </>
            )}

            {/* Import action bar */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-5 py-4 border-t border-border bg-surface-hover/30 shrink-0">
              <p className="text-sm text-text-muted text-center sm:text-left">
                {rowSelection.count > 0 ? (
                  destinationReady ? (
                    <>
                      <strong className="text-text">{rowSelection.count}</strong> row
                      {rowSelection.count === 1 ? "" : "s"} will be added to{" "}
                      <strong className="text-text">{destinationLabel}</strong>
                    </>
                  ) : (
                    <>
                      <strong className="text-text">{rowSelection.count}</strong> row
                      {rowSelection.count === 1 ? "" : "s"} ready —{" "}
                      <strong className="text-text">{destinationHint}</strong> to finish.
                    </>
                  )
                ) : (
                  "Select the rows you want to import."
                )}
              </p>
              <button
                type="button"
                onClick={() => {
                  setShowConfirm(true);
                }}
                disabled={!canStartImport}
                className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-success hover:bg-success/90 text-white text-sm font-bold transition-all shadow-lg shadow-success/20 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none whitespace-nowrap"
              >
                <Database size={17} />
                Import {rowSelection.count} row{rowSelection.count === 1 ? "" : "s"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirm dialog ── */}
      <Modal
        open={showConfirm}
        onClose={() => setShowConfirm(false)}
        size="md"
        title="Start the import?"
        subtitle={`${rowSelection.count} row${rowSelection.count === 1 ? "" : "s"} → ${destinationLabel}`}
        footer={
          <>
            <button
              type="button"
              onClick={() => setShowConfirm(false)}
              className="px-4 py-2.5 rounded-xl text-sm font-medium text-text-muted hover:text-text hover:bg-surface-hover transition-colors cursor-pointer"
            >
              Go back
            </button>
            <button
              type="button"
              onClick={handleImport}
              className="px-5 py-2.5 rounded-xl bg-success hover:bg-success/90 text-white text-sm font-bold transition-all shadow-lg shadow-success/20 cursor-pointer"
            >
              Import {rowSelection.count} row{rowSelection.count === 1 ? "" : "s"}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <dl className="rounded-xl border border-border divide-y divide-border overflow-hidden text-sm">
            <ConfirmRow label="Rows in the file" value={result?.summary.totalRows ?? 0} />
            <ConfirmRow
              label="Rows selected"
              value={rowSelection.count}
              tone="text-text font-bold"
            />
            <ConfirmRow
              label="Will be added"
              value={
                rowSelection.count -
                selectedRows.filter((r) => targetFolderType && targetFolderType !== "general" && r.normalized.job_type !== targetFolderType).length
              }
              tone="text-success font-bold"
            />
            {typeMismatchRows > 0 && (
              <ConfirmRow
                label="Will be skipped (wrong folder type)"
                value={typeMismatchRows}
                tone="text-warning font-bold"
              />
            )}
            <ConfirmRow label="Destination" value={destinationLabel ?? "—"} />
          </dl>

          <p className="px-4 py-3 rounded-xl bg-info-muted/30 border border-info/20 text-sm text-info">
            Existing jobs are never overwritten. A job number that already exists is skipped and
            reported as a duplicate.
          </p>

          <p className="text-xs text-text-muted">
            You can close this dialog and change the rows or the destination first — nothing is
            saved until you press Import.
          </p>
        </div>
      </Modal>

      {/* ── Progress: not dismissable, so an import cannot be abandoned or
             started twice. ── */}
      <Modal
        open={importing}
        onClose={() => undefined}
        size="sm"
        bare
        hideClose
      >
        <div className="flex flex-col items-center text-center py-4" role="status" aria-live="assertive">
          <Loader2 size={36} className="text-primary animate-spin" />
          <h2 className="mt-4 text-lg font-extrabold text-text">Importing jobs…</h2>
          <p className="mt-1.5 text-sm text-text-muted">
            {progressNote ?? "Do not close this window until the import finishes."}
          </p>
          <div className="mt-5 h-1.5 w-full rounded-full bg-surface-hover overflow-hidden">
            <div className="h-full w-1/3 bg-primary animate-progress" />
          </div>
        </div>
      </Modal>

      {/* ── Row inspector ── */}
      <Modal
        open={!!inspectRow}
        onClose={() => setInspectRow(null)}
        size="lg"
        title={inspectRow ? `Excel row ${inspectRow.rowNumber}` : "Row"}
        subtitle="Raw spreadsheet values, the mapped result, and the import outcome"
      >
        {inspectRow && (
          <div className="space-y-5">
            <JsonBlock label="Raw spreadsheet data" value={inspectRow.raw} />
            <JsonBlock label="Mapped result" value={inspectRow.normalized} />
            {inspectRow.errors.length > 0 && (
              <MessageList
                tone="danger"
                title="Blocked from importing"
                messages={inspectRow.errors}
              />
            )}
            {inspectRow.warnings.length > 0 && (
              <MessageList
                tone="warning"
                title="Imported with these warnings"
                messages={inspectRow.warnings}
              />
            )}
            {(() => {
              const rowRes = importResult?.rowResults.find(
                (r) => r.rowNumber === inspectRow.rowNumber
              );
              if (!rowRes) return null;
              return (
                <div>
                  <h4 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-2">
                    Import outcome
                  </h4>
                  <div
                    className={`flex items-center gap-2.5 px-4 py-3 rounded-xl text-sm font-semibold ${
                      rowRes.status === "created"
                        ? "bg-success-muted/40 text-success"
                        : rowRes.status === "failed"
                          ? "bg-danger-muted/40 text-danger"
                          : "bg-warning-muted/40 text-warning"
                    }`}
                  >
                    {rowRes.status === "created" ? (
                      <CheckCircle2 size={17} />
                    ) : rowRes.status === "failed" ? (
                      <AlertTriangle size={17} />
                    ) : (
                      <CopyCheck size={17} />
                    )}
                    {rowRes.status === "created"
                      ? "Imported and added to the folder"
                      : rowRes.status === "failed"
                        ? "Failed to import"
                        : "Skipped"}
                    {rowRes.message && <span className="font-normal">— {rowRes.message}</span>}
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </Modal>
    </div>
  );
}

/* ── Small local building blocks ──────────────────── */

function IssueRow({
  tone,
  rowNumber,
  message,
}: {
  tone: "failed" | "duplicate" | "skipped";
  rowNumber: number;
  message?: string;
}) {
  const cls =
    tone === "failed"
      ? "text-danger bg-danger-muted/30"
      : tone === "duplicate"
        ? "text-warning bg-warning-muted/30"
        : "text-text-muted bg-surface-hover/50";
  return (
    <div className={`flex items-start gap-2.5 px-3 py-2 rounded-lg text-xs ${cls}`}>
      <span className="font-bold tabular-nums shrink-0">Row {rowNumber}</span>
      <span className="flex-1">{message ?? "No reason recorded."}</span>
    </div>
  );
}

function MessageList({
  tone,
  title,
  messages,
}: {
  tone: "danger" | "warning";
  title: string;
  messages: string[];
}) {
  const cls = tone === "danger" ? "text-danger" : "text-warning";
  return (
    <div>
      <h4 className={`text-xs font-bold uppercase tracking-wider mb-2 ${cls}`}>{title}</h4>
      <ul className="space-y-1.5">
        {messages.map((m, i) => (
          <li key={i} className={`flex items-start gap-2 text-sm ${cls}`}>
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            {m}
          </li>
        ))}
      </ul>
    </div>
  );
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <h4 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-2">{label}</h4>
      <pre className="p-4 bg-bg rounded-xl text-xs font-mono text-text overflow-x-auto scrollbar-thin border border-border max-h-64">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function ConfirmRow({
  label,
  value,
  tone = "text-text",
}: {
  label: string;
  value: string | number;
  tone?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2.5">
      <dt className="text-text-muted">{label}</dt>
      <dd className={`text-right ${tone}`}>{value}</dd>
    </div>
  );
}

function SummaryCard({
  icon,
  tone,
  title,
  rows,
}: {
  icon: React.ReactNode;
  tone: "primary" | "info" | "success";
  title: string;
  rows: { label: string; value: string | number; tone?: "warning" | "danger" }[];
}) {
  const iconCls = {
    primary: "text-primary",
    info: "text-info",
    success: "text-success",
  }[tone];

  return (
    <div className="bg-surface border border-border rounded-2xl p-4">
      <div className="flex items-center gap-2.5 mb-3">
        <span className={iconCls}>{icon}</span>
        <h3 className="text-sm font-bold text-text truncate">{title}</h3>
      </div>
      <dl className="space-y-1">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between gap-3">
            <dt className="text-xs text-text-muted truncate">{r.label}</dt>
            <dd
              className={`text-sm font-bold tabular-nums shrink-0 ${
                r.tone === "warning"
                  ? "text-warning"
                  : r.tone === "danger"
                    ? "text-danger"
                    : "text-text"
              }`}
              title={typeof r.value === "string" ? r.value : undefined}
            >
              {r.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function DestinationOption({
  selected,
  onSelect,
  icon,
  title,
  hint,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  hint: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      role="radio"
      aria-checked={selected}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`cursor-pointer rounded-2xl border-2 p-4 transition-colors ${
        selected ? "border-primary bg-primary/5" : "border-border hover:border-border-hover"
      }`}
    >
      <div className="flex items-start gap-3">
        <span className={selected ? "text-primary" : "text-text-muted"}>{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-text">{title}</p>
          <p className="text-xs text-text-muted">{hint}</p>
        </div>
        <span
          className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 ${
            selected ? "border-primary bg-primary" : "border-border"
          }`}
        >
          {selected && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
        </span>
      </div>
      {selected && <div onClick={(e) => e.stopPropagation()}>{children}</div>}
    </div>
  );
}
