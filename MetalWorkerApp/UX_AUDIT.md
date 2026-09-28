# Mobile App — UX / Usability / Production-Readiness Audit

Project: `MetalWorkerApp` (Expo SDK 57 · expo-router · RN 0.86 · React 19.2 · portrait-only)
Audited: full source read + live browser pass at 360×640 / 390×844 with a mocked backend.

---

## 1. What the app actually is

Routes that exist (`src/app/`):

| Route | State | Notes |
| --- | --- | --- |
| `_layout.tsx` | live | `Stack`, `headerShown: false`, bare `StatusBar` |
| `index.tsx` | live | session bootstrap → redirects by role |
| `login.tsx` | live | username + password, EN/हिं |
| `dashboard.tsx` | live | labour/worker home |
| `processor-dashboard.tsx` | live | processor home (thin `SessionGate` wrapper over shared `DashboardScreen`) |
| `dispatch.tsx` | live | the only real data-entry screen |
| `history.tsx` | live | searchable, filterable, paginated list |
| `profile.tsx` | live | account + language + logout |
| `dispatch/[id].tsx` | live | dispatch detail |
| ~~`scan.tsx`~~ | deleted | needs `expo-camera`; card is an honest "Coming soon" |

Libraries: `supabase-js`, `expo-image-picker`, `expo-location`, `expo-file-system`,
`expo-image`, `expo-symbols`, `expo-glass-effect`, `react-native-safe-area-context`,
`@react-native-async-storage/async-storage`, `expo-network`.
No `expo-camera`, no `@shopify/flash-list`, no tests, no CI.

---

## 2. Findings

Severity: **P0** = blocks or loses work · **P1** = repeatedly annoying a real user · **P2** = polish.

### 2.1 P0 — functional

| # | Problem | Evidence |
| --- | --- | --- |
| F1 | **Submit button is permanently disabled after any failed submit.** `handleVehicleChange` / `handleSelectMaterial` only call `setErrorMessage(null)`, which unmounts the error block *and the Retry button inside it*, while `submissionState` stays `"error"` and the Submit `disabled` prop is `submissionState !== "idle"`. Correcting a typo therefore bricks the form — the worker must go Back and re-take the photo. | `dispatch.tsx` L127–136, L505–524 |
| F2 | **Three blank routes.** `history.tsx`, `profile.tsx`, `scan.tsx` are 0 bytes. Reaching them renders an empty white screen with no error, no title and no way out but the OS back gesture. | measured: `root.children.length === 0`, `body.innerText === ""` for all three |
| F3 | **A failed request is shown as "no data".** `fetchMyRecentDispatches` failure leaves `recentDispatches` as `[]`, which renders *"No recent dispatches / Your submitted logs will appear here"*. A worker with no signal is told they have no work. | `dashboard.tsx` L88–98 |
| F4 | **A transient network error logs the worker out.** `!profile` is true both when the profile row is missing *and* when the query failed, and the failure path calls `signOut()`. Opening the app with one bar of signal destroys the session mid-shift. | `dashboard.tsx` L58–62, `processor-dashboard.tsx` L50–54 |
| F5 | **No session-expiry handling anywhere.** `onAuthStateChange` is never subscribed. An 8-hour shift silently invalidates the token; every later write fails with a raw error and the UI never recovers. | repo-wide |
| F6 | **Android hardware Back discards an in-progress dispatch.** The photo, vehicle number and material are silently lost. | `dispatch.tsx` — no `usePreventRemove` |
| F7 | **No safe-area handling on any screen.** Content is laid out from y=0, so on a notched phone the header and the first ~47px of every screen sit under the status bar. `react-native-safe-area-context` is installed but never used. | measured `firstChildTop: 0` on all routes |

### 2.2 P1 — everyday friction

| # | Problem |
| --- | --- |
| F8 | **Submit is 900px below the fold.** The form is 1544px tall in a 640px viewport, and Submit is the last element. With the keyboard open it is further still. |
| F9 | **Validation is single-field, last-wins, and detached.** Tapping Submit on an empty form shows one message in a red box next to the button, naming a field that is scrolled off the top. No inline errors, no jump to the offending field. |
| F10 | **Retry re-uploads the photo to Cloudinary every time.** The upload result is not cached, so a failed DB insert on a weak connection re-posts a multi-megabyte image on each attempt and leaves an orphan asset per attempt. |
| F11 | **Language resets to English on every screen.** Each screen holds its own `useState("en")`; the `login.tsx` TODO asks for persistence. A worker who picks हिंदी on the dashboard reads English on the form. |
| F12 | **The dashboard's 5 recent dispatches are not pressable**, and there is no way to reach an older one. A worker cannot check a status, a photo, or a location. |
| F13 | **No offline awareness at all.** No network listener, so a dead connection is indistinguishable from a slow one and the UI simply looks frozen. |
| F14 | **"Good Morning" is hardcoded** and shows at 18:29. |
| F15 | **The Date & Time card never changes.** `useState(new Date())` freezes it at mount; it can be hours stale and disagrees with the server-side `submitted_at`. |
| F16 | **The Review checklist marks optional Location as `✕` in grey**, which reads as a failure. It is not tappable, so it cannot be used to fix anything. |
| F17 | **Permission denial is a dead end.** `setErrorMessage(t.camera_error)` and nothing else — no explanation, no route to Settings. |
| F18 | **No pull-to-refresh on any screen.** |
| F19 | **Dead-end cards.** "My History", "Scan QR" and "Profile" all open a `Coming Soon` alert, so the primary navigation is three alerts and a spinner. |
| F20 | **After a successful submit the only way forward is "Back to Dashboard"** — a worker logging a whole shift re-taps that pair for every load. |
| F21 | **`useFocusEffect` refetch on the dashboard** has no in-flight guard against a slow response overwriting fresh data, and no error state. |
| F22 | **`console.log("PHOTO ASSET:", asset)`** logs the whole asset object on every capture. |
| F23 | **Display name is `"Worker"` for processors too** — `processor-dashboard.tsx` uses the same fallback string, so a processor with no `full_name` is greeted as a worker. |
| F24 | **`processor-dashboard.tsx` is a copy-paste of `dashboard.tsx`** with 120 lines of unused styles and a dangling `useFocusEffect` import. Two dashboards, two behaviours. |

