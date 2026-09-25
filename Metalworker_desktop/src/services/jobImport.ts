import { supabase } from "../lib/supabase";
import type { ParserResult, ImportResult, ImportRowResult } from "../types/jobImport";

export async function processJobImport(
  fileName: string,
  parserResult: ParserResult
): Promise<ImportResult> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) {
    throw new Error("Must be logged in to import jobs");
  }

  const userId = userData.user.id;

  // 1. Create import record
  const { data: importRecord, error: importError } = await supabase
    .from("job_imports")
    .insert({
      file_name: fileName,
      uploaded_by: userId,
      status: "processing",
      total_rows: parserResult.summary.totalRows,
      created_rows: 0,
      updated_rows: 0,
      skipped_rows: 0,
      failed_rows: 0,
      mapping: {},
      metadata: {
        selectedSheet: parserResult.selectedSheet,
        ignoredSheets: parserResult.ignoredSheets
      }
    })
    .select()
    .single();

  if (importError || !importRecord) {
    throw new Error(`Failed to create import record: ${importError?.message}`);
  }

  const importId = importRecord.id;

  const rowResults: ImportRowResult[] = [];
  let createdCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  // Track duplicates within the current import
  const seenJobKeys = new Set<string>();

  for (const row of parserResult.rows) {
    const { normalized, errors, rowNumber, raw } = row;

    const logError = async (field: string | null, value: string | null, msg: string) => {
      await supabase.from("job_import_errors").insert({
        import_id: importId,
        row_number: rowNumber,
        field_name: field,
        raw_value: value,
        error_message: msg,
        raw_row: raw
      });
    };

    // Pre-import skips
    if (errors.length > 0) {
      skippedCount++;
      rowResults.push({ rowNumber, status: "skipped", message: errors.join(", ") });
      await logError(null, null, `Parser errors: ${errors.join(", ")}`);
      continue;
    }

    if (!normalized.job_no) {
      skippedCount++;
      rowResults.push({ rowNumber, status: "skipped", message: "Missing Job No" });
      await logError("job_no", null, "Missing Job No");
      continue;
    }

    if (normalized.job_type !== "labour" && normalized.job_type !== "with_material") {
      skippedCount++;
      rowResults.push({ rowNumber, status: "skipped", message: "Unknown job type" });
      await logError("job_type", String(raw.job_type || raw.labourlwithmaterialbo || ""), `Unknown job type value: ${raw.job_type || raw.labourlwithmaterialbo}`);
      continue;
    }

    const jobKey = `${normalized.job_no}-${normalized.job_type}`;
    
    if (seenJobKeys.has(jobKey)) {
      skippedCount++;
      rowResults.push({ rowNumber, status: "skipped", message: "Duplicate job within current import." });
      await logError(null, null, "Duplicate job within current import.");
      continue;
    }

    seenJobKeys.add(jobKey);

    // Check DB for existing job
    const { data: existingJob, error: checkError } = await supabase
      .from("jobs")
      .select("id")
      .eq("job_no", normalized.job_no)
      .eq("job_type", normalized.job_type)
      .maybeSingle();

    if (checkError) {
      failedCount++;
      rowResults.push({ rowNumber, status: "failed", message: "Database error checking existing job" });
      await logError(null, null, `Database error: ${checkError.message}`);
      continue;
    }

    if (existingJob) {
      skippedCount++;
      rowResults.push({ rowNumber, status: "skipped", message: "Job already exists in jobs table." });
      await logError(null, null, "Job already exists in jobs table.");
      continue;
    }

    // Prepare insert payload
    const payload: Record<string, any> = {
      job_no: normalized.job_no,
      job_type: normalized.job_type,
      job_given_date: normalized.job_given_date,
      po_status: normalized.po_status,
      tool_description: normalized.tool_description,
      tool_part: normalized.tool_part,
      quantity: normalized.quantity,
      expected_completion_date: normalized.expected_completion_date,
      expected_completion_note: normalized.expected_completion_note,
      current_machining_status: normalized.current_machining_status,
      status: normalized.status || "Pending",
      drawing_status: normalized.drawing_status,
      drawing_status_note: normalized.drawing_status_note,
      model_status: normalized.model_status,
    };
    
    // Convert empty strings to null (except status, we default it to Pending above just in case)
    Object.keys(payload).forEach(k => {
      if (payload[k] === "") {
        payload[k] = null;
      }
    });

    const { data: insertedJob, error: insertError } = await supabase
      .from("jobs")
      .insert(payload)
      .select("id")
      .single();

    if (insertError) {
      failedCount++;
      rowResults.push({ rowNumber, status: "failed", message: insertError.message });
      await logError(null, null, `Insert failed: ${insertError.message}`);
    } else {
      createdCount++;
      rowResults.push({ rowNumber, status: "created", jobId: insertedJob.id });
    }
  }

  // Update import record
  let finalStatus = "completed";
  if (createdCount === 0 && (skippedCount > 0 || failedCount > 0)) {
    finalStatus = "failed";
  } else if (skippedCount > 0 || failedCount > 0) {
    finalStatus = "partial";
  }

  await supabase
    .from("job_imports")
    .update({
      status: finalStatus,
      created_rows: createdCount,
      skipped_rows: skippedCount,
      failed_rows: failedCount
    })
    .eq("id", importId);

  return {
    importId,
    totalRows: parserResult.summary.totalRows,
    createdRows: createdCount,
    updatedRows: 0,
    skippedRows: skippedCount,
    failedRows: failedCount,
    rowResults
  };
}
