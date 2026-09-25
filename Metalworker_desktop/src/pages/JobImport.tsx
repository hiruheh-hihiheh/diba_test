import { useState, useRef } from "react";
import { UploadCloud, FileSpreadsheet, AlertTriangle, Info, CheckCircle2, Eye, X, Database } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { parseExcelFile } from "../services/jobImportParser";
import { processJobImport } from "../services/jobImport";
import type { ParserResult, ParsedExcelRow, ImportResult } from "../types/jobImport";
import { getJobTypeLabel } from "../types/job";
import AdminModal from "../components/ui/AdminModal";

export default function JobImportPage() {
  const [parsing, setParsing] = useState(false);
  const [result, setResult] = useState<ParserResult | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  const [inspectRow, setInspectRow] = useState<ParsedExcelRow | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    setParsing(true);
    setResult(null);
    setInspectRow(null);
    setImportResult(null);

    try {
      const res = await parseExcelFile(file);
      setResult(res);
    } catch (err) {
      setResult({
        selectedSheet: null,
        ignoredSheets: [],
        rows: [],
        summary: { totalRows: 0, validRows: 0, warningRows: 0, errorRows: 0, labourRows: 0, withMaterialRows: 0, unknownJobTypeRows: 0 },
        error: err instanceof Error ? err.message : "Failed to parse file."
      });
    } finally {
      setParsing(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function handleReset() {
    setResult(null);
    setSelectedFile(null);
    setInspectRow(null);
    setImportResult(null);
  }

  async function handleImport() {
    if (!result || !selectedFile) return;
    setShowConfirm(false);
    setImporting(true);
    try {
      const res = await processJobImport(selectedFile.name, result);
      setImportResult(res);
    } catch (err: any) {
      alert(`Import failed: ${err.message}`);
    } finally {
      setImporting(false);
    }
  }

  const eligibleRows = result?.rows.filter(r => r.errors.length === 0 && r.normalized.job_no && r.normalized.job_type !== null) || [];
  const rowsWithWarnings = eligibleRows.filter(r => r.warnings.length > 0).length;
  const rowsWithErrors = result?.rows.filter(r => r.errors.length > 0 || !r.normalized.job_no || r.normalized.job_type === null).length || 0;
  
  const canImport = result && eligibleRows.length > 0 && !parsing && !importing && !importResult;

  return (
    <div className="p-8 max-w-[1600px] mx-auto animate-fade-in flex flex-col h-full">
      
      {/* Header */}
      <div className="flex items-center justify-between mb-8 shrink-0">
        <div>
          <h1 className="text-3xl font-extrabold text-text tracking-tight mb-2">Import Jobs</h1>
          <p className="text-text-muted text-sm max-w-2xl">Upload an Excel file to parse, preview, and safely import new jobs.</p>
        </div>
        
        <div className="flex gap-4">
          <input 
            type="file" 
            accept=".xlsx, .xls"
            className="hidden" 
            ref={fileInputRef} 
            onChange={handleFileChange} 
          />
          {result && (
            <button 
              onClick={handleReset}
              disabled={importing}
              className="px-5 py-2.5 rounded-xl bg-surface border border-border text-text hover:bg-surface-hover font-semibold transition-all cursor-pointer disabled:opacity-50"
            >
              Upload Another
            </button>
          )}
          {!result && (
            <button 
              onClick={() => fileInputRef.current?.click()}
              disabled={parsing || importing}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-white font-bold transition-all shadow-lg shadow-primary/25 cursor-pointer disabled:opacity-50"
            >
              {parsing ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <UploadCloud size={20} />
              )}
              {parsing ? "Parsing..." : "Upload Excel"}
            </button>
          )}
          {canImport && (
            <button 
              onClick={() => setShowConfirm(true)}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-success hover:bg-success/90 text-white font-bold transition-all shadow-lg shadow-success/25 cursor-pointer"
            >
              <Database size={20} />
              Import Valid Rows
            </button>
          )}
        </div>
      </div>

      {!result && !parsing && (
        <div className="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-border rounded-3xl bg-surface/30">
          <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center text-primary mb-6">
            <FileSpreadsheet size={40} />
          </div>
          <h2 className="text-xl font-bold text-text mb-2">Select a workbook to preview</h2>
          <p className="text-text-muted mb-8 max-w-md text-center">
            Upload your `.xlsx` or `.xls` file. We will automatically find the correct sheet and preview the data.
          </p>
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-8 py-3.5 rounded-xl bg-primary hover:bg-primary-hover text-white font-bold transition-all shadow-xl shadow-primary/20 cursor-pointer"
          >
            <UploadCloud size={22} />
            Browse Files
          </button>
        </div>
      )}

      {importing && (
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="w-16 h-16 border-4 border-primary/20 border-t-primary rounded-full animate-spin mb-4" />
          <h2 className="text-xl font-bold text-text">Importing jobs...</h2>
          <p className="text-text-muted text-sm mt-2">Please wait while we safely process the records.</p>
        </div>
      )}

      {result && !importing && (
        <div className="flex flex-col flex-1 min-h-0">
          
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6 shrink-0">
            <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
              <div className="flex items-center gap-3 mb-3">
                <FileSpreadsheet size={20} className="text-primary" />
                <h3 className="font-bold text-text">File Info</h3>
              </div>
              <p className="text-sm font-semibold text-text truncate mb-1" title={selectedFile?.name}>{selectedFile?.name}</p>
              <p className="text-xs text-text-muted">
                Sheet: <span className="font-semibold text-primary">{result.selectedSheet || "None"}</span>
              </p>
              {result.ignoredSheets.length > 0 && (
                <p className="text-xs text-text-muted mt-1">
                  Ignored {result.ignoredSheets.length} sheet(s)
                </p>
              )}
            </div>

            <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
              <div className="flex items-center gap-3 mb-3">
                <Info size={20} className="text-info" />
                <h3 className="font-bold text-text">Rows Overview</h3>
              </div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-text-muted">Total Rows:</span>
                <span className="font-bold text-text">{result.summary.totalRows}</span>
              </div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-text-muted">Labour (L):</span>
                <span className="font-bold text-text">{result.summary.labourRows}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-text-muted">Material (BO):</span>
                <span className="font-bold text-text">{result.summary.withMaterialRows}</span>
              </div>
            </div>

            <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
              <div className="flex items-center gap-3 mb-3">
                <CheckCircle2 size={20} className="text-success" />
                <h3 className="font-bold text-text">Validation</h3>
              </div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-text-muted">Valid:</span>
                <span className="font-bold text-success">{result.summary.validRows}</span>
              </div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-text-muted">Warnings:</span>
                <span className={`font-bold ${result.summary.warningRows > 0 ? "text-warning" : "text-text"}`}>{result.summary.warningRows}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-text-muted">Errors:</span>
                <span className={`font-bold ${result.summary.errorRows > 0 ? "text-danger" : "text-text"}`}>{result.summary.errorRows}</span>
              </div>
            </div>

            <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm flex flex-col justify-center">
              {importResult ? (
                <div className="text-center px-4 py-3 bg-success/10 text-success border border-success/20 rounded-xl">
                  <p className="text-sm font-bold">Import Completed</p>
                  <p className="text-xs mt-1">Review the results below</p>
                </div>
              ) : (
                <div className="text-center px-4 py-3 bg-primary/10 text-primary border border-primary/20 rounded-xl">
                  <p className="text-sm font-bold">Preview Mode</p>
                  <p className="text-xs mt-1">Review before importing</p>
                </div>
              )}
            </div>
          </div>

          {result.error && (
            <div className="p-4 bg-danger-muted border border-danger/30 text-danger rounded-xl mb-6 flex items-start gap-3 shrink-0">
              <AlertTriangle size={20} className="shrink-0 mt-0.5" />
              <p className="text-sm font-medium">{result.error}</p>
            </div>
          )}

          {/* Table */}
          {result.rows.length > 0 && (
            <div className="flex-1 bg-surface border border-border rounded-2xl shadow-sm overflow-hidden flex flex-col">
              <div className="overflow-x-auto flex-1">
                <table className="w-full text-left border-collapse min-w-[1200px]">
                  <thead>
                    <tr className="border-b border-border bg-bg/50">
                      <th className="px-4 py-3 text-xs font-bold text-text-muted uppercase tracking-wider sticky top-0 bg-bg/95 backdrop-blur z-10 w-16">Row</th>
                      {importResult && (
                        <th className="px-4 py-3 text-xs font-bold text-text-muted uppercase tracking-wider sticky top-0 bg-bg/95 backdrop-blur z-10 w-24">Import Status</th>
                      )}
                      <th className="px-4 py-3 text-xs font-bold text-text-muted uppercase tracking-wider sticky top-0 bg-bg/95 backdrop-blur z-10">Job No</th>
                      <th className="px-4 py-3 text-xs font-bold text-text-muted uppercase tracking-wider sticky top-0 bg-bg/95 backdrop-blur z-10">Type</th>
                      <th className="px-4 py-3 text-xs font-bold text-text-muted uppercase tracking-wider sticky top-0 bg-bg/95 backdrop-blur z-10">Given</th>
                      <th className="px-4 py-3 text-xs font-bold text-text-muted uppercase tracking-wider sticky top-0 bg-bg/95 backdrop-blur z-10">PO</th>
                      <th className="px-4 py-3 text-xs font-bold text-text-muted uppercase tracking-wider sticky top-0 bg-bg/95 backdrop-blur z-10">Tool / Part</th>
                      <th className="px-4 py-3 text-xs font-bold text-text-muted uppercase tracking-wider sticky top-0 bg-bg/95 backdrop-blur z-10">Qty</th>
                      <th className="px-4 py-3 text-xs font-bold text-text-muted uppercase tracking-wider sticky top-0 bg-bg/95 backdrop-blur z-10">Exp. Comp</th>
                      <th className="px-4 py-3 text-xs font-bold text-text-muted uppercase tracking-wider sticky top-0 bg-bg/95 backdrop-blur z-10">Status</th>
                      <th className="px-4 py-3 text-xs font-bold text-text-muted uppercase tracking-wider sticky top-0 bg-bg/95 backdrop-blur z-10 w-[300px]">Issues</th>
                      <th className="px-4 py-3 text-xs font-bold text-text-muted uppercase tracking-wider sticky top-0 bg-bg/95 backdrop-blur z-10 w-20 text-center">Inspect</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {result.rows.map((row) => {
                      const rowRes = importResult?.rowResults.find(r => r.rowNumber === row.rowNumber);
                      const isCreated = rowRes?.status === "created";
                      const isSkipped = rowRes?.status === "skipped";
                      const isFailed = rowRes?.status === "failed";
                      
                      let bgClass = "";
                      if (importResult) {
                        if (isCreated) bgClass = "bg-success-muted/20";
                        else if (isSkipped) bgClass = "bg-surface-hover/30";
                        else if (isFailed) bgClass = "bg-danger-muted/30";
                      } else {
                        bgClass = row.errors.length > 0 ? "bg-danger-muted/30" : row.warnings.length > 0 ? "bg-warning-muted/30" : "";
                      }

                      return (
                        <tr key={row.rowNumber} className={`hover:bg-surface-hover/50 transition-colors ${bgClass}`}>
                          <td className="px-4 py-3 text-sm text-text-muted">{row.rowNumber}</td>
                          
                          {importResult && (
                            <td className="px-4 py-3">
                              {isCreated && <span className="px-2 py-1 bg-success-muted text-success rounded text-xs font-bold">Created</span>}
                              {isSkipped && <span className="px-2 py-1 bg-surface-hover text-text-muted rounded text-xs font-bold">Skipped</span>}
                              {isFailed && <span className="px-2 py-1 bg-danger-muted text-danger rounded text-xs font-bold">Failed</span>}
                            </td>
                          )}

                          <td className="px-4 py-3 text-sm font-semibold text-text">{row.normalized.job_no || "—"}</td>
                          <td className="px-4 py-3">
                            {row.normalized.job_type ? (
                              <span className="px-2 py-1 bg-surface-hover rounded text-xs text-text">{getJobTypeLabel(row.normalized.job_type)}</span>
                            ) : (
                              <span className="px-2 py-1 bg-warning-muted text-warning rounded text-xs font-bold">Unknown</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm text-text">{row.normalized.job_given_date || "—"}</td>
                          <td className="px-4 py-3 text-sm text-text">{row.normalized.po_status || "—"}</td>
                          <td className="px-4 py-3 text-sm text-text truncate max-w-[150px]" title={`${row.normalized.tool_description || ""}${row.normalized.tool_part ? ' / ' + row.normalized.tool_part : ''}`}>
                            {row.normalized.tool_description || "—"}{row.normalized.tool_part ? ` / ${row.normalized.tool_part}` : ""}
                          </td>
                          <td className="px-4 py-3 text-sm text-text font-mono">{row.normalized.quantity || "—"}</td>
                          <td className="px-4 py-3 text-sm text-text">
                            {row.normalized.expected_completion_date || row.normalized.expected_completion_note || "—"}
                          </td>
                          <td className="px-4 py-3 text-sm text-text">{row.normalized.status || "—"}</td>
                          <td className="px-4 py-3">
                            <div className="flex flex-col gap-1">
                              {rowRes?.message && (
                                <span className={`text-[11px] font-bold ${isFailed ? 'text-danger' : 'text-warning'} flex items-start gap-1`}>
                                  <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                                  {rowRes.message}
                                </span>
                              )}
                              {!rowRes?.message && row.errors.map((err, i) => (
                                <span key={i} className="text-[11px] font-medium text-danger flex items-start gap-1">
                                  <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                                  {err}
                                </span>
                              ))}
                              {!rowRes?.message && row.warnings.map((warn, i) => (
                                <span key={i} className="text-[11px] font-medium text-warning flex items-start gap-1">
                                  <Info size={12} className="shrink-0 mt-0.5" />
                                  {warn}
                                </span>
                              ))}
                              {!rowRes?.message && row.errors.length === 0 && row.warnings.length === 0 && (
                                <span className="text-[11px] text-text-muted">—</span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <button 
                              onClick={() => setInspectRow(row)}
                              className="p-1.5 rounded-lg bg-surface-hover text-text-muted hover:text-primary hover:bg-primary/10 transition-colors cursor-pointer inline-flex"
                              title="Inspect Raw Row"
                            >
                              <Eye size={16} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Confirmation Modal */}
      <AdminModal open={showConfirm} onClose={() => setShowConfirm(false)}>
          <div className="relative bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-md p-6 flex flex-col animate-scale-in">
            <h2 className="text-xl font-extrabold text-text mb-4">Confirm Import</h2>
            <div className="space-y-3 mb-6">
              <div className="flex justify-between text-sm">
                <span className="text-text-muted">Total Rows:</span>
                <span className="font-bold text-text">{result?.summary.totalRows}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-text-muted">Rows ready to import:</span>
                <span className="font-bold text-success">{eligibleRows.length}</span>
              </div>
              {rowsWithWarnings > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-text-muted">Rows with warnings (will be imported):</span>
                  <span className="font-bold text-warning">{rowsWithWarnings}</span>
                </div>
              )}
              {rowsWithErrors > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-text-muted">Rows that will be skipped (errors):</span>
                  <span className="font-bold text-danger">{rowsWithErrors}</span>
                </div>
              )}
            </div>
            
            <div className="p-3 bg-info-muted/30 border border-info/20 rounded-xl mb-6">
              <p className="text-sm font-medium text-info text-center">Existing jobs will not be overwritten.</p>
            </div>

            <div className="flex gap-3 justify-end">
              <button 
                onClick={() => setShowConfirm(false)}
                className="px-5 py-2.5 rounded-xl font-semibold text-text hover:bg-surface-hover transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button 
                onClick={handleImport}
                className="px-5 py-2.5 rounded-xl bg-success hover:bg-success/90 text-white font-bold shadow-lg shadow-success/20 transition-all cursor-pointer"
              >
                Start Import
              </button>
            </div>
          </div>
      </AdminModal>

      {/* Import Result Modal */}
      <AdminModal open={!!importResult} onClose={() => setImportResult(null)}>
        {importResult && (
          <div className="relative bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-md p-6 flex flex-col animate-scale-in text-center">
            <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${
              importResult.status === 'failed' ? 'bg-danger/10 text-danger' :
              importResult.status === 'partial' ? 'bg-warning/10 text-warning' :
              'bg-success/10 text-success'
            }`}>
              {importResult.status === 'failed' ? (
                <AlertTriangle size={32} />
              ) : importResult.status === 'partial' ? (
                <Info size={32} />
              ) : (
                <CheckCircle2 size={32} />
              )}
            </div>
            <h2 className="text-2xl font-extrabold text-text mb-2">
              {importResult.status === 'failed' ? 'Import Failed' : importResult.status === 'partial' ? 'Import Partially Completed' : 'Import Completed'}
            </h2>
            <p className="text-sm font-medium mb-4">
              {importResult.status === 'completed' && <span className="text-success">All eligible rows were imported successfully.</span>}
              {importResult.status === 'partial' && <span className="text-warning">Some rows were created while others were skipped or failed.</span>}
              {importResult.status === 'failed' && <span className="text-danger">The import did not complete successfully.</span>}
            </p>
            <p className="text-sm text-text-muted mb-6">
              File: <strong className="text-text">{selectedFile?.name}</strong><br/>
              Sheet: <strong className="text-text">{result?.selectedSheet}</strong>
            </p>

            <div className="bg-bg rounded-xl border border-border p-4 mb-8 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="font-semibold text-text-muted">Total Processed:</span>
                <span className="font-bold text-text">{importResult.totalRows}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="font-semibold text-text-muted">Created:</span>
                <span className="font-bold text-success">{importResult.createdRows}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="font-semibold text-text-muted">Skipped:</span>
                <span className="font-bold text-warning">{importResult.skippedRows}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="font-semibold text-text-muted">Failed:</span>
                <span className={`font-bold ${importResult.failedRows > 0 ? "text-danger" : "text-text"}`}>{importResult.failedRows}</span>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <button 
                onClick={() => setImportResult(null)}
                className="w-full py-3 rounded-xl bg-surface-hover hover:bg-border text-text font-bold transition-colors cursor-pointer"
              >
                Close
              </button>
              <div className="flex gap-3">
                <button 
                  onClick={() => navigate("/jobs/labour")}
                  className="flex-1 py-2.5 rounded-xl border border-border text-primary hover:bg-primary/5 font-semibold transition-colors cursor-pointer text-sm"
                >
                  View Labour Jobs
                </button>
                <button 
                  onClick={() => navigate("/jobs/with-material")}
                  className="flex-1 py-2.5 rounded-xl border border-border text-primary hover:bg-primary/5 font-semibold transition-colors cursor-pointer text-sm"
                >
                  View With Material Jobs
                </button>
              </div>
            </div>
          </div>
        )}
      </AdminModal>

      {/* Inspect Modal */}
      <AdminModal open={!!inspectRow} onClose={() => setInspectRow(null)}>
        {inspectRow && (
          <div className="relative bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col animate-scale-in">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
              <div>
                <h3 className="text-lg font-bold text-text">Inspect Row {inspectRow.rowNumber}</h3>
                <p className="text-sm text-text-muted">Raw Spreadsheet Data</p>
              </div>
              <button onClick={() => setInspectRow(null)} className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text hover:bg-surface-hover transition-colors cursor-pointer">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 overflow-y-auto flex-1">
              <pre className="p-4 bg-bg rounded-xl text-sm font-mono text-text overflow-x-auto border border-border">
                {JSON.stringify(inspectRow.raw, null, 2)}
              </pre>
              
              <h4 className="text-sm font-bold text-text mt-6 mb-2">Mapped Result</h4>
              <pre className="p-4 bg-bg rounded-xl text-sm font-mono text-text overflow-x-auto border border-border">
                {JSON.stringify(inspectRow.normalized, null, 2)}
              </pre>

              {importResult?.rowResults.find(r => r.rowNumber === inspectRow.rowNumber) && (
                <>
                  <h4 className="text-sm font-bold text-text mt-6 mb-2">Import Status</h4>
                  <pre className="p-4 bg-bg rounded-xl text-sm font-mono text-text overflow-x-auto border border-border">
                    {JSON.stringify(importResult.rowResults.find(r => r.rowNumber === inspectRow.rowNumber), null, 2)}
                  </pre>
                </>
              )}
            </div>
          </div>
        )}
      </AdminModal>
    </div>
  );
}