### 2.3 P1 — touch targets & accessibility (measured, 44px minimum)

| Control | Size | Where |
| --- | --- | --- |
| `← Back` | 68×37 | `dispatch.tsx` |
| `EN` / `हिं` | 44×32 | all three screens, 3 different implementations |
| `English` / `हिंदी` | 77×35, 58×35 | `login.tsx` |
| `Show` password | 51×35 | `login.tsx` |
| `Retry Location` | 278×41 | `dispatch.tsx` |

No `accessibilityLabel`/`role` on the language switch, back button, password toggle, material
options, or dashboard dispatch rows. `ActionCard` is the only component that sets a label.

### 2.4 P2

- `StatusBar style="dark"` is fixed; there is no light/dark handling and no `app.json` scheme for it.
- `orientation: "portrait"` is correct, but nothing guards a landscape/desktop-size window.
- `predictiveBackGestureEnabled: false` — acceptable, but combined with F6 it means back is unguarded.
- The "STATUS / Active & Online / You are ready to log dispatches" card is decorative; it never changes and tells the worker nothing actionable.
- Material options are 2×2 with `minWidth: "45%"`; long Hindi labels wrap to two lines and the grid rows end up uneven.

---

## 3. Fixes applied

Everything below is verified (live, on device-sized viewports against a mocked Supabase + Cloudinary),
or type-checked where the hardware cannot be driven from a browser harness.

### P0 / functional

| # | Fix |
| --- | --- |
| F1 | Submit is disabled **only while busy**. A failed submit leaves the form fillable and re-submittable; the old "correction bricks the form" state is gone (`dispatch.tsx`). |
| F2 | `history.tsx`, `profile.tsx`, `dispatch/[id].tsx` implemented; `scan.tsx` deleted. |
| F3 | Fetch failures render an explicit error state with `Try again` (and the reason), never the empty state. Verified against a mocked 503. |
| F4 | A failed profile read no longer signs anyone out. `SessionGate` shows a connection error instead; only a genuinely disabled account shows the deactivated message. Verified: transient failure → "Something went wrong … Try again"; `is_active=false` → "Your account has been deactivated…". |
| F5 | `onAuthStateChange` is subscribed once, with cleanup, `TOKEN_REFRESHED` skipped, and `SIGNED_OUT` handled. One profile read per session, guarded against duplicates. |
| F6 | `usePreventRemove` guards a dirty form; Back asks "Discard this dispatch?" with Keep editing / Discard. Verified both the header Back and stacked navigation. |
| F7 | `Screen`/`AppHeader` layout through `SafeAreaProvider`; content starts below the status bar on a notched device. |

### P1 — everyday friction

| # | Fix |
| --- | --- |
| F8 | Submit lives in a sticky footer with a live review checklist; it stays reachable (and the checklist doubles as a pre-submit QA). |
| F9 | Per-field inline errors + an error summary + scroll-to-first-error on submit. Verified empty-submit scrolls and lists all missing fields. |
| F10 | **Cloudinary result is cached per photo URI.** A retry after a failed DB insert does not re-upload the image (verified: attempt 2 = 0 uploads, 1 insert) and leaves no orphan asset. |
| F11 | One shared `LanguageContext`, persisted to AsyncStorage (`mwa.language`). Verified the whole screen re-renders in हिंदी and survives a reload. |
| F12 | Recent dispatches are tappable rows opening `/dispatch/[id]`, and History lists everything with search + status filters + load-more. |
| F13 | `useNetworkStatus` (expo-network) drives a live `NetworkBanner`; offline submits are blocked with an explicit message. Verified banner appears and clears on reconnect. |
| F14 | Greeting is time-aware (`greetingKeyFor`), bilingual. |
| F15 | Date & Time card is a 1-second live clock synced in the footer. |
| F16 | Location is a grey dash ("Not recorded", optional), tapping it captures/opens settings; the permission-denied path has a route to Settings. |
| F17 | Photo permission denial explains and offers Settings (or retry when `canAskAgain`). |
| F18 | Pull-to-refresh on History, Dashboard, Detail (Android `RefreshControl`). |
| F19 | Dashboard quick actions all navigate; History / Profile / Detail are real screens; Scan QR is an honest "Coming soon". |
| F20 | After a successful submit: "Record another" resets the form in one tap (verified twice in a row, 1 upload + 1 insert each). |
| F21 | The list hook guards against stale responses, duplicates, unmounted-setstate and a second request while one is in flight; dashboard errors are shown. |
| F22 | Photo logging removed. |
| F23 | Fallback display name is role-aware ("Labour" / "Processor"). |
| F24 | One shared `DashboardScreen({ expectRole })`; both route files are thin wrappers with `SessionGate`. |

