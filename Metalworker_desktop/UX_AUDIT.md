# Metalworker Admin — UX Audit Checklist

Status legend: `[ ]` todo · `[x]` fixed

Scope: `Metalworker_desktop` (the browser admin portal). UX and presentation only —
no Supabase query, table name, business rule or import-pipeline behaviour was
changed. Verified with `npx tsc -b` and `npx vite build` after every group of
changes; there is no test runner, no tests and no CI in this project.

---

## 0. Root-cause infrastructure

- [x] **P0** Modals/overlays break out of the page → `position: fixed` was resolving
      against the page wrapper, not the viewport, because every page root carries
      `animate-fade-in` and `animation-fill-mode: both` keeps `transform: translateY(0)`
      permanently applied. Any ancestor transform makes it the containing block for
      fixed descendants. With 1 000 rows the wrapper is ~50 000px tall, so dialogs
      rendered ~72px from the top of the *document* — far above the user's scroll position.
      Fixed two ways: keyframes now end on `transform: none`, **and** `AdminModal`,
      `Toast`, `BulkActionBar` and `ImageLightbox` all render through
      `createPortal(…, document.body)`. Belt and braces, because the animation can
      come back.
- [x] Same bug affected the `FolderDetail` bulk-action bar (`fixed bottom-8`).
- [x] Dialogs had no Escape handling, no focus management, no body scroll lock.
      → `AdminModal` traps Tab, restores focus on close, locks the body scroll and
      compensates for the scrollbar so the page does not jump sideways.
- [x] Overlay used `100vh` + `overflow-hidden` → tall dialogs clipped on short viewports.
      → `100dvh` + `overflow-y-auto` on the overlay, internal scroll on the panel, so
      short dialogs centre and tall ones scroll from the top.
- [x] Six pages each re-implemented their own `Modal` wrapper → single shared `Modal`
      (`size` sm/md/lg/xl/full, `tone`, `bare`, `hideClose`, `footer`, `initialFocusRef`).
- [x] 35+ `window.alert` / `window.confirm` / bare `alert()` calls → `ConfirmDialog`
      (promise-based `useConfirm()`) + `Toast`. Verified zero remaining call sites.
- [x] `scrollbar-none` utility referenced but never defined.

## 1. Navigation / page flow

- [x] `TopBar` had no titles for `/jobs/labour`, `/jobs/with-material`, `/jobs/import`
      → all three rendered "Admin Panel".
- [x] Breadcrumbs were decorative text, not links.
- [x] Sidebar listed **"Labour" twice** (PEOPLE → `/labour` user management, JOBS →
      `/jobs/labour` job list). Renamed to "Labour Users" / "Processor Users" and
      "Labour Jobs" / "With Material Jobs".
- [x] Sidebar / TopBar overflowed below ~900px. Added mobile drawer + responsive top bar.
- [x] Notification bell did nothing → removed (no data behind it).
- [x] No active-section highlight while scrolled.
- [x] Pages invented their own `h1` in the body while the TopBar showed something else.
      → `PageMetaContext` / `usePageMeta()`: each page publishes its own title,
      breadcrumb trail and record count, so `Admin > Labour Jobs > filtered: 12 of
      1 240` is always accurate and never guessed.
- [x] Dashboard stat cards were inert numbers. Each now deep-links to the list it
      summarises with the filter applied (`/dispatches?status=submitted`).
- [x] `Dispatches` and `UsersPage` read `?status=` / `?q=` / `?filter=` from the URL
      and write changes back, so a filtered view is bookmarkable and shareable.
- [x] `/reports`, `/settings`, `/notifications`, `/audit` landed on a bare
      "under construction" dead end. `Placeholder` now names what each screen is
      *meant* to do and lists the screens that do work.

## 2. Large-data tables

- [x] Job tables had no sticky header. The `sticky-head` class was added, but the
      live pass found it was still inert on four of the six tables — see §14.
- [x] 12 `whitespace-nowrap` columns pushed Edit/Delete off-screen; actions column
      now sticky-right.
- [x] Row actions were `opacity-0 group-hover:opacity-100` → invisible on touch and
      whenever the pointer left the row. Now always visible.
- [x] Row click opened Edit with no affordance, and blocked text selection.
      → Job No is the clickable target, plus an explicit Edit button.
