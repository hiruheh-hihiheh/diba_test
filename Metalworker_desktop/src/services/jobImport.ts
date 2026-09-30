import { supabase } from "../lib/supabase";
import { normalizeHeader } from "./jobImportParser";
import type { ParserResult, ImportResult, ImportRowResult } from "../types/jobImport";

export async function processJobImport(
  fileName: string,
  parserResult: ParserResult,
  folderId?: string
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

  let targetFolderType: string | null = null;
  if (folderId) {
    const { data: folderData, error: folderError } = await supabase
      .from("admin_folders")
      .select("folder_type")
      .eq("id", folderId)
      .single();
    if (folderError) {
      throw new Error(`Failed to fetch target folder details: ${folderError.message}`);
    }
    targetFolderType = folderData.folder_type;
  }

  const rowResults: ImportRowResult[] = [];
  let createdCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  /**
   * Set when the rows imported fine but linking them into the target folder
   * failed. Tracked separately so the import is reported as "partial" instead
   * of silently succeeding (row-level counters are per spreadsheet row).
   */
  let folderLinkError: string | null = null;

  // Track duplicates within the current import
  const seenJobKeys = new Set<string>();

  try {
    for (const row of parserResult.rows) {
      const { normalized, errors, rowNumber, raw } = row;

      const logError = async (field: string | null, value: string | null, msg: string): Promise<string | null> => {
        const { error } = await supabase.from("job_import_errors").insert({
          import_id: importId,
          row_number: rowNumber,
          field_name: field,
          raw_value: value,
          error_message: msg,
          raw_row: raw
        });
        return error ? error.message : null;
      };

      // Pre-import skips
      if (errors.length > 0) {
        skippedCount++;
        const logErr = await logError(null, null, `Parser errors: ${errors.join(", ")}`);
        const message = logErr ? `${errors.join(", ")} (Logging failed: ${logErr})` : errors.join(", ");
        rowResults.push({ rowNumber, status: "skipped", message });
        continue;
      }

      if (!normalized.job_no) {
        skippedCount++;
        const logErr = await logError("job_no", null, "Missing Job No");
        const message = logErr ? `Missing Job No (Logging failed: ${logErr})` : "Missing Job No";
        rowResults.push({ rowNumber, status: "skipped", message });
        continue;
      }

      if (normalized.job_type !== "labour" && normalized.job_type !== "with_material") {
        skippedCount++;
        
        let rawTypeValue = "";
        for (const [k, v] of Object.entries(raw)) {
          const normKey = normalizeHeader(k);
          if (normKey === "jobtype" || normKey === "labourlwithmaterialbo") {
            rawTypeValue = String(v);
            break;
          }
        }

        const msg = `Unknown job type value: "${rawTypeValue}"`;
        const logErr = await logError("job_type", rawTypeValue, msg);
        const message = logErr ? `${msg} (Logging failed: ${logErr})` : msg;
        
        rowResults.push({ rowNumber, status: "skipped", message });
        continue;
      }

      // Check folder type compatibility
      if (folderId && targetFolderType && targetFolderType !== "general" && normalized.job_type !== targetFolderType) {
        skippedCount++;
        const msg = `Cannot import ${normalized.job_type} job into a ${targetFolderType} folder.`;
        const logErr = await logError(null, null, msg);
        const message = logErr ? `${msg} (Logging failed: ${logErr})` : msg;
        rowResults.push({ rowNumber, status: "skipped", message });
        continue;
      }

      const jobKey = `${normalized.job_no}-${normalized.job_type}`;
      
      if (seenJobKeys.has(jobKey)) {
        skippedCount++;
        const msg = "Duplicate job within current import.";
        const logErr = await logError(null, null, msg);
        const message = logErr ? `${msg} (Logging failed: ${logErr})` : msg;
        rowResults.push({ rowNumber, status: "skipped", message });
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
        const msg = "Database error checking existing job";
        const logErr = await logError(null, null, `Database error: ${checkError.message}`);
        const message = logErr ? `${msg} (Logging failed: ${logErr})` : msg;
        rowResults.push({ rowNumber, status: "failed", message });
        continue;
      }

      if (existingJob) {
        skippedCount++;
        const msg = "Job already exists in jobs table.";
        const logErr = await logError(null, null, msg);
        const message = logErr ? `${msg} (Logging failed: ${logErr})` : msg;
        rowResults.push({ rowNumber, status: "skipped", message, jobId: existingJob.id });
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
        status: normalized.status, // Do not invent statuses
        drawing_status: normalized.drawing_status,
        drawing_status_note: normalized.drawing_status_note,
        model_status: normalized.model_status,
      };
      
      // Convert empty strings to null
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
        if (insertError.code === "23505") { // PostgreSQL unique constraint violation
          skippedCount++;
          
          // Try to fetch the existing job ID again since it violated unique constraint
          const { data: duplicateJob } = await supabase
            .from("jobs")
            .select("id")
            .eq("job_no", payload.job_no)
            .eq("job_type", payload.job_type)
            .maybeSingle();
            
          const msg = "Job already exists in jobs table.";
          const logErr = await logError(null, null, msg);
          const message = logErr ? `${msg} (Logging failed: ${logErr})` : msg;
          rowResults.push({ rowNumber, status: "skipped", message, jobId: duplicateJob?.id });
        } else {
          failedCount++;
          const msg = `Insert failed: ${insertError.message}`;
          const logErr = await logError(null, null, msg);
          const message = logErr ? `${msg} (Logging failed: ${logErr})` : msg;
          rowResults.push({ rowNumber, status: "failed", message });
        }
      } else {
        createdCount++;
        rowResults.push({ rowNumber, status: "created", jobId: insertedJob.id });
      }
    }
    
    // Add all processed jobs (created or skipped) to the folder if provided
    if (folderId) {
      const jobIdsToAdd = rowResults
        .map(r => r.jobId)
        .filter(Boolean) as string[];
        
      if (jobIdsToAdd.length > 0) {
        // Check for existing items to prevent duplicates
        const { data: existingItems } = await supabase
          .from("folder_items")
          .select("item_id")
          .eq("folder_id", folderId)
          .eq("item_type", "job")
          .in("item_id", jobIdsToAdd);
          
        const existingSet = new Set((existingItems || []).map(e => e.item_id));
        const newJobIdsToAdd = jobIdsToAdd.filter(id => !existingSet.has(id));

        if (newJobIdsToAdd.length > 0) {
          // Find existing max position in the folder
          const { data: existingPos } = await supabase
            .from("folder_items")
            .select("position")
            .eq("folder_id", folderId)
            .order("position", { ascending: false })
            .limit(1);
            
          let nextPos = existingPos && existingPos.length > 0 ? existingPos[0].position + 1 : 0;
          
          const insertData = newJobIdsToAdd.map(id => {
            const data = {
              folder_id: folderId,
              item_type: "job",
              item_id: id,
              position: nextPos
            };
            nextPos++;
            return data;
          });
          
          const { error: folderError } = await supabase.from("folder_items").insert(insertData);
          if (folderError) {
            // The jobs WERE imported, but linking them into the folder failed.
            // Reporting this only to the console let the import finish as
            // "completed" with jobs silently missing from the chosen folder —
            // exactly the partial failure the user cannot see. Record it as a
            // real error row, log it, and force a partial status.
            folderLinkError = `Jobs were imported but ${newJobIdsToAdd.length} of them could not be added to the folder: ${folderError.message}`;
            await supabase.from("job_import_errors").insert({
              import_id: importId,
              row_number: 0,
              field_name: "folder_id",
              raw_value: folderId,
              error_message: folderError.message,
            });
            rowResults.push({
              rowNumber: 0,
              status: "failed",
              message: folderLinkError,
            });
          }
        }
      }
    }

    // Attempt to link import record to folder_id
    if (folderId) {
      // Best-effort metadata link: the table may not have the folder_id column
      // yet. A failure here does not invalidate the imported rows, so it is
      // logged rather than thrown.
      const { error: linkError } = await supabase
        .from("job_imports")
        .update({ folder_id: folderId })
        .eq("id", importRecord.id);

      if (linkError) {
        await supabase.from("job_import_errors").insert({
          import_id: importId,
          row_number: 0,
          field_name: "folder_id",
          raw_value: folderId,
          error_message: `Import-to-folder link not saved: ${linkError.message}`,
        });
      }
    }
    
  } catch (err: any) {
    // Unexpected exception during processing
    const { error: failureUpdateError } = await supabase.from("job_imports").update({ 
      status: "failed",
      created_rows: createdCount,
      skipped_rows: skippedCount,
      failed_rows: failedCount
    }).eq("id", importId);

    if (failureUpdateError) {
      throw new Error(`Unexpected error: ${err.message}. (Additionally, updating import status failed: ${failureUpdateError.message})`);
    }

    throw err; // Re-throw to UI
  }

  // Update import record
  let finalStatus: "completed" | "partial" | "failed" = "completed";
  if (createdCount === 0 && (skippedCount > 0 || failedCount > 0)) {
    finalStatus = "failed";
  } else if (skippedCount > 0 || failedCount > 0 || folderLinkError) {
    // A folder-link failure makes this a partial import even when every
    // spreadsheet row was created.
    finalStatus = "partial";
  }

  const { error: finalUpdateError } = await supabase
    .from("job_imports")
    .update({
      status: finalStatus,
      created_rows: createdCount,
      skipped_rows: skippedCount,
      failed_rows: failedCount
    })
    .eq("id", importId);

  if (finalUpdateError) {
    throw new Error(`Import finalized but updating status failed: ${finalUpdateError.message}`);
  }

  return {
    importId,
    status: finalStatus,
    totalRows: parserResult.summary.totalRows,
    createdRows: createdCount,
    updatedRows: 0,
    skippedRows: skippedCount,
    failedRows: failedCount,
    rowResults,
    // Set when every row imported but the folder linking did not fully save.
    error: folderLinkError,
  };
}
