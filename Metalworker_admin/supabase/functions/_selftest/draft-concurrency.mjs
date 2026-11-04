// supabase/functions/_selftest/draft-concurrency.mjs
//
// CONCURRENCY, AGAINST A REAL DATABASE.
//
// The SQL self-check inside migration 0027 calls the functions one after another. That
// proves the decision logic, but it cannot prove that the row lock serialises two
// requests that arrive together: sequential calls never contend.
//
// This harness sends requests through PostgREST. Each HTTP request is its own database
// transaction on its own pooled connection, so `Promise.all` here is genuine contention:
// one request blocks on `SELECT ... FOR UPDATE` while the other holds the row.
//
// It writes real rows. It therefore refuses to run unless a database is explicitly
// named, and it cleans up every row it created in a `finally`. Point it at a test or
// staging project, never production:
//
//   SUPABASE_URL=https://<project>.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
//   node supabase/functions/_selftest/draft-concurrency.mjs
//
// Without those variables it prints SKIPPED and exits 0, because "could not run here"
// must not be reported as "passed".

const url = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const allowProduction = process.env.DRAFT_CONCURRENCY_ALLOW_PRODUCTION === "1";

if (!url || !key) {
  console.log(
    "DRAFT CONCURRENCY CHECKS: SKIPPED (set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to run)."
  );
  process.exit(0);
}

let passed = 0;
const failures = [];
function check(condition, label, detail) {
  if (condition) {
    passed += 1;
    console.log(`  ok    ${label}`);
    return;
  }
  failures.push(label);
  console.log(`  FAIL  ${label}${detail === undefined ? "" : `  (${JSON.stringify(detail)})`}`);
}

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
};

async function rest(path, init = {}) {
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) },
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: response.status, ok: response.ok, body };
}

async function rpc(fn, args) {
  const response = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers,
    body: JSON.stringify(args),
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: response.status, ok: response.ok, body };
}

async function readBill(id) {
  const { body } = await rest(`bills?id=eq.${id}&select=*`);
  return Array.isArray(body) ? body[0] ?? null : null;
}

async function readLines(id) {
  const { body } = await rest(`bill_line_items?bill_id=eq.${id}&select=description&order=sr_no`);
  return Array.isArray(body) ? body.map((row) => row.description) : [];
}

