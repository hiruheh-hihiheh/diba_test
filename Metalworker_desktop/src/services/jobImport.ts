import { supabase } from "../lib/supabase";
import { normalizeHeader } from "./jobImportParser";
import type { ParserResult, ImportResult, ImportRowResult } from "../types/jobImport";

const CHUNK_SIZE = 100;
const INSERT_CHUNK = 50;

export async function processJobImport(
  fileName: string,
  parserResult: ParserResult,
  folderId?: string,
  onProgress?: (stage: string, current: number, total: number) => void
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

  const rows = parserResult.rows;
  const rowResults: ImportRowResult[] = new Array(rows.length);
  let createdCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  let folderLinkError: string | null = null;

  const seenJobKeys = new Set<string>();

  // Collected error logs to be inserted in batches.
  const errorLogs: Array<{
    import_id: string;
    row_number: number;
    field_name: string | null;
    raw_value: string | null;
    error_message: string;
    raw_row: Record<string, unknown>;
  }> = [];

  const logError = (rowNumber: number, field: string | null, value: string | null, msg: string, raw: Record<string, unknown>) => {
    errorLogs.push({
      import_id: importId,
      row_number: rowNumber,
      field_name: field,
      raw_value: value,
      error_message: msg,
      raw_row: raw,
    });
  };

  // ---------- Validation pass ----------
  interface EligibleRow {
    index: number;
    row: (typeof rows)[number];
    jobKey: string;
  }
  const eligible: EligibleRow[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const { normalized, errors, rowNumber, raw } = row;

    if (errors.length > 0) {
      skippedCount++;
      const msg = errors.join(", ");
      logError(rowNumber, null, null, `Parser errors: ${msg}`, raw);
      rowResults[i] = { rowNumber, status: "skipped", message: msg };
      continue;
    }

    if (!normalized.job_no) {
      skippedCount++;
      const msg = "Missing Job No";
      logError(rowNumber, "job_no", null, msg, raw);
      rowResults[i] = { rowNumber, status: "skipped", message: msg };
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
      logError(rowNumber, "job_type", rawTypeValue, msg, raw);
      rowResults[i] = { rowNumber, status: "skipped", message: msg };
      continue;
    }

    if (folderId && targetFolderType && targetFolderType !== "general" && normalized.job_type !== targetFolderType) {
      skippedCount++;
      const msg = `Cannot import ${normalized.job_type} job into a ${targetFolderType} folder.`;
      logError(rowNumber, null, null, msg, raw);
      rowResults[i] = { rowNumber, status: "skipped", message: msg };
      continue;
    }

    const jobKey = `${normalized.job_no}-${normalized.job_type}`;

    if (seenJobKeys.has(jobKey)) {
      skippedCount++;
      const msg = "Duplicate job within current import.";
      logError(rowNumber, null, null, msg, raw);
      rowResults[i] = { rowNumber, status: "skipped", message: msg };
      continue;
    }

    seenJobKeys.add(jobKey);
    eligible.push({ index: i, row, jobKey });
  }

  // ---------- Batched existing-job lookup ----------
  onProgress?.("Checking existing jobs", 0, eligible.length);

  const existingMap = new Map<string, string>(); // jobKey -> id
  const jobNos = [...new Set(eligible.map((e) => e.row.normalized.job_no as string))];

  for (let c = 0; c < jobNos.length; c += CHUNK_SIZE) {
    const chunk = jobNos.slice(c, c + CHUNK_SIZE);
    const { data, error } = await supabase
      .from("jobs")
      .select("id, job_no, job_type")
      .in("job_no", chunk);

    if (error) {
      // Mark all eligible rows as failed.
      for (const e of eligible) {
        failedCount++;
        const msg = `Database error checking existing job: ${error.message}`;
        logError(e.row.rowNumber, null, null, msg, e.row.raw);
        rowResults[e.index] = { rowNumber: e.row.rowNumber, status: "failed", message: msg };
      }
      eligible.length = 0;
      break;
    }

    for (const j of data ?? []) {
      existingMap.set(`${j.job_no}-${j.job_type}`, j.id);
    }
    onProgress?.("Checking existing jobs", Math.min(c + CHUNK_SIZE, jobNos.length), jobNos.length);
  }

  // ---------- Separate existing vs new ----------
  const newEligible: EligibleRow[] = [];
  for (const e of eligible) {
    const existingId = existingMap.get(e.jobKey);
    if (existingId) {
      skippedCount++;
      const msg = "Job already exists in jobs table.";
      logError(e.row.rowNumber, null, null, msg, e.row.raw);
      rowResults[e.index] = { rowNumber: e.row.rowNumber, status: "skipped", message: msg, jobId: existingId };
    } else {
      newEligible.push(e);
    }
  }

  // ---------- Batched inserts ----------
  onProgress?.("Inserting jobs", 0, newEligible.length);

  const insertedIdByIndex = new Map<number, string>();

  for (let c = 0; c < newEligible.length; c += INSERT_CHUNK) {
    const chunk = newEligible.slice(c, c + INSERT_CHUNK);
    const payloads = chunk.map((e) => {
      const n = e.row.normalized;
      const payload: Record<string, unknown> = {
        job_no: n.job_no,
        job_type: n.job_type,
        job_given_date: n.job_given_date,
        po_status: n.po_status,
        tool_description: n.tool_description,
        tool_part: n.tool_part,
        quantity: n.quantity,
        expected_completion_date: n.expected_completion_date,
        expected_completion_note: n.expected_completion_note,
        current_machining_status: n.current_machining_status,
        status: n.status,
        drawing_status: n.drawing_status,
        drawing_status_note: n.drawing_status_note,
        model_status: n.model_status,
      };
      Object.keys(payload).forEach((k) => {
        if (payload[k] === "") payload[k] = null;
      });
      return payload;
    });

    const { data: inserted, error: insertError } = await supabase
      .from("jobs")
      .insert(payloads)
      .select("id");

    if (insertError) {
      // Fallback to per-row inserts for this chunk.
      for (let i = 0; i < chunk.length; i++) {
        const e = chunk[i];
        const n = e.row.normalized;
        const payload: Record<string, unknown> = {
          job_no: n.job_no,
          job_type: n.job_type,
          job_given_date: n.job_given_date,
          po_status: n.po_status,
          tool_description: n.tool_description,
          tool_part: n.tool_part,
          quantity: n.quantity,
          expected_completion_date: n.expected_completion_date,
          expected_completion_note: n.expected_completion_note,
          current_machining_status: n.current_machining_status,
          status: n.status,
          drawing_status: n.drawing_status,
          drawing_status_note: n.drawing_status_note,
          model_status: n.model_status,
        };
        Object.keys(payload).forEach((k) => {
          if (payload[k] === "") payload[k] = null;
        });

        const { data: single, error: singleError } = await supabase
          .from("jobs")
          .insert(payload)
          .select("id")
          .single();

        if (singleError) {
          if (singleError.code === "23505") {
            skippedCount++;
            const { data: dup } = await supabase
              .from("jobs")
              .select("id")
              .eq("job_no", payload.job_no)
              .eq("job_type", payload.job_type)
              .maybeSingle();
            const msg = "Job already exists in jobs table.";
            logError(e.row.rowNumber, null, null, msg, e.row.raw);
            rowResults[e.index] = { rowNumber: e.row.rowNumber, status: "skipped", message: msg, jobId: dup?.id };
          } else {
            failedCount++;
            const msg = `Insert failed: ${singleError.message}`;
            logError(e.row.rowNumber, null, null, msg, e.row.raw);
            rowResults[e.index] = { rowNumber: e.row.rowNumber, status: "failed", message: msg };
          }
        } else {
          createdCount++;
          insertedIdByIndex.set(e.index, single.id);
          rowResults[e.index] = { rowNumber: e.row.rowNumber, status: "created", jobId: single.id };
        }
      }
    } else {
      (inserted ?? []).forEach((job, idx) => {
        const e = chunk[idx];
        createdCount++;
        insertedIdByIndex.set(e.index, job.id);
        rowResults[e.index] = { rowNumber: e.row.rowNumber, status: "created", jobId: job.id };
      });
      // If fewer returned than sent, mark rest failed.
      if ((inserted ?? []).length < chunk.length) {
        for (let i = (inserted ?? []).length; i < chunk.length; i++) {
          const e = chunk[i];
          failedCount++;
          const msg = "Insert failed: no id returned";
          logError(e.row.rowNumber, null, null, msg, e.row.raw);
          rowResults[e.index] = { rowNumber: e.row.rowNumber, status: "failed", message: msg };
        }
      }
    }

    onProgress?.("Inserting jobs", Math.min(c + INSERT_CHUNK, newEligible.length), newEligible.length);
  }

  // ---------- Batched error log insert ----------
  if (errorLogs.length > 0) {
    for (let c = 0; c < errorLogs.length; c += INSERT_CHUNK) {
      await supabase.from("job_import_errors").insert(errorLogs.slice(c, c + INSERT_CHUNK));
    }
  }

  // ---------- Continuation rows: attach components to parent jobs ----------
  const jobIdByKey = new Map<string, string>();
  for (let i = 0; i < rows.length; i++) {
    const r = rowResults[i];
    const row = rows[i];
    if (r?.jobId && row.rowKind === "job" && row.normalized.job_no && row.normalized.job_type) {
      jobIdByKey.set(`${row.normalized.job_no}-${row.normalized.job_type}`, r.jobId);
    }
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.rowKind !== "continuation") continue;
    const parentKey = row.parentJobKey;
    const parentJobId = parentKey ? jobIdByKey.get(parentKey) : undefined;
    const component = (row.normalized.tool_part || row.normalized.tool_description || "").trim();

    if (!parentJobId) {
      // Try to find parent in DB.
      if (row.normalized.job_no && row.normalized.job_type) {
        const { data: parent } = await supabase
          .from("jobs")
          .select("id")
          .eq("job_no", row.normalized.job_no)
          .eq("job_type", row.normalized.job_type)
          .maybeSingle();
        if (parent?.id) {
          jobIdByKey.set(parentKey as string, parent.id);
        }
      }
    }

    const resolvedParentId = parentKey ? jobIdByKey.get(parentKey) : undefined;

    if (!resolvedParentId) {
      skippedCount++;
      const msg = `Continuation row could not be matched to parent job ${row.normalized.job_no ?? ""}.`;
      logError(row.rowNumber, null, null, msg, row.raw);
      rowResults[i] = { rowNumber: row.rowNumber, status: "skipped", message: msg };
      continue;
    }

    if (component) {
      const { data: job } = await supabase
        .from("jobs")
        .select("tool_part")
        .eq("id", resolvedParentId)
        .single();
      const current = (job?.tool_part ?? "").trim();
      if (!current.includes(component)) {
        const next = current ? `${current}\n${component}` : component;
        await supabase.from("jobs").update({ tool_part: next }).eq("id", resolvedParentId);
      }
    }

    skippedCount++;
    rowResults[i] = {
      rowNumber: row.rowNumber,
      status: "skipped",
      message: `Continuation attached to job ${row.normalized.job_no}`,
      jobId: resolvedParentId,
    };
  }

  // ---------- Folder linking ----------
  if (folderId) {
    const jobIdsToAdd = rowResults
      .map((r) => r?.jobId)
      .filter((id): id is string => typeof id === "string" && id.length > 0);

    // De-duplicate
    const uniqueIds = [...new Set(jobIdsToAdd)];

    if (uniqueIds.length > 0) {
      // Validate folder type compatibility per job? Already filtered by job type,
      // but verify folder type supports all. If typed folder, all job ids should
      // be compatible; if not, skip incompatible (should not happen).
      // Fetch job types for all ids in chunks.
      const jobTypeMap = new Map<string, string>();
      for (let c = 0; c < uniqueIds.length; c += CHUNK_SIZE) {
        const chunk = uniqueIds.slice(c, c + CHUNK_SIZE);
        const { data, error } = await supabase.from("jobs").select("id, job_type").in("id", chunk);
        if (error) {
          folderLinkError = `Could not verify job types for folder linking: ${error.message}`;
          break;
        }
        for (const j of data ?? []) jobTypeMap.set(j.id, j.job_type);
      }

      if (!folderLinkError) {
        // Filter compatible ids based on folder type.
        const compatibleIds = uniqueIds.filter((id) => {
          const jt = jobTypeMap.get(id);
          if (!jt) return false;
          if (!targetFolderType || targetFolderType === "general") return true;
          return jt === targetFolderType;
        });

        // Fetch existing folder items in chunks.
        const existingSet = new Set<string>();
        for (let c = 0; c < compatibleIds.length; c += CHUNK_SIZE) {
          const chunk = compatibleIds.slice(c, c + CHUNK_SIZE);
          const { data, error } = await supabase
            .from("folder_items")
            .select("item_id")
            .eq("folder_id", folderId)
            .eq("item_type", "job")
            .in("item_id", chunk);
          if (error) {
            folderLinkError = `Could not check existing folder items: ${error.message}`;
            break;
          }
          for (const r of data ?? []) existingSet.add(r.item_id);
        }

        if (!folderLinkError) {
          const newIds = compatibleIds.filter((id) => !existingSet.has(id));

          // Get starting position.
          const { data: posData } = await supabase
            .from("folder_items")
            .select("position")
            .eq("folder_id", folderId)
            .order("position", { ascending: false })
            .limit(1);
          let nextPos = posData && posData.length > 0 ? posData[0].position + 1 : 0;

          // Insert in chunks.
          for (let c = 0; c < newIds.length; c += INSERT_CHUNK) {
            const chunk = newIds.slice(c, c + INSERT_CHUNK);
            const insertData = chunk.map((id) => {
              const row = { folder_id: folderId, item_type: "job" as const, item_id: id, position: nextPos };
              nextPos++;
              return row;
            });
            const { error: folderError } = await supabase.from("folder_items").insert(insertData);
            if (folderError) {
              folderLinkError = `Jobs were imported but ${newIds.length} of them could not be added to the folder: ${folderError.message}`;
              // Log
              await supabase.from("job_import_errors").insert({
                import_id: importId,
                row_number: 0,
                field_name: "folder_id",
                raw_value: folderId,
                error_message: folderError.message,
              });
              // push a failed row result
              rowResults.push({ rowNumber: 0, status: "failed", message: folderLinkError });
              break;
            }
            onProgress?.("Linking folder", Math.min(c + INSERT_CHUNK, newIds.length), newIds.length);
          }

          // Verify all compatible ids are now linked.
          if (!folderLinkError) {
            const stillMissing: string[] = [];
            for (let c = 0; c < compatibleIds.length; c += CHUNK_SIZE) {
              const chunk = compatibleIds.slice(c, c + CHUNK_SIZE);
              const { data, error } = await supabase
                .from("folder_items")
                .select("item_id")
                .eq("folder_id", folderId)
                .eq("item_type", "job")
                .in("item_id", chunk);
              if (error) {
                folderLinkError = `Could not verify folder links: ${error.message}`;
                break;
              }
              const present = new Set((data ?? []).map((r: { item_id: string }) => r.item_id));
              for (const id of chunk) if (!present.has(id)) stillMissing.push(id);
            }
            if (!folderLinkError && stillMissing.length > 0) {
              folderLinkError = `Folder verification failed: ${stillMissing.length} job(s) are not linked.`;
            }
          }
        }
      }
    }

    // Link import record to folder (best-effort)
    if (folderId) {
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
  }

  // Ensure all rowResults defined
  for (let i = 0; i < rows.length; i++) {
    if (!rowResults[i]) {
      rowResults[i] = { rowNumber: rows[i].rowNumber, status: "failed", message: "Not processed" };
      failedCount++;
    }
  }

  // Update import record
  let finalStatus: "completed" | "partial" | "failed" = "completed";
  if (createdCount === 0 && (skippedCount > 0 || failedCount > 0) && newEligible.length === 0 && eligible.length === 0) {
    // only if nothing created and there were failures
  }
  if (createdCount === 0 && failedCount > 0 && skippedCount === 0) {
    finalStatus = "failed";
  } else if (skippedCount > 0 || failedCount > 0 || folderLinkError) {
    finalStatus = "partial";
  }
  // If all rows skipped as duplicates, that's still completed-ish but partial? Keep completed if no failures.
  if (failedCount === 0 && !folderLinkError && createdCount === 0 && skippedCount > 0) {
    finalStatus = "completed";
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
    error: folderLinkError,
  };
}