- [x] No pagination → 1 000 rows = 1 000 DOM rows. Added pagination
      (`usePagination` + `Pagination`, 50 rows on jobs, 25 elsewhere), and the page
      number survives search, filter and refresh.
- [x] Header count showed filtered count with no "showing X of Y".
- [x] Select-All lived in a separate bar above the table, `indeterminate` computed
      through a `ref` (wrong after re-render). Moved into the header row as
      `SelectAllCheckbox`, with real indeterminate state.
- [x] Photo thumbnails were fixed-size and unopenable. `ImageLightbox` makes every
      photo in the app (stock, bill groups, drawing groups, dispatches) open
      full-screen, sized to the viewport, with ← / → / Esc.

## 3. Search

- [x] No clear button on any search input → shared `SearchInput`.
- [x] No indication of what is being searched, and no result count.
      → `SearchInput` announces "N of M <scope>" live.
- [x] "No results" never offered a way out → `EmptyState` with a clear action.
- [x] One `search` string drove both the folder list and the job list on the same page.
- [x] Every "no records" state now distinguishes **no records at all** from
      **no records matching your search**, and says how many exist in total.

## 4. Bulk selection

- [x] `loadJobs()` wiped selection on every refresh.
- [x] Selection was lost when switching view/folder.
- [x] Add-Jobs panel: per-row "Add" was hover-only; no clear-selection control;
      count read `All N selected` vs `N selected` inconsistently; select-all had no
      indeterminate state on the main table.
- [x] "Select All" in the panel selected only visible/filtered rows with no explanation.
- [x] Selection is now preserved across search, refresh, paging and panel toggles.
- [x] `FolderDetail` has two independent selections (inside the folder, and available
      to add) each with its own always-visible checkbox, its own `SelectAllCheckbox`
      and its own viewport-anchored `BulkActionBar`.

## 5. Excel import

- [x] Result summary never said **where** the jobs went.
- [x] No "open the folder I just imported into".
- [x] "Start Import" was not disabled while running → double submit possible.
- [x] Full-page blocking spinner with no progress and no row context.
- [x] `h-full` on a page root inside a `p-8` main → broken height chain.
- [x] Row table could grow unbounded with no cap. Now filter tabs + search +
      50-row pagination over the parsed rows.
- [x] After import, job lists were not refreshed/invalidated.
- [x] Destination folder is chosen up front on the page (not buried in a confirm
      dialog), and a typed-folder mismatch — labour folder receiving
      `with_material` rows — is counted and announced *before* anything is written.
      Only eligible rows are handed to the unchanged `processJobImport`.
- [x] Outcome panel is persistent and breaks the result down into
      added / duplicates / skipped / failed, with per-row reasons and an
      "Open folder" link.
- [x] The mapping report had a comma-join bug on the `File:` line.

## 6. Folders

- [x] `window.confirm` for delete; explanation of "jobs are kept" was inconsistent
      between the two folder pages.
- [x] Edit/Delete on folder cards were hover-only.
- [x] "Select Multiple" mode had to be enabled before anything could be selected.
- [x] No search over items *inside* a folder.
- [x] Right panel hard-coded `h-[600px]` → breaks on short viewports.
      Now derived from the actual viewport height.
- [x] Item Preview was a dead end ("open it from the respective page") with no link.
      → `itemRoute` map; every preview row links out to the real record.
- [x] Item Library listed every record from 5 tables with no pagination.
- [x] "Remove from Folder" now says it unlinks rather than deletes.

## 7. Loading / feedback

- [x] Full-page spinner replaced the whole list on every mutation → scroll position
      and selection lost after every edit/delete. Background refreshes now use
      `InlineRefreshBar` and leave the table in place; deletes update locally.
- [x] Row-level inline progress for save/remove/delete (`busy` on `IconButton`,
      row dimmed and `aria-busy`).
- [x] Buttons not disabled during their own async work (double-submit).
- [x] "Success" / "Something went wrong" → specific, counted messages.
- [x] A failed fetch rendered as an empty list, indistinguishable from "no records".
      Every page now has `ErrorState` with a retry, and a `loadError` is kept
      separate from an empty result.
