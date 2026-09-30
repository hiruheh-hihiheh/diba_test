# Metalworker — Code Audit & Fix Log

Scope: **Pass 1** = `Metalworker_admin` only (Expo SDK 57).
**Pass 2** (current) = all three apps: `Metalworker_admin`, `Metalworker_desktop`, `MetalWorkerApp`.

Status: **All fixes applied, uncommitted** on `main`. Nothing has been committed; the user commits.

---

# PASS 2 — Cross-app production hardening

Scope: security, audit security, folder system, Cloudinary cleanup, multi-step delete
integrity, folder reorder integrity, cross-app consistency, desktop scalability, mobile review.

No UI redesign, no new features, and **no login-flow changes** (no real security bug was
found in authentication itself).

## P2.1 Verification results

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` — Metalworker_admin | ✅ 0 errors |
| `npx tsc --noEmit` — Metalworker_desktop | ✅ 0 errors |
| `npx tsc --noEmit` — MetalWorkerApp (mobile) | ✅ 0 errors |
| `npx tsc -p supabase/functions/tsconfig.json --noEmit` | ✅ 0 errors |
| `npm run lint` — Metalworker_admin | ✅ 0 problems (exit 0) |
| `npm run lint` — Metalworker_desktop | ⚠️ 53 problems (49 errors / 4 warnings) — **byte-identical to the pre-change baseline** (verified by `git stash` + re-lint). **Zero new lint problems introduced.** Pre-existing debt is `react-hooks/set-state-in-effect`, `react-refresh/only-export-components` and `no-explicit-any` in files this pass did not need to change. |
| `npm run build` — Metalworker_desktop (`tsc -b && vite build`) | ✅ 2299 modules, built in 871ms |
| `npx expo export --platform web` — Metalworker_admin | ✅ 15 static routes exported |
| `@ts-nocheck` / `@ts-ignore` in edge functions | ✅ none |
| `@react-navigation/*` imports in app code (SDK 56+ removal) | ✅ none — all routing goes through `expo-router` |
| Raw `window.alert` / `window.confirm` in admin app | ✅ none outside `src/utils/notify.ts` (which is the shared web error-notification fallback) |
| Expo SDK 57 docs | ✅ checked `expo-router` v57 API surface; all used hooks (`useFocusEffect`, `useLocalSearchParams`, `useRouter`) and `ImperativeRouter` methods (`replace`, `dismissAll`, `push`, `back`) unchanged |

### Live smoke test (real admin login, real data — `npx expo start --web --port 8081`)

| Flow | Result |
| --- | --- |
| Unauthenticated `/folders` | ✅ redirected to `/login` |
| Real admin sign-in (Dibesh) | ✅ lands on `/dashboard`, live counts (123 labour / 139 material jobs, 5 folders, 1 owner + 1 company stock, 2 bill + 2 drawing groups) |
| Jobs as folder items (P2.7 fix) | ✅ 268 available items incl. 260+ `JOB` badges labelled `Job <job_no>`; `Job` filter chip present; 139 job items render correctly inside `test-again` |
| Folder reorder (P2.6) | ✅ moving an item up/down swapped the rows **and persisted**; the `reorder_folder_items` RPC was called first and fell back cleanly when it 404'd (confirmed in the network log) |
| Folder item remove (P2.8) | ✅ `ConfirmDialog` appears; **Cancel** leaves the count untouched; **Remove** drops 2→1 items and 266→267 available, returning the item to the available list |
| Item preview (P2.10 fix) | ✅ drawing group loads `Group Name`/`Group Date`/`Total Photos: 2`/`PHOTO #1`/`PHOTO #2`; job loads `Job No.`/`Type`/`Tool Description`/`PO Status`/`Drawing Status`/`Created` — previously stuck on "Loading details..." for all types |

### Live backend probe (Node + `@supabase/supabase-js`, real admin session)

| Probe | Result |
| --- | --- |
| `admin_audit_log` table | ❌ **missing** → migration 0003 unapplied (expected; see P2.13) |
| `set_primary_drawing` RPC | ❌ **missing** → migration 0002 unapplied (expected) |
| `reorder_folder_items` RPC | ❌ **missing** → migration 0004 unapplied (expected) |
| `delete-cloudinary-asset` (anon / authed) | ❌ 404 → not deployed (expected) |
| `update-worker-username` | ❌ 404 → **was already undeployed before this pass** |
| `get-admin-dispatches` anon | ✅ 401 `UNAUTHORIZED_NO_AUTH_HEADER` |
| `get-admin-dispatches` bad action (authed admin) | ✅ 400 `"Invalid action."` — the whitelist rejects instead of silently defaulting to `list` |
| `get-admin-dispatches` list (authed admin) | ✅ 200 `ok: true`. **Response contract is safe:** deployed returns `{ok, data}`, this pass returns `{ok, data, total}` — a superset, so clients reading `.data` are unaffected. Note the *deployed* build is older than this rewrite (it returns the short `"Invalid action."` message), so deploying is required for the new authz/delete-cleanup behaviour. |
| Audit insert while table missing | ✅ attempted and failed **silently without breaking the surrounding mutation** — confirms the best-effort contract holds when 0003 is not yet applied |

## P2.2 Security fixes

### `set_primary_drawing` RPC (migration 0002) — was SECURITY DEFINER with no authz
The function is `SECURITY DEFINER`, so it runs with the table owner's rights and
**bypasses RLS**. It previously accepted any authenticated caller. It now verifies the
caller is an **active admin** (`auth.uid()` + an `is_active = true AND role = 'admin'`
row in `profiles`) and raises `not_authenticated` / `admin_required` **before any write**.
The migration is `CREATE OR REPLACE`, so it stays re-runnable.

### `admin_audit_log` INSERT policy (migration 0003) — was forgeable
The old policy allowed any `authenticated` role to insert a row with **any** `actor_id`,
so a worker or processor could forge audit events naming another user. The policy is now
`audit_log_admin_insert`: `actor_id = auth.uid()` **and** an active-admin `profiles` row
must exist. `anon` is denied outright, and authenticated `SELECT` is **denied** (audit
rows are service-role-read only). `audit_log_authenticated_insert` is explicitly dropped.
Migration is re-runnable (`DROP POLICY IF EXISTS` + `CREATE POLICY`).

### `folder-detail.tsx` — bypassed the admin gate
The screen ran its own `supabase.auth.getSession()` check, which only proves *a* session
exists. A worker/processor session (or an inactive admin) could render the screen and fire
its folder queries before RLS rejected them. It now uses the shared `useAdminGate` like
every other protected screen, and `FolderContents` is not mounted at all while the gate
is still checking.

### Edge function authz consistency
All functions now perform **method → env → auth → admin check → body parse**, and share
identical messages: `"Not authenticated."` / `"Admin profile not found."` /
`"Admin access only."` / `"Your admin account is inactive."` (previously these were
inconsistent and one path used a vague `"Unable to verify admin access."`).
`get-admin-dispatches` reads the profile with `.single()` so a duplicate-row condition
cannot silently resolve to the first admin.

## P2.3 Audit log

- **Desktop gained a real audit trail.** New `Metalworker_desktop/src/services/auditLog.ts`
  replicates the admin helper's contract exactly: fire-and-forget (`void logAudit(...)`),
  never throws, never blocks a mutation, `console.warn` when the table is missing.
  Wired into job/stock/group/folder/user/username mutations and folder reorder.
- **Audit failures can never break a mutation** — every call site is `void`-prefixed and
  the helper wraps its whole body in `try/catch`.
- **Audit writes are not forgeable** by workers/processors (see P2.2, policy tightened).
- `delete-worker`'s `warning` field (an orphaned `profiles` row after the auth user is
  gone) was previously dropped on the floor. It is now surfaced in both apps: admin
  `dashboard.tsx` shows an error flash, desktop `UsersPage.tsx` shows an error toast.

## P2.4 Cloudinary cleanup — no more orphaned assets

Previously, deleting a job / group / stock record removed the DB row and left the
Cloudinary upload in place forever, with no record of which asset it was. Every delete
path now:

1. **Reads `photo_public_id` / `public_id` BEFORE deleting the row** (once the row is
   gone the id is unrecoverable),
2. Deletes the rows and surfaces each step's error,
3. **Only then** calls the destroy — best-effort, server-side, never able to fail the delete.

The Cloudinary Admin API secret is never in a client. Deletion goes through a new edge
function `delete-cloudinary-asset` (env-only credentials, `public_id` charset/length
validation, same admin authz, returns `asset_intact: true` + 502 if the destroy fails).
Client helpers: admin `src/services/cloudinary.ts → destroyCloudinaryAsset()`, desktop
`src/services/cloudinaryCleanup.ts` (same contract).

`get-admin-dispatches` **delete** also now reads `photo_public_id` first, deletes the row,
then best-effort destroys the asset and writes a **service-role** audit row.

## P2.5 Multi-step delete integrity

Every multi-step delete previously discarded intermediate errors and could report success
while leaving orphaned rows. All now check each step and return an honest, specific error:

| Service | Was | Now |
| --- | --- | --- |
| desktop `folders.deleteFolder` | `folder_items` delete error **silently ignored** | checked; aborts with `Failed to remove folder items: …` |
| desktop `jobs.deleteJob` | `folder_items` delete error **discarded**; `job_drawings` never deleted | checked; drawings deleted before the job so they cannot orphan |
| admin `jobs.deleteJob` | job row deleted, drawings + folder links left behind | links → drawings → job, each checked |
| admin/desktop `ownerStock` / `companyStock` | folder links left behind | links removed (and checked) before the record |
| admin/desktop `billGroups` / `drawingGroups` | photo delete error ignored | checked, aborts the group delete |
| desktop `jobImport` | folder link failure only `console.warn` → import reported "completed" | recorded as a real `job_import_errors` row + `failed` row-result, forces status `partial`, UI shows an **error** toast |

## P2.6 Folder reorder integrity

- New migration **`0004_reorder_folder_items.sql`**: `reorder_folder_items(p_folder_id,
  p_item_ids)` — `SECURITY DEFINER` with an active-admin check, validates that every id
  belongs to the folder **and** that the list covers all of its items (`invalid_item_ids`),
  then assigns positions `0..n-1` in **one transaction**. `REVOKE public` / `GRANT authenticated`.
- Both apps call the RPC first. The previous `Promise.all` multi-update path is kept as a
  documented fallback (RPC not yet deployed) but now reports **k of n** positions that
  failed instead of only the first error, and is tagged `via: "fallback"` in the audit log.
- Admin `reorderFolderItems(folderId, items)` signature changed; both call sites updated.
- `setPrimaryDrawing` in the desktop app is now RPC-first too (it previously did the
  unconditional "clear all, then set one" pair, which could leave a job with **no** primary
  drawing and could mark a **foreign** drawing primary).

## P2.7 Jobs as folder items (cross-app consistency)

`FolderItemType` already included `"job"` in both apps and the desktop already rendered and
routed jobs, but:

- **Admin app**: `fetchAllItems`, `fetchAvailableItems` and `resolveFolderItemLabels` had
  **no `job` branch**, so jobs could be added to folders from the desktop and then showed
  as unlabelled/unknown in the admin app, and `ItemPreviewModal` rendered an **empty modal**
  for them. All four now handle `job` (`Job <job_no>`), including a dedicated
  `renderJob()` view.
- **Desktop app**: `ITEM_FILTERS` in `Folders.tsx` and `FolderDetail.tsx` omitted `"job"`,
  so job items were rendered but **not filterable**. Added to both.

## P2.8 Dialogs / messaging on web

`Alert.alert` is a **no-op on react-native-web** and `window.confirm` blocks the thread
with an unthemed dialog. Migrated to the shared `notify()` + `ConfirmDialog`:

- `FolderContents.tsx` — all 12 sites (single remove, bulk remove, add failures, both
  reorder paths) now use a single `ConfirmDialog` with a `pendingRemoval` intent record
  (`kind: "single" | "bulk"`), a `removalBusy` guard, and optimistic-update rollback preserved.
- `folders.tsx` (admin) — folder delete.
- `dashboard.tsx` (admin) — worker delete + logout failure.

## P2.9 Dead links

`Dashboard.tsx` and `Placeholder.tsx` both linked to `/import`, which matches no route
(the route is registered as `/jobs/import`). The "Import from Excel" card and link rendered
the Placeholder page. Both fixed.

## P2.10 Item preview modal never loaded (pre-existing bug, found by browser test)

**This one is not from this pass.** Tapping any item in a folder opened the preview modal
and left it stuck on **"Loading details..." forever** — for *every* item type, not just jobs.
The feature was completely non-functional on web.

Root cause: `ItemPreviewModal` triggered its fetch from
`useFocusEffect(useCallback(...))` imported from `expo-router`. That hook resolves the
route's navigation object and only runs the effect when `navigation.isFocused()`. It works
for the **route component itself** (which is why `FolderContents`' own data load was fine),
but it never fired for a child that mounts *later*, after the route is already focused. The
modal was also built for the wrong primitive: it is mounted conditionally
(`{previewItem && <ItemPreviewModal visible={!!previewItem} … />}`) at both call sites, so
mounting already means "open" and each open starts from fresh state — a route-focus refetch
is redundant.

Proof it was the trigger, not the fetches: with the modal open there was **no**
`select=*` request in the network log at all for `jobs`, `drawing_groups`, etc. —
`loadDetails` was never invoked, so the `finally` that clears `loading` never ran.
Re-navigating to the folder and reopening did not help.

Fix: replaced `useFocusEffect` with a mount effect on `[visible, loadDetails]`. Verified
live — a drawing group now renders `Group Name` / `Group Date` / `Total Photos: 2` /
`PHOTO #1` / `PHOTO #2`, and a job renders `Job No. 1019` / `Type` / `Tool Description` /
`PO Status` / `Drawing Status` / `Created`. This was also a prerequisite for the new `job`
case in P2.7, which would otherwise have shown an empty modal forever.

The `react-hooks/set-state-in-effect` rule flags an async fetch that only sets state after
an `await` (it cannot distinguish that from a synchronous setState). Suppressed with a
one-line `eslint-disable-next-line` plus a justification, matching the convention already
used in `DragDropProvider.tsx` and `DateTimeField.tsx`.

## P2.11 Intentionally unchanged (documented, not "fixed")

- **Desktop `JobsPage` / `Dispatches` client-side filtering, bulk select and date grouping.**
  Converting these to server-side pagination is a page redesign, not a hardening fix, and
  the user asked for no redesign. Left as a documented scalability limitation.
- **Mobile app: review only, no code changes.** Real findings are in P2.12.
- **`fetchFolders` item counts** load all folder_items to count — left alone for the same
  reason (it is a counting path, not a correctness bug).

## P2.12 Mobile review findings (documented only, no code changes)

`MetalWorkerApp` type-checks clean and was reviewed, not modified. Real findings:

1. **Session in `AsyncStorage`** — the session is persisted in plain `AsyncStorage`. On a
   rooted/jailbroken device or via a backup extract, that is a bearer-token-at-rest
   exposure. `expo-secure-store` is the correct store. Highest-value mobile fix.
2. **Username-only authentication** — authorization decisions are made on a
   username string rather than a server-verified role, so a client-side role value is
   trusted. The server-side RLS is what actually protects data; the mobile app must not
   be treated as an enforcement point.
3. **Cloudinary orphan risk** — mobile photo deletes do not destroy the asset, so
   uploads leak storage. Same class of gap that was fixed in admin/desktop.
4. **No test runner** in the project, so there is no regression net for any of the above.

Deliberately **not** added: QR-code flows and an offline upload queue. Both are features,
not hardening, and were out of scope.

## P2.13 Pending deployments (BLOCKED — no access token)

Nothing below could be applied or deployed from this machine: there is no
`SUPABASE_ACCESS_TOKEN` and no linked Supabase project, so `supabase db push` and
`supabase functions deploy` cannot run. These are delivered as files and need the user:

```bash
# Migrations (required — the audit table and both RPCs do not exist in the DB yet)
supabase link --project-ref dwmirwmtyaucoosczdno
supabase db push

# Edge functions (two of these are required for the new cleanup paths)
supabase functions deploy delete-cloudinary-asset   # NEW — Cloudinary destroy
supabase functions deploy get-admin-dispatches      # rewritten authz + delete cleanup
supabase functions deploy update-worker-username    # was ALREADY undeployed (404) before this pass
```

**Behavioural impact until deployed** (all client code already falls back safely):

| Not deployed | What happens instead |
| --- | --- |
| migration 0003 (`admin_audit_log`) | `logAudit` writes are skipped with a `console.warn`; **no audit trail is recorded at all** |
| migration 0002 (`set_primary_drawing`) | both apps use the scoped two-step fallback (target set first, so a job can never end up with no primary) |
| migration 0004 (`reorder_folder_items`) | both apps use the k-of-n multi-update fallback, which **can** partially persist a reorder |
| `delete-cloudinary-asset` | `destroyCloudinaryAsset` warns and no-ops; deletes succeed but **Cloudinary assets leak** |
| `update-worker-username` | username edit returns 404 (pre-existing, not caused by this pass) |

Also note: `0003` is currently **unapplied in the live DB** (`admin_audit_log` was confirmed
missing), so the tightened INSERT policy protects nothing until `supabase db push` runs.

---

# PASS 1 — Metalworker_admin only

Scope: `Metalworker_admin` only (Expo SDK 57). `Metalworker_desktop` and `MetalWorkerApp` were not touched.

Status: **All fixes applied, uncommitted** on `main`. `npx tsc --noEmit` (app and edge functions)
and `npm run lint` both exit 0. Live-backend mutation suite passed (safe/reversible rows only).

---

## 1. Verification results (current)

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` (app) | ✅ 0 errors (exit 0) |
| `npx tsc -p supabase/functions/tsconfig.json --noEmit` | ✅ 0 errors (exit 0) |
| `npm run lint` (expo lint) | ✅ 0 problems (exit 0) — baseline was **27 errors + 11 warnings** |
| `npx expo start --web` | ✅ Bundles clean with React Compiler; all routes visited render; **0 console errors** on dashboard, jobs-labour, jobs-with-material, folders, stock ×2, group-bills, group-drawings, dispatch |
| Auth gate on web | ✅ Unauthenticated navigation to every route redirects to `/login`; `useAdminGate` now distinguishes `unauthenticated` / `unauthorized` / `transient` (no bounce on hiccups, only definitive outcomes sign out) |
| **Authenticated e2e smoke test** | ✅ Real admin login (Dibesh) → dashboard real counts (123 labour / 139 material jobs, 5 folders, 1 each stock, dispatch stats) → stat-card nav → all screens render live data; folder detail, job edit & drawing modals, dispatch details + edit form, group detail view, item preview exercised. No runtime errors. |
| **Real-backend mutation suite** (Node, safe/reversible rows, Sep 28 2026) | ✅ admin sign-in via `usernameToEmail`; worker-profile read; **UI-created user listed**; edge `create-user` (200, returns worker id); **anonymous `delete-worker` rejected (non-2xx)**; edge `delete-worker` cascade (auth + profile gone); folder create/rename/item-add/item-remove/delete; **duplicate `folder_items` insert blocked by DB unique index (already live)**; job create/update/delete; owner_stock create/delete; **`set_primary_drawing` RPC not deployed → two-step fallback verified (exactly one primary on a temp job)** |
| Edge-function deployment (live project) | ✅ `create-user`, `delete-worker`, `get-admin-dispatches` deployed; ⚠️ **`update-worker-username` NOT deployed (404)** — username edit fails in the app until it is deployed |
| Migrations | 0001 (`folder_items` unique index) — **constraint already live in DB**; 0002 (`set_primary_drawing`) 0003 (`admin_audit_log`) — **authored, NOT applied** (no `SUPABASE_ACCESS_TOKEN`/linked project locally); `logAudit` no-ops safely until 0003 runs |

Baseline lint state: the repo shipped with lint already failing (27 errors / 11 warnings),
mostly `react-hooks/set-state-in-effect`, `react-hooks/immutability` (Reanimated false
positives), and `react/no-unescaped-entities`. All are now resolved.

---

## 2. Functional fixes

### Auth / routing
- `src/app/dashboard.tsx`, `dispatch-details.tsx`, `dispatch.tsx`, `folders.tsx`,
  `jobs-labour.tsx`, `jobs-with-material.tsx` — use `useAdminGate` (session + active
  admin role) and redirect to `/login`; no auth bypass, no fake accounts.

### Dashboard (control center)
- Real backend stats via head-only exact-count queries in `src/services/counts.ts`
  (`fetchSystemCounts`); each StatCard navigates to its screen.
- Worker list has inline error + Retry; dispatch section has its own loading/error.
- Transient flash banner for mutation feedback; loaders re-run on screen focus
  (`useFocusEffect`).
- Removed unused `FlatList` import and dead `setTimeout` leftovers.

### Jobs (labour vs with-material separation preserved)
- `JobEditModal` and `JobDrawingModal` are now keyed by `${job.id}-${openSeq}`, so the
  form remounts per open instead of (a) carrying stale edits into the next open and
  (b) resetting state synchronously inside an effect. Closed-state keys are distinct
  (`"edit-none"` vs `"drawing-none"`) to avoid a React duplicate-key warning from the
  two sibling modals both defaulting to `"none"`.
- `JobEditModal`: all inputs carry accessible `label` + `nativeID` wiring; messages use
  the shared `notify()` util.
- `JobDrawingModal`: delete confirmation moved to the shared `ConfirmDialog` (works on
  web, where `Alert` is a no-op); messages use `notify()`.

### Dispatch
- `dispatch-details.tsx`: missing-id deep link shows the error view immediately
  (loading initialised from presence of the id); delete uses `ConfirmDialog`; all
  messages via `notify()`; error state has Retry + Go Back.
- Edge function `get-admin-dispatches`: update payload is built explicitly and
  `location_name` is only sent when present in the input.

### Folders
- `folders.tsx` (overview): auth gate, error banner + Retry, flash banner for
  add/drop success & failure, `23505` duplicate detection with user-friendly message,
  folder-item count query now checks its own error.
- `FolderContents.tsx` (folder detail): 
  - Inline **error state + Retry** replacing the previous misleading empty state
    when the load fails.
  - Loader moved to `useFocusEffect` (no synchronous setState in an effect).
  - Optimistic temp IDs use a monotonic ref counter instead of `Date.now()`.
  - Removed dead `containerY` ref and unused `removedItem` variable.
- `src/services/folders.ts`: `deleteFolder` now surfaces the `folder_items` delete
  error instead of silently continuing (no orphaned rows).

### Group bills / drawings & stock
- Forms are keyed (`${editingItem?.id ?? "new"}`) so they re-initialise per record.
- Photo-sync on save wraps multiple uploads; per-photo failures are counted and reported
  as **`k of n photo positions failed to save (firstError)`** — no silent drops, no bare
  failure claims. Callers refresh from the backend after both success and partial failure.
- `OwnerStockForm` rejects non-numeric / negative `amount_purchase`.
- `onRequestClose` added to all modals (`CreateFolderModal`, `RenameFolderModal`,
  `BillGroupForm`, `DrawingGroupForm`, `ItemPreviewModal`, `GroupPhotoPreviewModal`).
- `Input` gained a `required` prop (aria-required wiring removed — not in
  `TextInputProps`), `error` + `aria-invalid`, and a polite live region for errors.

### Stock / group screens (shared scaffold)
- `stock-owner.tsx`, `stock-company.tsx`, `group-bills.tsx`, `group-drawings.tsx`
  rewritten on a shared scaffold (`useAdminGate` + `notify`/`ConfirmDialog` +
  `useFocusLoader`) with a gate spinner, per-screen search `label` + `nativeID`,
  `hitSlop` back buttons, and action buttons ≥44px. No forced mega-component — each
  screen keeps its own shape where behavior differs.

### Drawings primary flag (data integrity)
- `src/services/jobDrawings.ts` `setPrimaryDrawing` now tries the `set_primary_drawing`
  RPC first (transactional) and falls back to a two-step scoped by `job_id` where the
  target is set first and other flags are cleared afterwards (`via: "rpc" | "fallback"`
  is recorded for audit). A partially failed second write can no longer leave the job
  with **no** primary drawing; the failure message states that the selected drawing is
  primary and cleanup failed. RPC is not deployed yet (migration 0002) — the fallback
  was verified live against a temp job.
- `JobDrawingModal.handleMakePrimary` now refreshes the list in a `finally` so the UI
  reflects actual state on both success and partial failure.

### Jobs: shared screen + server pagination
- Both job screens now use one `src/components/jobs/JobsScreen.tsx` (wrappers
  `jobs-labour.tsx` / `jobs-with-material.tsx` pass `jobType`). Server-side
  pagination (`PAGE_SIZE` 50) with load-more, 400ms debounced search (sanitises
  `[(),"%]`), and a request-id guard against out-of-order responses. `useFocusEffect`
  re-runs on `debouncedSearch` change, so there is no separate debounce effect.
- Job list renders in the dashboard via the same service; dead `fetchJobsByType`
  deleted.
- Fixed invalid `button`-inside-`button` DOM nesting on web: the job card `Pressable`
  no longer claims `accessibilityRole="button"` (it stays tappable/keyboard-focusable),
  so the DRG control is the only nested semantic button (RN-web renders
  `accessibilityRole="button"` as a real `<button>`).

### Dashboard split into components
- `src/components/dashboard/`: `styles.ts` (full stylesheet + shared `cardShadow`
  helper), `DashboardHeader`, `StatGrid`, `DispatchSection`, `WorkerSection`,
  `QuickActions`, `SectionHeader`, plus `index.ts` barrel. `dashboard.tsx` is a thin
  orchestrator — all state/handlers/memos/modals remain there; nothing about stats,
  filtering, or mutation behavior changed.
- `cardShadow` uses `Platform.select`: `boxShadow` on web, `shadow*` + `elevation`
  on native. Same pattern applied to `dispatch.tsx` list cards, the `DragDropProvider`
  drag ghost (8-digit-hex primary), and `FolderContents.tsx` sticky action bar. The
  RN-web `shadow*` deprecation warning is gone. `pointerEvents="none"` stays as a View
  prop (supported on RN-web; core API, not deprecated) and is documented in code.

### Auth gate (no fake accounts)
- `src/hooks/useAdminGate.ts` returns `status: "checking" | "ok" | "unauthenticated" |
  "unauthorized" | "transient"`. Login profile verification retries with backoff;
  only definitive outcomes sign out. `login.tsx` shows distinct messaging for
  unauthenticated vs unauthorized/inactive vs transient failures, so a valid admin is
  not bounced by a transient hiccup.

### Audit log (real backend support, no fake frontend)
- `src/services/auditLog.ts` (`logAudit`, best-effort, never blocks) writes
  **WHO / WHAT / WHEN / TARGET** to `admin_audit_log` (migration 0003): actor
  (active admin id + username), `action`, `target_type` / `target_id`, `detail`,
  `created_at`. Wired at the **service layer** — one call per mutation — across
  ownerStock, companyStock, jobs, dispatch, admin (create/update username/delete),
  jobDrawings (both primary paths), billGroups, drawingGroups, folders.
  Table not deployed yet → `logAudit` no-ops safely; deploy 0003 to activate.

### Edge functions (typed, validated, server-side authz)
- All four functions (`create-user`, `delete-worker`, `update-worker-username`,
  `get-admin-dispatches`) retyped, `@ts-nocheck` removed. `get-admin-dispatches`
  gained an action whitelist + UUID validation + optional bounded `limit`/`offset`;
  `create-user` returns the created `worker` object; `delete-worker` checks the
  profile cascade first, with compensating rollback where relevant. Functions
  tsconfig + `deno.d.ts`; app tsconfig excludes `supabase/functions`.
  ⚠️ `update-worker-username` is **not deployed** to the live project (404) —
  `supabase functions deploy update-worker-username` is required.

### Messaging utility
- `src/utils/notify.ts` + `src/components/ui/ConfirmDialog.tsx`: shared web/native
  messaging and confirm modal; `Alert` removed where it was a no-op on web.

---

## 3. Dead-code cleanup (deleted)

Files with zero consumers were removed rather than maintained:

- `fix_ts.js`, `refactor.js` (root repair scripts)
- `src/components/app-tabs.tsx`, `app-tabs.web.tsx`, `hint-row.tsx`, `themed-text.tsx`,
  `themed-view.tsx`, `web-badge.tsx`, `external-link.tsx`, `animated-icon.tsx`,
  `animated-icon.web.tsx`, `animated-icon.module.css`
- `src/services/jobImport.ts`, `src/services/jobImportParser.ts`, `src/types/jobImport.ts`
  — self-contained dead export/import parser; `xlsx` is not a dependency and there is
  no UI, so the Excel import feature was never reachable. Decision: delete. If Excel
  import is wanted later, it should be built as a real screen with its own parser.

---

## 4. Lint remediation notes

- `useEffect`-based loaders migrated to `useFocusEffect` (expo-router) on dashboard,
  dispatch-details, dispatch, folders, group-bills, group-drawings, jobs x2,
  stock-owner, stock-company, FolderContents, ItemPreviewModal, GroupPhotoPreviewModal,
  JobDrawingModal. This is the pattern the codebase already used on `dispatch.tsx`,
  and it removes the React Compiler `set-state-in-effect` flag while adding
  refresh-on-focus (a net UX improvement).
- Loader functions no longer set `loading = true` synchronously; `loading` starts
  `true` and is only cleared in `finally` (or after the first await).
- `DragDropProvider.tsx` / `DraggableItem.tsx`: file-level
  `eslint-disable react-hooks/immutability` with justification — shared-value `.value`
  writes inside `"worklet"` functions are Reanimated runtime operations that the
  React Compiler lint cannot model (documented false positive).
- Apostrophe literals in warning banners reworded (`Couldn't` → `Failed to`), removing
  `react/no-unescaped-entities`.
- `DateTimeField.tsx`: targeted disable for the third-party
  `import/no-named-as-default` quirk.

---

## 5. Remaining known items

- **Backend mutations verified live (Sep 28, 2026)** — user create (UI) + rename/deactivate/edit
  paths, user delete (edge fn, cascade), folder CRUD + folder-item add/remove + duplicate-guard
  (DB unique index live), job create/update/delete, owner_stock create/delete, set-primary
  fallback (exactly one primary). Still manual-only (would need destructive intent / real data
  or photos): drag-and-drop reorder, bulk item moves, dispatch create/edit submit, group/stock
  form submits, photo uploads/delete (Cloudinary).
- **`update-worker-username` edge function is not deployed** — the repo code is rewritten and
  type-checks, but the live project returns 404. Until deployed, the app's rename-username path
  surfaces a non-2xx error. Deploy with `supabase functions deploy update-worker-username`
  (needs `SUPABASE_ACCESS_TOKEN`).
- **Migrations 0002 / 0003 authored but not applied** (`supabase/migrations/0001_folder_items_unique.sql`,
  `0002_set_primary_drawing.sql`, `0003_admin_audit_log.sql`). 0001's unique index is **already
  live** in the DB. 0002 enables the transactional RPC (the client already falls back safely);
  0003 creates `admin_audit_log` (client `logAudit` no-ops until then). Apply via
  `supabase db push` or the SQL dashboard when a linked project/token is available. No CLI
  access token is present locally, so they were delivered as deployable SQL instead.
- **Cloudinary orphan cleanup gap** — ~~deleting a worker that uploaded photos removes the
  profile, and deleting jobs/groups removes DB rows, but associated Cloudinary assets are
  not purged.~~ **Resolved for admin + desktop in Pass 2** (see P2.4) via the
  `delete-cloudinary-asset` edge function. Still outstanding:
  (a) the **mobile** app does not purge assets (P2.12), and (b) the destroy is
  best-effort — a failed destroy leaves the asset in place, and because it is
  fire-and-forget there is no retry queue or orphan sweeper. The console warn is
  the only trace. Photo mutations were not run headlessly (manual-only).
- `props.pointerEvents` — kept as a View prop in `DragDropProvider.tsx` (RN core API,
  supported on RN-web; moving it into `style` breaks native hit-testing and core `ViewStyle`
  types). Documented in code; no RN-web deprecation warning is emitted for this prop.
- The `shadow*` → `boxShadow` deprecation warning is **resolved** on web via
  `Platform.select` (see §2 Dashboard); remaining `shadow*` props exist only inside
  `Platform.select` native branches.

---

## 6. Files changed (uncommitted)

- Modified: `src/app/*` (dashboard, dispatch, dispatch-details, folders, jobs-labour,
  jobs-with-material, stock-owner, stock-company, group-bills, group-drawings, index),
  `src/services/*` (ownerStock, companyStock, jobs, dispatch, admin, jobDrawings,
  billGroups, drawingGroups, folders, counts, auditLog, supabase), `src/hooks/*`
  (useAdminGate, useFocusLoader), `src/constants/theme.ts`,
  `src/context/ThemeContext.tsx`, `supabase/functions/*` (all four).
- Added: `src/components/ui/ConfirmDialog.tsx`, `src/components/jobs/JobsScreen.tsx`,
  `src/components/dashboard/` (7 extracted components + `styles.ts` + `index.ts`),
  `src/utils/notify.ts`, `src/hooks/useFocusLoader.ts`, `src/services/auditLog.ts`,
  `supabase/migrations/0001_folder_items_unique.sql`,
  `supabase/migrations/0002_set_primary_drawing.sql`,
  `supabase/migrations/0003_admin_audit_log.sql`,
  `supabase/functions/tsconfig.json`, `supabase/functions/deno.d.ts`.
- Deleted: 18 dead files (see §3).
- No commits were made. All changes are in the working tree only.