### P1 — touch targets & accessibility (re-measured at 360×640, 44px minimum)

| Control | Before | After |
| --- | --- | --- |
| `EN` / `हिं` switch | 48×32 / 48×42 | **48×44** (the pressable itself, not the pill) |
| Search / sensitive inputs | 249×37 field | wrapper already 52dp; inner input is not the tap target |
| Search **clear** button | 32×32 | **44×44** |
| Back / rows / buttons / chips | mixed | ≥44 (verified: 0 violations at 360×640 on all screens) |

Every interactive control carries an `accessibilityLabel` / `accessibilityRole`; errors are
announced via `accessibilityLiveRegion="assertive"`; the language switch is a labelled radiogroup.

### Found during the final pass (not in the original findings)

| # | Bug | Fix |
| --- | --- | --- |
| F25 | **"Discard" was a dead end.** After discarding, the dialog closed but the form data stayed, the worker stayed on `/dispatch`, and every further Back re-opened the dialog (`navigation.dispatch(GO_BACK)` is a no-op on expo-router's history, so the very navigation was re-intercepted). | Guard stands down via a `leavingRef`; exit uses the documented `router.back()`, falling back to `/dashboard` when there is no history (direct/ deep-link entry). Verified: Discard now leaves; a clean or dirty form opened directly exits to the dashboard instead of doing nothing. |
| F26 | **A transient profile error was reported as "Your account has been deactivated."** `isActive` starts `false`, so any failed profile *read* keyed the deactivated copy. | `SessionGate` only trusts `isActive`/`role` once the profile actually arrived; a read failure shows the real reason (connection vs server). Verified all three paths (connection error ✓, deactivated ✓, missing profile → new "not set up" copy ✓). |
| F27 | **Deactivated state could not be reached through the harness** (param was inverted — fixing the harness confirmed the app path still works). | Harness-only; the app's inactive screen is verified below. |
| F28 | **Search was literally dead against real Supabase**: terms were wrapped in `%…%`, but `%` is literal in PostgREST — the server searched for the text `*KA*`. | Sanitised terms (`replace(/[*%,()]/g," ")`) then `ilike(…, \`*\${safe}*\`)`. Verified: 5 keystrokes = 1 debounced request; `KA` → 17 matches; injection string `*,(),%` sanitises to a full unfiltered list. |

### Verified end-to-end (browser harness, device-sized)

- **Labour**: login → dashboard (greeting, 137 Total, quick actions) → New Dispatch → photo (real file
  injected into the picker) + vehicle + material → Submit → success screen → **Record another** →
  second dispatch, 1 upload + 1 insert each. Cloudinary failure keeps photo + fields + retry copy;
  insert failure keeps everything and re-uses the uploaded image on retry.
- **Processor**: `/` → processor dashboard (role label, correct note copy, no New Dispatch card, no
  total) → typed `/dispatch` is blocked by the role gate with "Not available for your role" + Back.
- **History**: 137 of 137, chips filter to 34 (approved), search to 17, no-match → "Showing 0 of 0",
  Load more at offsets 3/6/15/18 with a double-tap collapsing to one request.
- **Failure modes**: `503` → error + Try again; slow → Loading… → data; online→offline→online banner;
  deactivated account; missing profile copy.
- **Sizes**: 360×640 / 390×844 / 412×915 — no unintended horizontal overflow (only the intentional
  chip scroller), all touch targets ≥44, safe-area respected, full Hindi pass (`stillEnglish: []`).

---

## 4. Deliberately not done

- **Server-side pagination / counts.** `dispatches` is fetched with a bounded page size and
  `Fetch more`. Adding a count query or server-side paging means new backend surface, which is
  out of scope for a UX pass.
- **Offline write queue.** Unsaved photos are now *never silently dropped* (the form warns before
  back, and the submit is blocked with an explicit offline message), but they are not persisted
  across an app kill. That needs local storage of drafts.
- **QR scanning.** Needs `expo-camera`, which is not installed and is a new feature, not a fix.
  The route is removed and the card is labelled instead of lying about it.
- **`dispatched` records are not editable from the mobile app.** The desktop app owns that.