- [x] `Dashboard` treated a `not ok` dispatch fetch as "no dispatches yet" and showed
      a business fact that was actually a server error.

## 8. Forms

- [x] Generic error text → field-level, specific messages, with focus moved to the
      offending field and `aria-invalid` / `aria-describedby` wired up.
- [x] No required indicators; date fields free-text with `YYYY-MM-DD` placeholders.
- [x] Unsaved-changes guard on the long job edit form and on `DispatchDetails`.
- [x] Enter-to-submit wired on every form.
- [x] Stock record photos: a file chosen but not uploaded was silently discarded on
      save. Saving is now blocked until the pending upload finishes or is cleared.
- [x] Image validation reports the actual problem (wrong type / over 10 MB, with the
      filename and size) instead of a generic failure.

## 9. Duplicated pages

- [x] `JobsLabour.tsx` + `JobsWithMaterial.tsx` — 1 558 lines each, 99% identical →
      one parameterised `JobsPage` (`jobType`, `typeLabel`, `countKey`).
- [x] `Labour.tsx` + `Processor.tsx` — 607 / 427 lines, ~95% identical →
      one `UsersPage` (`role`, `noun`, `addLabel`, `accent`, `icon`), preserving the
      `_processor` username-suffix rules and the reserved `admin` name.
- [x] `OwnerStock.tsx` + `CompanyStock.tsx` — two 240-line copies →
      one `StockPage`, driven by a field/column/describe/search config.
- [x] `GroupBills.tsx` + `GroupDrawings.tsx` — two 220-line copies →
      one `PhotoGroupsPage`.
- Duplication was the underlying reason small fixes kept landing on one page only.

## 10. Accessibility

- [x] Icon-only buttons had no `aria-label`; several had no `title` either →
      `IconButton` (tooltip + `aria-label` + `busy` state).
- [x] Dialogs had no `role="dialog"` / `aria-modal` / labelled title.
- [x] No focus ring suppression regression; visible focus kept everywhere.
- [x] Checkbox hit areas enlarged.
- [x] `Login`'s show/hide password button had `tabIndex={-1}` — a keyboard user
      could never reveal the password they had just typed. Focusable, labelled,
      and reports `aria-pressed`.
- [x] Status and material pickers are real `radiogroup`s so arrow keys work.
- [x] Collapsible rows expose `aria-expanded`; filter chips expose `aria-pressed`.

## 11. Responsive

- [x] Sidebar is a persistent rail ≥1024px, an off-canvas drawer below, with a scrim,
      Escape to close and a body scroll lock while open.
- [x] Tables scroll horizontally with a visible thin scrollbar rather than clipping.
- [x] Low-priority table columns hide at `lg` / `xl` and remain in the preview dialog,
      so nothing becomes unreachable.
- [x] `Login` is `min-h-dvh-fallback` with `overflow-y-auto`; previously the Sign In
      button could be pushed off a short window with no way to scroll to it.
- [x] `prefers-reduced-motion` disables the entrance animations.

## 12. Regression safety

- [x] No change to any Supabase query, table, or business rule.
- [x] `jobs` service, `folders` service, import pipeline untouched.
      `processJobImport(fileName, parserResult, folderId)` only reads
      `parserResult.rows` and `parserResult.summary.totalRows`, so filtering rows
      client-side is safe.
- [x] Business invariants preserved: `labour` | `with_material`;
      `submitted → reviewed → approved | rejected`;
      `scrap | ferrous | non_ferrous | other`;
      `username@metalworker.local`; roles `worker` / `processor` / `admin`;
      labour usernames must not end with `_processor`, processor usernames must.
- [x] Type-check + production build clean.

## 13. Known follow-ups (not done, deliberately)

- [ ] The bundle is 1.14 MB (328 kB gzipped) in a single chunk. Route-level
      `React.lazy` would cut first paint, but it is a build-shape change rather than
      a usability defect, and it risks introducing loading flashes into screens that
      were just made dependable.
- [ ] `showFullImage`-style photo URLs are Cloudinary `secureUrl`s; there is no
      offline cache, so a photo taken on a poor connection shows as a broken image.
      The alt text and layout hold; the image itself does not.
- [ ] Server-side pagination does not exist. The client pages a full fetch, so a
      `jobs` table in the tens of thousands would eventually need a server change.
      At the audited scale (1 000+) 50-row paging is smooth.
