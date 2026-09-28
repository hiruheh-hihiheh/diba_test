# Metalworker Admin — Code Audit & Fix Log

Scope: `Metalworker_admin` only (Expo SDK 57). `Metalworker_desktop` and `MetalWorkerApp` were not touched.

Status: **All fixes applied, uncommitted** on `main`. `npx tsc --noEmit` and `npm run lint` both exit 0.

---

## 1. Verification results (current)

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | ✅ 0 errors (exit 0) |
| `npm run lint` (expo lint) | ✅ 0 problems (exit 0) — baseline was **27 errors + 11 warnings** |
| `npx expo start --web` | ✅ Bundles clean with React Compiler; all routes visited render |
| Auth gate on web | ✅ Unauthenticated navigation to every route redirects to `/login` |
| **Authenticated e2e smoke test** | ✅ Real admin login (Dibesh) → dashboard shows real counts → stat-card nav → all screens render live data; folder detail, job edit & drawing modals, dispatch details + edit form, group detail view, item preview all exercised. No runtime errors. |

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
- Photo-sync on save wraps multiple uploads; failures are collected and reported as
  "Partial Success" instead of silently dropping files.
- `OwnerStockForm` rejects non-numeric / negative `amount_purchase`.
- `onRequestClose` added to all modals (`CreateFolderModal`, `RenameFolderModal`,
  `BillGroupForm`, `DrawingGroupForm`, `ItemPreviewModal`, `GroupPhotoPreviewModal`).
- `Input` gained a `required` prop (aria-required wiring removed — not in
  `TextInputProps`), `error` + `aria-invalid`, and a polite live region for errors.

### Drawings primary flag (data integrity)
- `src/services/jobDrawings.ts` `setPrimaryDrawing`: reordered so the target is set
  first and other flags are cleared afterwards. A partially failed second write can
  no longer leave the job with **no** primary drawing; the failure message states
  that the selected drawing is primary and cleanup failed.
- `JobDrawingModal.handleMakePrimary` now refreshes the list in a `finally` so the UI
  reflects actual state on both success and partial failure.

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

## 5. Remaining known items (intentionally left)

- **Authenticated end-to-end flow** is now **verified** (Sep 28, 2026): real admin login
  via the web app, dashboard real counts (123 labour / 139 material jobs, 5 folders,
  1 each stock, dispatch stats), stat-card navigation, and live rendering on dispatch,
  dispatch-details (incl. `location_name`), folders, folder-detail (`FolderContents`
  with items + available list), jobs ×2 (with `JobEditModal` remount), group bills
  (detail modal incl. empty-photo state), group drawings, stock ×2, and item preview.
  Not exercised (would mutate real data / require destructive intent): folder create /
  rename / delete, drag-and-drop reorder, bulk item moves, jobs save / drawing set-primary /
  delete, dispatch create/edit **submit**, group/stock form **submit**, photo uploads.
  Follow the manual checklist below for those.
  1. `npx expo start --web`
  2. Log in with an admin account
  3. Folders: create/rename/delete folder, drag items in, bulk remove
  4. Folder detail: drag-to-reorder, add/remove with confirms
  5. Jobs: open edit modal twice on the same job (form must be fresh), set primary
     drawing, delete a drawing via confirm
  6. Group bills/drawings: add/edit with photo sync; stock forms: validation on
     `amount_purchase`
- `"shadow*" style props are deprecated. Use "boxShadow"` — RN-web dev-mode warning,
  pre-existing across several StyleSheets (dashboard, dispatch, FolderContents,
  DragDropProvider). Cosmetic; shadows still render. Not changed to avoid visual
  regressions; batch-convert later if desired.
- `props.pointerEvents is deprecated. Use style.pointerEvents` — RN-web dev-mode
  warning from `DragDropProvider.tsx` (drag ghost overlay). Moving it into `style`
  would break native drag hit-testing (RN core treats `pointerEvents` as a View prop,
  not a style) and fails core `ViewStyle` types. Left as-is deliberately.
- No migrations / SQL files exist in-repo, so the `folder_items` uniqueness is enforced
  client-side (duplicate detection via error heuristics) rather than by a unique index.

---

## 6. Files changed (uncommitted)

- Modified: 34 files across `src/app`, `src/components`, `src/services`,
  `src/constants/theme.ts`, `src/context/ThemeContext.tsx`,
  `supabase/functions/get-admin-dispatches/index.ts`.
- Added: `src/components/ui/ConfirmDialog.tsx`, `src/hooks/useAdminGate.ts`,
  `src/services/counts.ts`, `src/utils/notify.ts` (+ any sub-files under those).
- Deleted: 18 dead files (see §3).
- No commits were made. All changes are staged in the working tree only.