async function setClaimedAt(id, iso) {
  await rest(`bills?id=eq.${id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ generation_claimed_at: iso }),
  });
}

const run = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const createdBills = [];
let uploadId = null;

try {
  const admin = await rest(`profiles?role=eq.admin&is_active=eq.true&select=id&limit=1`);
  const adminId = Array.isArray(admin.body) ? admin.body[0]?.id : null;
  if (!adminId) {
    console.log("DRAFT CONCURRENCY CHECKS: SKIPPED (no active admin row).");
    process.exit(0);
  }
  if (!allowProduction) {
    console.log(
      "DRAFT CONCURRENCY CHECKS: this harness WRITES rows. Re-run with " +
        "DRAFT_CONCURRENCY_ALLOW_PRODUCTION=1 only against a test/staging database."
    );
    process.exit(0);
  }

  const upload = await rest("bill_uploads", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      original_filename: `concurrency-${run}`,
      base_name: `concurrency-${run}`,
      status: "completed",
      invoice_count: 0,
      created_by: adminId,
      creation_source: "manual",
    }),
  });
  uploadId = Array.isArray(upload.body) ? upload.body[0]?.id : null;
  if (!uploadId) throw new Error(`could not create the upload row: ${JSON.stringify(upload)}`);

  async function newDraft(label) {
    const made = await rest("bills", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        bill_upload_id: uploadId,
        sheet_name: `${label}-${run}`,
        invoice_no: `${label}-${run}`,
        invoice_date: "2026-04-01",
        status: "draft",
        origin: "manual",
        created_by: adminId,
        creator_draft_key: `${label}-${run}`,
        document_type: "tax_invoice",
        party_name: "Before",
      }),
    });
    const id = Array.isArray(made.body) ? made.body[0]?.id : null;
    if (!id) throw new Error(`could not create draft ${label}: ${JSON.stringify(made)}`);
    createdBills.push(id);
    await rest("bill_line_items", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify([
        { bill_id: id, sr_no: 1, description: "Original line", quantity: 1, rate: 100, amount: 100 },
      ]),
    });
    return id;
  }

  const patch = { party_name: "Concurrent save" };
  const lines = [{ sr_no: 1, description: "Concurrent line", quantity: 2, rate: 50, amount: 100 }];

  /* 1-3. Save and Generate arrive together. Whichever takes the row lock first must
     decide the outcome; the loser must not half-apply anything. */
  {
    const id = await newDraft("RACE");
    const [save, claim] = await Promise.all([
      rpc("save_creator_draft", {
        p_bill_id: id,
        p_user_id: adminId,
        p_document_type: "tax_invoice",
        p_patch: patch,
        p_line_items: lines,
        p_claim_token: null,
      }),
      rpc("claim_bill_generation", {
        p_bill_id: id,
        p_user_id: adminId,
        p_document_type: "tax_invoice",
      }),
    ]);

    const claimOk = claim.body?.ok === true;
    const saveOk = save.body?.ok === true;
    check(claimOk, "one of the two requests wins the claim", claim.body);
    check(
      saveOk || save.body?.reason === "generation_in_progress",
      "a concurrent save either applied or was refused for generation",
      save.body
    );

    const row = await readBill(id);
    const storedLines = await readLines(id);
    check(row?.generation_claim_token === claim.body?.claim_token, "the claim token is stored");
    if (saveOk) {
      check(row?.party_name === "Concurrent save", "a save that won the lock persisted its values");
      check(storedLines.includes("Concurrent line"), "and replaced the line items");
    } else {
      check(row?.party_name === "Before", "a refused save changed no values");
      check(
        storedLines.length === 1 && storedLines[0] === "Original line",
        "a refused save changed no line items"
      );
    }

    /* 5. A normal save arriving while the claim is held is refused outright. */
    const during = await rpc("save_creator_draft", {
      p_bill_id: id,
      p_user_id: adminId,
      p_document_type: "tax_invoice",
      p_patch: { party_name: "During generation" },
      p_line_items: [{ sr_no: 1, description: "During line" }],
      p_claim_token: null,
    });
    check(during.body?.reason === "generation_in_progress", "a save during generation is refused");
    check((await readBill(id))?.party_name !== "During generation", "and writes nothing");

    await rpc("release_bill_generation", {
      p_bill_id: id,
      p_claim_token: claim.body?.claim_token,
    });
  }

  /* 4. Two Generate requests for the same draft: exactly one may claim it. */
  {
    const id = await newDraft("DOUBLE-CLAIM");
    const [a, b] = await Promise.all([
      rpc("claim_bill_generation", { p_bill_id: id, p_user_id: adminId, p_document_type: "tax_invoice" }),
      rpc("claim_bill_generation", { p_bill_id: id, p_user_id: adminId, p_document_type: "tax_invoice" }),
    ]);
    const wins = [a, b].filter((result) => result.body?.ok === true).length;
    const refusals = [a, b].filter((result) => result.body?.reason === "generation_in_progress").length;
    check(wins === 1, "exactly one of two simultaneous generations claims the draft", { a: a.body, b: b.body });
    check(refusals === 1, "the other is refused while the claim is valid");

    const winner = a.body?.ok === true ? a.body.claim_token : b.body?.claim_token;
    await rpc("release_bill_generation", { p_bill_id: id, p_claim_token: winner });
  }

  /* 6-8. Lease expiry, takeover, and a stale generation trying to finalize or release. */
  {
    const id = await newDraft("TAKEOVER");
    const first = await rpc("claim_bill_generation", {
      p_bill_id: id,
      p_user_id: adminId,
      p_document_type: "tax_invoice",
    });
    const staleToken = first.body?.claim_token;
    check(typeof staleToken === "string", "the first generation holds a token");

    await setClaimedAt(id, new Date(Date.now() - 31 * 60 * 1000).toISOString());

    const second = await rpc("claim_bill_generation", {
      p_bill_id: id,
      p_user_id: adminId,
      p_document_type: "tax_invoice",
    });
    const freshToken = second.body?.claim_token;
    check(second.body?.ok === true, "a second generation takes over an expired claim", second.body);
    check(freshToken !== staleToken, "takeover replaces the token");

    const lateFinalize = await rpc("finalize_bill_generation", {
      p_bill_id: id,
      p_claim_token: staleToken,
      p_original_path: `manual/${id}_OLD_v1_original.pdf`,
      p_duplicate_path: `manual/${id}_OLD_v1_duplicate.pdf`,
      p_triplicate_path: `manual/${id}_OLD_v1_triplicate.pdf`,
      p_logo_id: null,
      p_profile_snapshot: null,
    });
    check(lateFinalize.body?.reason === "claim_lost", "the old generation cannot finalize", lateFinalize.body);
    const afterLate = await readBill(id);
    check(afterLate?.status === "draft" && afterLate?.original_pdf_path === null,
      "the refused finalize wrote no paths and no status");

    const lateRelease = await rpc("release_bill_generation", {
      p_bill_id: id,
      p_claim_token: staleToken,
    });
    check(lateRelease.body === false, "the old generation cannot release the new claim");
    check((await readBill(id))?.generation_claim_token === freshToken,
      "the new claim survives the old release");

    const okFinalize = await rpc("finalize_bill_generation", {
      p_bill_id: id,
      p_claim_token: freshToken,
      p_original_path: `manual/${id}_NEW_v1_original.pdf`,
      p_duplicate_path: `manual/${id}_NEW_v1_duplicate.pdf`,
      p_triplicate_path: `manual/${id}_NEW_v1_triplicate.pdf`,
      p_logo_id: null,
      p_profile_snapshot: null,
    });
    check(okFinalize.body?.ok === true, "the current holder finalizes", okFinalize.body);
    const finalized = await readBill(id);
    check(finalized?.status === "finalized" && finalized?.original_pdf_path?.includes("_NEW_v1_"),
      "the final row has the current generation's documents");
    check(finalized?.generation_claim_token === null, "and the claim is cleared");

    /* 7. A late save after finalization cannot replace the lines. */
    const lateSave = await rpc("save_creator_draft", {
      p_bill_id: id,
      p_user_id: adminId,
      p_document_type: "tax_invoice",
      p_patch: { party_name: "Late save" },
      p_line_items: [{ sr_no: 1, description: "Late line" }],
      p_claim_token: null,
    });
    check(lateSave.body?.reason === "already_finalized", "a save after finalization is refused");
    const linesAfter = await readLines(id);
    check(!linesAfter.includes("Late line"), "and the finalized line items are untouched");

    /* 8. A failed generation releases only its own claim. */
    const otherId = await newDraft("RELEASE");
    const held = await rpc("claim_bill_generation", {
      p_bill_id: otherId,
      p_user_id: adminId,
      p_document_type: "tax_invoice",
    });
    const releasedByOther = await rpc("release_bill_generation", {
      p_bill_id: otherId,
      p_claim_token: "00000000-0000-4000-8000-000000000000",
    });
    check(releasedByOther.body === false, "a failed generation cannot release a claim it does not hold");
    check((await readBill(otherId))?.generation_claim_token === held.body?.claim_token,
      "and the holder's claim remains");
    const released = await rpc("release_bill_generation", {
      p_bill_id: otherId,
      p_claim_token: held.body?.claim_token,
    });
    check(released.body === true, "the holder releases its own claim");
  }
} catch (error) {
  failures.push(`harness error: ${error instanceof Error ? error.message : String(error)}`);
  console.error(error);
} finally {
  for (const id of createdBills) {
    await rest(`bill_line_items?bill_id=eq.${id}`, { method: "DELETE" }).catch(() => {});
    await rest(`bills?id=eq.${id}`, { method: "DELETE" }).catch(() => {});
  }
  if (uploadId) {
    await rest(`bill_uploads?id=eq.${uploadId}`, { method: "DELETE" }).catch(() => {});
  }
}

console.log(
  `\nDRAFT CONCURRENCY CHECKS: ${failures.length === 0 ? `all ${passed} passed.` : `${failures.length} failure(s).`}`
);
if (failures.length > 0) process.exitCode = 1;