- [ ] There is no undo for delete. Every destructive action is confirmed and says
      what it costs, but a 5-second undo affordance would be better than a
      confirmation dialog.

---

## 14. Live browser verification pass

Everything above was found by reading code. This section is what a real browser
found afterwards, on the running app, driving the actual routes. All of it is
fixed.

### Method

There is no viewport-resize tool in this harness, and the browser tab reports
`visibilityState: "hidden"`, which freezes the document timeline — so **every CSS
animation sits at its `from` keyframe** while measuring. Two consequences worth
recording, because they produced false alarms before being diagnosed:

- `getBoundingClientRect()` returns the *transformed* box. A dialog panel frozen at
  `scale(0.95)` measured 796px tall when its layout height was 838px. All dialog
  sizing below is therefore quoted from `offsetHeight` / `offsetTop`, which are
  transform-independent.
- A page root frozen at `translateY(10px)` shifts any *non*-portalled fixed child
  by 10px. Every overlay is portalled, so that was an artefact, not a bug.

For viewport sizes, a same-origin `<iframe>` was used: an iframe is a real
viewport, so media queries and `dvh` units resolve against it, and `localStorage`
carries the admin session across.

### Fixed in this pass

- [x] **Tall dialogs were taller than the window.** The `Modal` panel had no height
      cap, so it grew to its content height (the job edit form measured 1 149px in
      an 886px window). Its own `overflow-y-auto` body therefore never engaged,
      because nothing constrained the panel — the title, the Close button and the
      entire footer, Save included, sat below the fold. Added `.max-h-dialog`
      (`max(14rem, 100dvh - 3rem)`) to the panel. Capping the panel rather than
      making the header and footer `sticky` is the better fix here: the header and
      footer are already `shrink-0` siblings of the scrolling body, so once the
      panel is capped they simply stay put. Verified at 886px and at 420×620:
      `offsetHeight 838` = `maxHeight 838px`, body scrolls `991 > 680`, header at
      the top and Save in view at every scroll position.
- [x] **Sticky table headers were inert on 4 of 6 tables.** `position: sticky` pins
      to the nearest *scrolling* ancestor, and the wrappers were `overflow-auto`
      with no height cap — so each wrapper grew to exactly its table's height
      (`scrollHeight === clientHeight`, measured 1443/1443), never scrolled, and the
      page scrolled instead, taking the column headers off the top. Reading row 40
      gave no clue which column was which. Added a shared `.table-scroll`
      (`max(14rem, 100dvh - 22rem)`; the allowance is the top bar, page header,
      toolbar, pagination and page padding) and applied it to the `Folders`,
      `UsersPage`, `StockPage` and `PhotoGroupsPage` tables. The library table now
      scrolls `1443 > 534` with the header pinned.
- [x] **Tooltips widened the whole page.** `IconButton`'s tooltip was an absolutely
      positioned `whitespace-nowrap` span toggled with `opacity-0` — and an
      invisible element still occupies layout. On a 360px window, "Delete
      Site visit batch - 26 Sep 2026" pushed the document 70px wider and gave
      every page a horizontal scrollbar that had nothing to do with its content.
      Now `hidden` → `block`, which contributes no layout at all, plus a max-width
      so a long record name wraps instead of stretching.
- [x] **Two tooltips per icon button.** `IconButton` set both a custom tooltip and
      `title`, so hovering showed the custom label and then the browser's own label
      over the top of it a second later. Dropped `title`; `aria-label` still
      provides the accessible name.
- [x] **Tooltips hung off the right edge** in right-aligned action columns. Added
      `tooltipPlacement="top-end"` / `"bottom-end"` and applied them to every
      action-column icon button (users, stock, photo groups, jobs, import rows,
      folder cards).
- [x] **The image viewer's arrow keys barely worked.** The `keydown` listener is
      bound once per open, so it closed over the `index` the viewer opened at. Every
      `ArrowRight` computed from index 0, so it jumped to image 2 once and then did
      nothing, and `ArrowLeft` never moved at all — while the on-screen Previous /
      Next buttons worked, because they re-render with the live `index`. Mirrored the
      index into a ref. Now steps correctly in both directions and wraps.
