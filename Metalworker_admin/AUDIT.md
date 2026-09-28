# Metalworker Admin — Code Audit & Fix Log

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
- **Cloudinary orphan cleanup gap** — deleting a worker that uploaded photos removes the profile,
  and deleting jobs/groups removes DB rows, but associated Cloudinary assets are not purged.
  Known limitation; no image-picker photo mutations were run headlessly (manual-only).
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