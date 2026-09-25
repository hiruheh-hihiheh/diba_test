export interface ParsedExcelRow {
  rowNumber: number;
  raw: Record<string, unknown>;
  normalized: {
    job_type: "labour" | "with_material" | null;
    job_no: string | null;
    job_given_date: string | null;
    po_status: string | null;
    tool_description: string | null;
    tool_part: string | null;
    quantity: string | null;
    expected_completion_date: string | null;
    expected_completion_note: string | null;
    current_machining_status: string | null;
    status: string | null;
    drawing_status: string | null;
    drawing_status_note: string | null;
    model_status: string | null;
  };
  warnings: string[];
  errors: string[];
}

export interface ImportPreviewSummary {
  totalRows: number;
  validRows: number;
  warningRows: number;
  errorRows: number;
  labourRows: number;
  withMaterialRows: number;
  unknownJobTypeRows: number;
}

export interface ParserResult {
  selectedSheet: string | null;
  ignoredSheets: string[];
  rows: ParsedExcelRow[];
  summary: ImportPreviewSummary;
  error: string | null;
}