- [x] **Viewport overlays were nudged 10px down for 400ms.** Both full-viewport
      overlays used `animate-fade-in`, whose `from` keyframe is
      `translateY(10px)` — so a `fixed inset-0` backdrop sat 10px below the top of
      the window, leaving an undimmed strip of page showing above it and pushing
      10px off the bottom. Added `overlayIn` (opacity only) for overlays. Verified
      `top 0, left 0, 1021×886, transform: none`, parent `BODY`.
- [x] **The import button was live with no destination chosen.** `canStartImport`
      ignored the destination, so the first click could only produce an error. The
      button is now disabled until the destination is genuinely usable, and the
      action bar says which of the two things is missing ("choose where these jobs
      should go" / "give the new folder a name" / "pick a folder from the list").
- [x] **"Show the 1 row that were not imported"** needed "was" at 1, and its count
      (rows the import *attempted* and failed) sat confusingly next to preview rows
      separately marked "Not imported" for parse-time problems. Now reads
      "Not imported (n) — open to see why".

### Verified working, no change needed

- All 12 routes load, and the console is clean on every one.
- No horizontal overflow at 360×640 on any route; none at 1024×520 or 1280×420.
- Exactly one page title per page: one `<h1>` on the Dashboard (which publishes no
  breadcrumb title) and none elsewhere, where the `TopBar` owns the title.
- Select-all labels are honest ("Select all 50 jobs on this page" selects 50), the
  header select-all shows a real indeterminate state, and the bulk bar reads
  "50 of 139 selected" alongside the range "1–50 of 139 jobs".
- **Selection survives pagination**: selecting 50 on page 1 and moving to page 2
  leaves 0 of page 2's rows ticked and still reports "50 of 139 selected".
- **Selection survives search** in the add-jobs panel, and the panel's counts stay
  honest while filtering: "0 matches for “zzzz” of 121", "Select all matches",
  "1 selected · Add 1 to test1", plus a real no-match state ("No available job
  matches “zzzz”. / Clear search"). The panel reveals 60 rows at a time
  ("Showing 60 of 121", "Show 60 more · Show all"), resetting on a new search.
- Bounded rendering keeps up: the 139-job folder table scrolls `3050 > 528` with a
  pinned header; the Folders library lists 268 items across 25-row pages.
- **Excel import, end to end**, on a generated 6-row workbook containing a
  duplicate, a missing job number, a blank row, an unknown job type and an
  impossible date: the preview reported *5 rows · Ready 1 · Warnings 2 · Cannot
  import 2*, with a specific reason on every row ("Possible duplicate row for Job
  No: UX-TEST-001 (labour)", "Missing Job No", `Unknown job type value: "Something
  Else"`, "Job Given Date is not a valid date and will require review."); the
  confirm dialog itemised rows in file / rows selected / will be added /
  destination and stated that existing jobs are never overwritten; progress
  announced "Importing jobs…" then "Adding 3 records…"; the result reported
  "**2 of 3 records imported — 1 duplicate** / Saved to the new folder
  “UX Import Test”" with links to both job lists and a per-row Outcome column
  (Added / Skipped / Not imported). The database was then restored to its prior
  state (5 folders · 268 library items, 123 labour and 139 with-material jobs) and
  the fixture files were deleted.
- Destructive wording: deleting a folder says "The folder is removed and its 2 items
  are unlinked. Nothing inside is deleted…" and confirms "…was removed. Its 2 items
  were kept."; deleting a job says "This permanently deletes the job and removes it
  from every folder it belongs to. This cannot be undone."

### Known backend issue, not a UX defect

`admin_folders` row `cd96ca4d-ddea-412b-b13d-e9452f7e7ae9` (folder "test") is
returned by the list and name filters, but `?id=eq.cd96ca4d-…` returns `[]` while
`?id=eq.0a7e1c64-…` works. `id` is a real `uuid` column (`like` errors with
`operator does not exist: uuid ~~ unknown`). So `fetchFolder`'s `.single()` always
fails for that one folder. Opening it shows an honest dead end — "Folder not found /
This folder no longer exists — it was probably deleted. Nothing inside it was
affected." with only a "Back to Folders" button and no futile Retry — which is the
UX fix that was in scope. The underlying filter needs a backend change.
