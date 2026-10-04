// src/pages/JobsPage.tsx
//
// One implementation shared by Labour Jobs (/jobs/labour) and With Material
// Jobs (/jobs/with-material).
//
// Previously these were two 1 558-line files that were 99.1% identical — every
// behaviour below existed twice and only one copy received a fix. They are now
// parameterised by `jobType`.
//
// UX changes relative to the old pages:
//  * Modals are portalled to <body>, so opening Edit on job #450 of a long list
//    no longer renders the dialog at document top.
//  * Search is split: folder search no longer also filters the job table.
//  * Row actions are always visible (they were `opacity-0 group-hover:opacity-100`,
//    i.e. invisible on touch and whenever the pointer left the row).
//  * The action column is sticky-right so Edit/Delete stay reachable when the
//    table is scrolled horizontally.
//  * The table header is sticky.
//  * Selection survives searching, paging and refreshing, and is pruned when
//    records disappear. Select-all lives in the header row with a real
//    indeterminate state.
//  * The bulk bar is viewport-anchored.
//  * Refreshing, saving, adding or removing never replaces the table with a
//    full-page spinner, so scroll position and page number are preserved.
//
// Bill ↔ Job connections, added later:
//  * A CONNECTIONS column carries a text count per row (a link that is only visible
//    as a drawn wire is invisible with the wires off, and to a screen reader).
//  * "Show Links" is OFF on load. On, it draws a wire from each row's job number to
//    each bill it is linked to, and reveals the bill chips the wires attach to.
//  * The bulk bar's "Link to Bill" is available in ALL view modes, not only inside a
//    folder. It used to be folder-only because removing a job from a folder only means
//    anything in a folder; linking a job to a bill is equally meaningful in the full
//    list, which is where an admin starts. The checkbox column moved with it, so the
//    header select-all and the row count stay consistent with the bar.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Briefcase,
  Loader2,
  RefreshCw,
  Image as ImageIcon,
  Folder as FolderIcon,
  Trash2,
  Pencil,
  Plus,
  FolderPlus,
  X,
  SearchX,
  Layers,
  Check,
  ArrowLeft,
  Link2,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { Link } from "react-router-dom";
import {
  fetchJobsByType,
  fetchJobsByFolder,
  removeJobFromFolder,
  removeMultipleJobsFromFolder,
  deleteJob,
  fetchAvailableJobsForFolder,
  addJobToFolder,
  addMultipleJobsToFolder,
} from "../services/jobs";
import { fetchFolders, createFolder, updateFolder, deleteFolder } from "../services/folders";
import {
  getJobConnections,
  unlinkConnections,
} from "../services/billJobConnections";
import type { Job, JobType } from "../types/job";
import type { AdminFolder } from "../types/folder";
import type { JobBillConnection } from "../types/billJobConnections";
import JobEditModal from "../components/jobs/JobEditModal";
import JobDrawingModal from "../components/jobs/JobDrawingModal";
import ConnectionsCell from "../components/jobs/ConnectionsCell";
import ConnectionWires from "../components/jobs/ConnectionWires";
import BillNodeRail from "../components/jobs/BillNodeRail";
import LinkJobsToBillModal from "../components/jobs/LinkJobsToBillModal";
import {
  WIRE_ATTR_ANCHOR,
  anchorAttr,
  groupLinksByJob,
  hoverJob,
  type BillNodeBox,
} from "../components/jobs/wireGeometry";
import { useConnectionWires, type WireHover } from "../hooks/useConnectionWires";
import { usePageMeta } from "../contexts/PageMetaContext";
import { useSelection } from "../hooks/useSelection";
import { useToast } from "../components/ui/Toast";
import { useConfirm } from "../components/ui/ConfirmDialog";
import SearchInput from "../components/ui/SearchInput";
import EmptyState from "../components/ui/EmptyState";
import SelectAllCheckbox, { selectionStats } from "../components/ui/SelectAllCheckbox";
import Pagination, { usePagination } from "../components/ui/Pagination";
import Modal from "../components/ui/Modal";
import BulkActionBar from "../components/ui/BulkActionBar";
import IconButton from "../components/ui/IconButton";
import { ErrorState, InlineRefreshBar, TableSkeleton } from "../components/ui/LoadingState";
interface JobsPageProps {
  jobType: JobType;
  typeLabel: string;
  /**
   * The page's own name, e.g. "Labour Jobs". Distinct from `typeLabel` ("Labour"),
   * which is the entity name used in prose. Keeping them separate stops the
   * title reading "Labour" here while the sidebar and the dashboard quick
   * action call the same screen "Labour Jobs", and stops prose reading
   * "Available Labour Jobs Jobs".
   */
  pageLabel: string;
  /** Field on AdminFolder holding this type's job count. */
  countKey: "labourCount" | "withMaterialCount";
}

const inputCls =
  "w-full px-3.5 py-2.5 rounded-xl bg-bg border border-border text-sm text-text placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all";

/** How many "available jobs" rows are mounted at once. See availableVisible. */
const AVAILABLE_PAGE = 60;

export default function JobsPage({
  jobType,
  typeLabel,
  pageLabel,
  countKey,
}: JobsPageProps) {
  const toast = useToast();
  const confirm = useConfirm();

  /* This page's own route — used for the "back to all …" link and for the
     parent breadcrumb, so neither can point at the Labour page when the user is
     on the With Material page. */
  const listRoute = jobType === "labour" ? "/jobs/labour" : "/jobs/with-material";

  const [folders, setFolders] = useState<AdminFolder[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<AdminFolder | null>(null);
  const [viewMode, setViewMode] = useState<"folders" | "all">("folders");

  /* `loading` is first-load only; `refreshing` is an in-place refresh. Keeping
     them separate is what stops every mutation from wiping the view. */
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Separate searches: one box filtered both the folder grid and the job
     table before, so typing a job number silently emptied the folder list. */
  const [folderSearch, setFolderSearch] = useState("");
  const [jobSearch, setJobSearch] = useState("");
  const [availableSearch, setAvailableSearch] = useState("");

  const [jobs, setJobs] = useState<Job[]>([]);

  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const [drawingModalJob, setDrawingModalJob] = useState<Job | null>(null);

  const [renamingFolder, setRenamingFolder] = useState<AdminFolder | null>(null);
  const [newName, setNewName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  const [deletingJob, setDeletingJob] = useState<Job | null>(null);
  const [deletingJobBusy, setDeletingJobBusy] = useState(false);
  const [rowBusyId, setRowBusyId] = useState<string | null>(null);

  const [showAddPanel, setShowAddPanel] = useState(false);
  const [availableJobs, setAvailableJobs] = useState<Job[]>([]);
  const [addingJobs, setAddingJobs] = useState(false);
  const [addingOneId, setAddingOneId] = useState<string | null>(null);
  const [loadingAvailable, setLoadingAvailable] = useState(false);

  const jobSelection = useSelection();
  const availableSelection = useSelection();

  const tableRef = useRef<HTMLDivElement>(null);
  /* The box that contains BOTH the table and the wire overlay. The overlay lives
     inside the scroll container rather than beside it, so scrolling carries the wires
     and the rows together and the two cannot drift apart. */
  const wireLayerRef = useRef<HTMLDivElement>(null);

  /* ── Bill ↔ Job connections ────────────────────────── */
  /* Show Links is OFF on load. The table has to look like the table did before this
     feature existed until someone asks to see relationships. */
  const [showLinks, setShowLinks] = useState(false);
  const [jobLinks, setJobLinks] = useState<JobBillConnection[]>([]);
  const [connectionsError, setConnectionsError] = useState<string | null>(null);
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [hoveredWire, setHoveredWire] = useState<WireHover | null>(null);
  /* Bumped by the operations that change links without changing which rows exist:
     a completed link or unlink. It is part of the wire geometry key rather than a
     counter of its own so nothing has to run an effect to invalidate it. */
  const [linksVersion, setLinksVersion] = useState(0);

  const inFolderView = viewMode === "folders" && !!selectedFolder;
  const showingFolders = viewMode === "folders" && !selectedFolder;
  /* Selection is offered wherever there is a job table, not only inside a folder.
     Linking a job to a bill is meaningful in the full list too, and it is where an
     admin actually starts. */
  const canSelect = !showingFolders;

  /* ── Data loading ───────────────────────────────────── */

  /* Links for a set of jobs. Kept separate from `loadJobs` so it can be called again
     on its own after a link or unlink without refetching the whole table. */
  const loadJobLinks = useCallback(async (jobIds: string[]) => {
    if (jobIds.length === 0) {
      setJobLinks([]);
      return;
    }
    try {
      setJobLinks(await getJobConnections(jobIds));
      setConnectionsError(null);
    } catch (err) {
      /* Not fatal: the jobs are still perfectly usable without their link counts, so
         this reports itself in the page's own error slot rather than replacing the
         table with a failure screen. */
      setConnectionsError(
        err instanceof Error ? err.message : "Could not read this job's linked bills."
      );
    } finally {
      setLinksVersion((v) => v + 1);
    }
  }, []);

  const loadFolders = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        setFolders(await fetchFolders());
        setError(null);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : `Could not load folders. Check your connection and try again.`
        );
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const loadJobs = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setError(null);
      try {
        let list: Job[] = [];
        if (inFolderView && selectedFolder) {
          list = await fetchJobsByFolder(selectedFolder.id, jobType);
        } else if (viewMode === "all") {
          list = await fetchJobsByType(jobType);
        }
        setJobs(list);
        // Drop selections for jobs that no longer exist in this view.
        jobSelection.prune(list.map((j) => j.id));
        /* Connections are read for the jobs just loaded, in the same pass, and
           separately from the table fetch so a permissions problem reading links
           cannot stop the jobs themselves from appearing. */
        void loadJobLinks(list.map((j) => j.id));
      } catch (err) {
        setError(
          err instanceof Error ? err.message : `Could not load ${typeLabel.toLowerCase()} jobs.`
        );
      } finally {
        setLoading(false);
      }
    },
    // `jobSelection.prune` is stable; excluded to avoid a re-fetch loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inFolderView, selectedFolder, viewMode, jobType, typeLabel, loadJobLinks]
  );

  const loadAvailableJobs = useCallback(
    async (silent = false) => {
      if (!selectedFolder) return;
      if (!silent) setLoadingAvailable(true);
      try {
        const list = await fetchAvailableJobsForFolder(selectedFolder.id, jobType);
        setAvailableJobs(list);
        availableSelection.prune(list.map((j) => j.id));
      } catch (err) {
        toast.error({
          title: "Could not load available jobs",
          description:
            err instanceof Error ? err.message : "The list of jobs you can add did not load.",
        });
      } finally {
        setLoadingAvailable(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedFolder, jobType, toast]
  );

  /* Reset the add panel when the destination folder changes — the available
     list belongs to one folder, so carrying a selection across folders would
     add jobs to the wrong destination. */
  useEffect(() => {
    availableSelection.clear();
    setAvailableSearch("");
  }, [selectedFolder?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (showingFolders) loadFolders();
    else loadJobs();
  }, [showingFolders, loadFolders, loadJobs]);

  useEffect(() => {
    if (showAddPanel && selectedFolder) loadAvailableJobs();
  }, [showAddPanel, selectedFolder, loadAvailableJobs]);

  async function handleRefresh() {
    setRefreshing(true);
    if (showingFolders) await loadFolders(true);
    else {
      await loadJobs(true);
      if (showAddPanel) await loadAvailableJobs(true);
    }
    setRefreshing(false);
  }

  /* ── Derived data ──────────────────────────────────── */

  const relevantFolders = useMemo(
    () =>
      folders.filter(
        (f) =>
          f.folder_type === jobType ||
          ((f.folder_type === "general" || f.folder_type == null) && (f[countKey] ?? 0) > 0)
      ),
    [folders, jobType, countKey]
  );

  const filteredFolders = useMemo(() => {
    if (!folderSearch.trim()) return relevantFolders;
    const q = folderSearch.toLowerCase();
    return relevantFolders.filter((f) => f.name.toLowerCase().includes(q));
  }, [relevantFolders, folderSearch]);

  const groupedFolders = useMemo(() => {
    const groups: Record<string, AdminFolder[]> = {};
    for (const f of filteredFolders) {
      const key = format(parseISO(f.created_at), "MMMM yyyy");
      (groups[key] ||= []).push(f);
    }
    return groups;
  }, [filteredFolders]);

  const filteredJobs = useMemo(() => {
    if (!jobSearch.trim()) return jobs;
    const q = jobSearch.toLowerCase();
    const fields: (keyof Job)[] = [
      "job_no",
      "po_status",
      "tool_description",
      "tool_part",
      "quantity",
      "current_machining_status",
      "status",
      "drawing_status",
      "model_status",
      "expected_completion_note",
    ];
    return jobs.filter((j) =>
      fields.some((f) => (j[f] ?? "").toString().toLowerCase().includes(q))
    );
  }, [jobs, jobSearch]);

  const filteredAvailable = useMemo(() => {
    if (!availableSearch.trim()) return availableJobs;
    const q = availableSearch.toLowerCase();
    return availableJobs.filter(
      (j) =>
        (j.job_no ?? "").toLowerCase().includes(q) ||
        (j.tool_description ?? "").toLowerCase().includes(q) ||
        (j.tool_part ?? "").toLowerCase().includes(q)
    );
  }, [availableJobs, availableSearch]);

  const pagination = usePagination(filteredJobs.length, 50);
  const pageJobs = useMemo(
    () => pagination.pageItems(filteredJobs),
    [pagination.pageItems, filteredJobs]
  );

  const pageJobIds = useMemo(() => pageJobs.map((j) => j.id), [pageJobs]);

  /* ── Connection wires ─────────────────────────────── */
  /* Per job, so a row can render its own chips and the measuring pass can walk the
     table once per row rather than once per link. */
  const linksByJob = useMemo(() => groupLinksByJob(jobLinks), [jobLinks]);
  /* Job numbers for the rail's cards. `get_job_bill_connections` returns the BILL's
     fields, so the job's own number and type come from the rows the page already has —
     no extra request to open a card. */
  const railJobMeta = useMemo(
    () =>
      new Map(jobs.map((j) => [j.id, { jobNo: j.job_no, jobType: j.job_type }])),
    [jobs]
  );
  const linkedJobCount = useMemo(
    () => [...linksByJob.values()].filter((b) => b.length > 0).length,
    [linksByJob]
  );

  /* Recomputed whenever the boxes move: a search, a page change, a folder switch, a
     finished fetch, a completed link or unlink. Declared as a plain string so the
     measuring hook can take it as a dependency — no effect and no extra render just
     to signal that the geometry went stale. */
  const wireGeometry = useConnectionWires({
    containerRef: wireLayerRef,
    links: jobLinks,
    enabled: showLinks,
    measureKey: [
      jobSearch,
      pagination.page,
      inFolderView ? (selectedFolder?.id ?? "") : viewMode,
      jobs.length,
      linksVersion,
    ].join("|"),
  });

  /* ── Available jobs: bounded rendering ──────────────
     "Available Labour Jobs" is every job in the system that is not already in
     the open folder, so this list can be thousands of rows. Rendering all of
     them made opening the Add Jobs panel slow and left a scroll area tens of
     thousands of pixels tall. Rows are revealed in blocks, which also keeps
     "Select all matches" honest: it selects the rows actually on screen. */
  const [availableVisible, setAvailableVisible] = useState(AVAILABLE_PAGE);
  const availableKey = availableSearch.trim().toLowerCase();
  const [lastAvailableKey, setLastAvailableKey] = useState(availableKey);
  if (availableKey !== lastAvailableKey) {
    // A new search term is a new result set: start it from the top.
    setLastAvailableKey(availableKey);
    setAvailableVisible(AVAILABLE_PAGE);
  }

  const visibleAvailable = useMemo(
    () => filteredAvailable.slice(0, availableVisible),
    [filteredAvailable, availableVisible]
  );
  const remainingAvailable = filteredAvailable.length - visibleAvailable.length;

  const filteredAvailableIds = useMemo(
    () => visibleAvailable.map((j) => j.id),
    [visibleAvailable]
  );
  const availableStats = selectionStats(filteredAvailableIds, availableSelection.selected);

  /* ── Breadcrumb / title ───────────────────────────── */

  usePageMeta(
    {
      title: selectedFolder && inFolderView ? selectedFolder.name : pageLabel,
      crumbs: [
        { label: "Jobs" },
        { label: pageLabel, to: selectedFolder && inFolderView ? listRoute : undefined },
        ...(selectedFolder && inFolderView ? [{ label: selectedFolder.name }] : []),
      ],
      subtitle: showingFolders
        ? `${relevantFolders.length} folder${relevantFolders.length === 1 ? "" : "s"}`
        : `${jobs.length} ${typeLabel} job${jobs.length === 1 ? "" : "s"}`,
      /* The body header prints this same count directly under the actions. */
      selfTitles: true,
    },
    [selectedFolder?.id, viewMode, typeLabel, pageLabel, relevantFolders.length, jobs.length]
  );

  /* ── Folder actions ────────────────────────────────── */

  async function handleCreateFolder() {
    const name = newFolderName.trim();
    if (!name) {
      toast.warning("Enter a folder name first.");
      return;
    }
    const { ok, data, error: err } = await createFolder(name, jobType);
    if (ok && data) {
      setCreatingFolder(false);
      setNewFolderName("");
      await loadFolders(true);
      setSelectedFolder(data);
      toast.success({ title: "Folder created", description: `“${name}” is ready for jobs.` });
    } else {
      toast.error({
        title: "Could not create folder",
        description: err || "The folder was not created. The name may already be in use.",
      });
    }
  }

  async function handleRenameFolder() {
    if (!renamingFolder) return;
    const name = newName.trim();
    if (!name) {
      toast.warning("Enter a folder name first.");
      return;
    }
    const { ok, error: err } = await updateFolder(renamingFolder.id, name);
    if (ok) {
      if (selectedFolder?.id === renamingFolder.id) {
        setSelectedFolder({ ...selectedFolder, name });
      }
      setRenamingFolder(null);
      loadFolders(true);
      toast.success({ title: "Folder renamed", description: `Now called “${name}”.` });
    } else {
      toast.error({
        title: "Could not rename folder",
        description: err || "The folder name was not changed.",
      });
    }
  }

  async function handleDeleteFolder(folder: AdminFolder) {
    const jobCount = folder[countKey] ?? 0;
    const ok = await confirm({
      title: `Delete “${folder.name}”?`,
      message: (
        <>
          This removes the folder and unlinks everything inside it.
          <strong className="block mt-2 text-text">
            The {jobCount} {typeLabel} job{jobCount === 1 ? "" : "s"} inside will be kept and stay
            available under All Jobs.
          </strong>
        </>
      ),
      confirmLabel: "Delete folder",
    });
    if (!ok) return;

    const res = await deleteFolder(folder.id);
    if (res.ok) {
      if (selectedFolder?.id === folder.id) {
        setSelectedFolder(null);
        setViewMode("folders");
      }
      loadFolders(true);
      toast.success({
        title: "Folder deleted",
        description: `“${folder.name}” was removed. Its ${jobCount} job${
          jobCount === 1 ? "" : "s"
        } remain in All Jobs.`,
      });
    } else {
      toast.error({
        title: "Could not delete folder",
        description: res.error || "The folder was not deleted. Please try again.",
      });
    }
  }

  /* ── Job ↔ folder actions ─────────────────────────── */

  async function handleRemoveJob(job: Job) {
    if (!selectedFolder) return;
    const folderName = selectedFolder.name;
    const ok = await confirm({
      title: "Remove from folder?",
      message: (
        <>
          Job <strong className="text-text">{job.job_no || "(no number)"}</strong> will be removed
          from <strong className="text-text">{folderName}</strong>.
          <strong className="block mt-2 text-text">
            The job itself is not deleted — it stays in All Jobs.
          </strong>
        </>
      ),
      confirmLabel: "Remove from folder",
      tone: "primary",
    });
    if (!ok) return;

    setRowBusyId(job.id);
    const res = await removeJobFromFolder(folderName === selectedFolder.name ? selectedFolder.id : selectedFolder.id, job.id);
    setRowBusyId(null);

    if (res.ok) {
      // Local removal keeps the scroll position and avoids a full refetch.
      setJobs((prev) => prev.filter((j) => j.id !== job.id));
      jobSelection.prune(jobs.filter((j) => j.id !== job.id).map((j) => j.id));
      if (showAddPanel) loadAvailableJobs(true);
      toast.success({
        title: "Removed from folder",
        description: `${job.job_no || "Job"} is no longer in ${folderName}. The job itself is untouched.`,
      });
    } else {
      toast.error({
        title: "Could not remove job",
        description: res.error || "The job is still in the folder. Please try again.",
      });
    }
  }

  /* ── Bill ↔ Job connections ────────────────────────── */

  /** Unlink one bill from one job, after confirming. Neither entity is touched. */
  async function handleUnlink(job: Job, link: JobBillConnection) {
    const ok = await confirm({
      title: "Unlink this bill?",
      message: (
        <>
          <strong className="text-text">{link.label}</strong> will be unlinked from job{" "}
          <strong className="text-text">{job.job_no || "(no number)"}</strong>.
          <strong className="block mt-2 text-text">
            Only the connection is removed. The bill and the job both stay exactly as they
            are, and any other bills this job is linked to are untouched.
          </strong>
        </>
      ),
      confirmLabel: "Unlink",
      tone: "danger",
    });
    if (!ok) return;

    setRowBusyId(job.id);
    try {
      await unlinkConnections([job.id], [link.bill_id]);
      /* Read the links for this one job again rather than refetching the table: the
         only thing that changed is a relationship. */
      const refreshed = await getJobConnections([job.id]);
      setJobLinks((prev) => [
        ...prev.filter((l) => l.job_id !== job.id),
        ...refreshed,
      ]);
      toast.success({
        title: "Unlinked",
        description: `${link.label} is no longer linked to job ${job.job_no || ""}.`,
      });
    } catch (err) {
      toast.error({
        title: "Could not unlink",
        description: err instanceof Error ? err.message : "The connection is unchanged.",
      });
    } finally {
      setRowBusyId(null);
      setLinksVersion((v) => v + 1);
    }
  }

  /**
   * Unlink from the BILL side — the shared rail's card.
   *
   * The same relationship as `handleUnlink`, approached from its other end, so it cannot
   * drift: one delete of the same pair, one confirmation that says the same thing, one
   * refresh of the same link list. The job's number is read back out of the node's own
   * links rather than passed in, because the rail knows the bill and the link but not
   * the job object.
   */
  async function handleUnlinkFromRail(node: BillNodeBox, link: JobBillConnection) {
    const job = jobs.find((j) => j.id === link.job_id);
    if (job) {
      await handleUnlink(job, link);
      return;
    }
    /* The job is not in the loaded page — it can only happen if the list changed between
       rendering and clicking. Still unlink, just without the name. */
    const jobNo = railJobMeta.get(link.job_id)?.jobNo ?? null;
    const ok = await confirm({
      title: "Unlink this job?",
      message: (
        <>
          <strong className="text-text">{jobNo || "This job"}</strong> will be
          unlinked from <strong className="text-text">{node.label}</strong>.
          <strong className="block mt-2 text-text">
            Only the connection is removed. The bill and the job both stay exactly as they
            are.
          </strong>
        </>
      ),
      confirmLabel: "Unlink",
      tone: "danger",
    });
    if (!ok) return;
    setRowBusyId(link.job_id);
    try {
      await unlinkConnections([link.job_id], [node.billId]);
      await loadJobLinks(jobs.map((j) => j.id));
      toast.success({ title: "Unlinked", description: `${jobNo || "Job"} is off ${node.label}.` });
    } catch (err) {
      toast.error({
        title: "Could not unlink",
        description: err instanceof Error ? err.message : "The connection is unchanged.",
      });
    } finally {
      setRowBusyId(null);
      setLinksVersion((v) => v + 1);
    }
  }

  /** Called after the link modal reports what it actually did. */
  async function handleLinked(result: { linked: number; alreadyLinked: number }) {
    await loadJobLinks(jobs.map((j) => j.id));
    toast.success({
      title:
        result.alreadyLinked > 0
          ? `Linked ${result.linked} job${result.linked === 1 ? "" : "s"}`
          : "Jobs linked",
      description:
        result.alreadyLinked > 0
          ? `${result.linked} new connection${result.linked === 1 ? "" : "s"} created. ${result.alreadyLinked} were already linked and were left as they were.`
          : `${result.linked} connection${result.linked === 1 ? "" : "s"} created. Turn on Show Links to see the wires.`,
    });
  }

  async function handleRemoveSelected() {
    if (!selectedFolder) return;
    const ids = Array.from(jobSelection.selected);
    if (ids.length === 0) return;

    const folderName = selectedFolder.name;
    const ok = await confirm({
      title: `Remove ${ids.length} job${ids.length === 1 ? "" : "s"} from folder?`,
      message: (
        <>
          The selected jobs will be unlinked from{" "}
          <strong className="text-text">{folderName}</strong>.
          <strong className="block mt-2 text-text">
            No job is deleted. All {ids.length} remain available in All Jobs.
          </strong>
        </>
      ),
      confirmLabel: `Remove ${ids.length} from folder`,
      tone: "primary",
    });
    if (!ok) return;

    const res = await removeMultipleJobsFromFolder(selectedFolder.id, ids);
    if (res.ok) {
      const idSet = new Set(ids);
      setJobs((prev) => {
        const next = prev.filter((j) => !idSet.has(j.id));
        jobSelection.prune(next.map((j) => j.id));
        return next;
      });
      jobSelection.clear();
      if (showAddPanel) loadAvailableJobs(true);
      toast.success({
        title: `${ids.length} job${ids.length === 1 ? "" : "s"} removed`,
        description: `Unlinked from ${folderName}. No jobs were deleted.`,
      });
    } else {
      toast.error({
        title: "Could not remove jobs",
        description: res.error || "Nothing was removed. Please try again.",
      });
    }
  }

  async function handleDeleteJob() {
    if (!deletingJob) return;
    const job = deletingJob;
    setDeletingJobBusy(true);
    const res = await deleteJob(job.id);
    setDeletingJobBusy(false);

    if (res.ok) {
      setDeletingJob(null);
      setJobs((prev) => {
        const next = prev.filter((j) => j.id !== job.id);
        jobSelection.prune(next.map((j) => j.id));
        return next;
      });
      if (showAddPanel) loadAvailableJobs(true);
      toast.success({
        title: "Job deleted",
        description: `${job.job_no || "Job"} was permanently deleted.`,
      });
    } else {
      toast.error({
        title: "Could not delete job",
        description: res.error || "The job was not deleted. Please try again.",
      });
    }
  }

  async function handleAddOne(job: Job) {
    if (!selectedFolder) return;
    setAddingOneId(job.id);
    const res = await addJobToFolder(selectedFolder.id, job.id);
    setAddingOneId(null);

    if (res.ok) {
      setJobs((prev) => [job, ...prev]);
      setAvailableJobs((prev) => prev.filter((j) => j.id !== job.id));
      availableSelection.prune(availableJobs.filter((j) => j.id !== job.id).map((j) => j.id));
      toast.success({
        title: "Added to folder",
        description: `${job.job_no || "Job"} was added to ${selectedFolder.name}.`,
      });
    } else {
      toast.error({
        title: "Could not add job",
        description: res.error || "The job was not added. Please try again.",
      });
    }
  }

  async function handleAddSelected() {
    if (!selectedFolder) return;
    const ids = Array.from(availableSelection.selected);
    if (ids.length === 0) return;

    setAddingJobs(true);
    const res = await addMultipleJobsToFolder(selectedFolder.id, ids);
    setAddingJobs(false);

    if (res.ok) {
      const idSet = new Set(ids);
      const added = availableJobs.filter((j) => idSet.has(j.id));
      setJobs((prev) => [...added, ...prev]);
      setAvailableJobs((prev) => prev.filter((j) => !idSet.has(j.id)));
      availableSelection.clear();
      toast.success({
        title: `${ids.length} job${ids.length === 1 ? "" : "s"} added`,
        description: `Added to ${selectedFolder.name}. They now appear in the list on the left.`,
      });
    } else {
      toast.error({
        title: "Could not add jobs",
        description: res.error || "Nothing was added. Please try again.",
      });
    }
  }

  /* ── Render ────────────────────────────────────────── */

  const goToFolders = useCallback(() => {
    setViewMode("folders");
    setSelectedFolder(null);
    setShowAddPanel(false);
    setJobSearch("");
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 size={32} className="text-primary animate-spin" />
        <span className="sr-only">Loading {typeLabel} jobs</span>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fade-in">
      {/* ─── Page heading ───
          No title here. The TopBar already carries the page name and the
          breadcrumb trail, and this block used to print a *second* copy of the
          same words as a button — so the page appeared to be titled twice, and
          the one down here looked like a heading but navigated somewhere. What
          remains is the count and the actions. */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-primary-muted flex items-center justify-center shrink-0">
            <Briefcase size={20} className="text-primary" />
          </div>
          <div className="min-w-0">
            {inFolderView ? (
              /* A real link: this is navigation, and it should behave like it. */
              <Link
                to={listRoute}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline underline-offset-2"
              >
                <ArrowLeft size={14} />
                All {pageLabel}
              </Link>
            ) : (
              <p className="text-sm font-semibold text-text">
                {showingFolders ? "Folders" : `All ${typeLabel} jobs`}
              </p>
            )}
            <p className="text-sm text-text-muted">
              {showingFolders
                ? `${relevantFolders.length} folder${relevantFolders.length === 1 ? "" : "s"}`
                : `${jobs.length} ${typeLabel} job${jobs.length === 1 ? "" : "s"}`}
              {selectedFolder && !showingFolders && ` in ${selectedFolder.name}`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {inFolderView && (
            <button
              type="button"
              onClick={() => setShowAddPanel((s) => !s)}
              aria-expanded={showAddPanel}
              aria-controls="add-jobs-panel"
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all cursor-pointer ${
                showAddPanel
                  ? "bg-primary text-white shadow-md shadow-primary/20"
                  : "bg-surface border border-border text-text-muted hover:text-text hover:bg-surface-hover"
              }`}
            >
              <Plus size={14} />
              Add Jobs
            </button>
          )}

          <div
            className="flex bg-surface border border-border rounded-xl p-1"
            role="group"
            aria-label="View"
          >
            <button
              type="button"
              onClick={goToFolders}
              aria-pressed={viewMode === "folders" && !selectedFolder}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all cursor-pointer ${
                viewMode === "folders" && !selectedFolder
                  ? "bg-primary text-white shadow-md shadow-primary/20"
                  : "text-text-muted hover:text-text hover:bg-surface-hover"
              }`}
            >
              Folders
            </button>
            <button
              type="button"
              onClick={() => {
                setViewMode("all");
                setSelectedFolder(null);
                setShowAddPanel(false);
                setJobSearch("");
              }}
              aria-pressed={viewMode === "all"}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all cursor-pointer ${
                viewMode === "all"
                  ? "bg-primary text-white shadow-md shadow-primary/20"
                  : "text-text-muted hover:text-text hover:bg-surface-hover"
              }`}
            >
              All Jobs
            </button>
          </div>

          {/* Show Links. Present in every view that has a job table, and OFF on load:
              the plain table is the default, and relationships are something to go
              and look at rather than something to arrive already drawn. */}
          {canSelect && (
            <button
              type="button"
              onClick={() => setShowLinks((v) => !v)}
              aria-pressed={showLinks}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all cursor-pointer ${
                showLinks
                  ? "bg-connection text-white shadow-md"
                  : "bg-surface border border-border text-text-muted hover:text-text hover:bg-surface-hover"
              }`}
            >
              <Link2 size={14} />
              Show Links
              {linkedJobCount > 0 && (
                <span className="text-xs font-semibold opacity-70">{linkedJobCount}</span>
              )}
            </button>
          )}

          <IconButton
            label={refreshing ? "Refreshing…" : "Refresh data"}
            icon={<RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />}
            onClick={handleRefresh}
            busy={refreshing}
            variant="surface"
          />
        </div>
      </div>

      {error && (
        <ErrorState
          message={error}
          onRetry={() => (showingFolders ? loadFolders() : loadJobs())}
          title="Could not load this list"
        />
      )}

      {/* A connections failure is reported INLINE rather than replacing the table: the
          jobs are all still there and fully usable, and only the link counts are
          missing. Swapping the page for an error would overstate the problem. */}
      {connectionsError && !error && (
        <p
          role="status"
          className="shrink-0 rounded-xl border border-warning/30 bg-warning/10 px-4 py-2.5 text-xs text-warning"
        >
          Could not read bill connections: {connectionsError} The jobs below are unaffected.
        </p>
      )}

      {/* ─── Folders view ─── */}
      {!error && (showingFolders ? (
        <>
          <SearchInput
            value={folderSearch}
            onChange={setFolderSearch}
            scope="folders"
            resultCount={filteredFolders.length}
            totalCount={relevantFolders.length}
            placeholder="Search folders by name…"
            className="max-w-md"
          />

          <button
            type="button"
            onClick={() => {
              setCreatingFolder(true);
              setNewFolderName("");
            }}
            className="flex items-center gap-2 px-5 py-3 rounded-xl bg-surface border-2 border-dashed border-border text-sm font-bold text-text-muted hover:border-primary hover:text-primary transition-all cursor-pointer"
          >
            <FolderPlus size={18} />
            New Folder
          </button>

          {filteredFolders.length === 0 ? (
            <div className="bg-surface/30 border-2 border-dashed border-border rounded-3xl">
              <EmptyState
                icon={<FolderIcon size={26} />}
                title={
                  folderSearch.trim()
                    ? "No folders match your search"
                    : `No ${typeLabel} folders yet`
                }
                description={
                  folderSearch.trim() ? (
                    <>
                      No folder name contains “{folderSearch.trim()}”. There{" "}
                      {relevantFolders.length === 1 ? "is" : "are"} {relevantFolders.length}{" "}
                      {typeLabel} folder{relevantFolders.length === 1 ? "" : "s"} in total.
                    </>
                  ) : (
                    <>
                      Create a folder to group {typeLabel.toLowerCase()} jobs, or import an Excel
                      file and let the import create one for you.
                    </>
                  )
                }
                action={
                  folderSearch.trim() ? (
                    <button
                      type="button"
                      onClick={() => setFolderSearch("")}
                      className="px-4 py-2.5 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-hover transition-colors cursor-pointer"
                    >
                      Clear search
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setCreatingFolder(true);
                          setNewFolderName("");
                        }}
                        className="px-4 py-2.5 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-hover transition-colors cursor-pointer"
                      >
                        Create a folder
                      </button>
                      <a
                        href="/jobs/import"
                        className="px-4 py-2.5 rounded-xl bg-surface border border-border text-sm font-bold text-text hover:bg-surface-hover transition-colors"
                      >
                        Import from Excel
                      </a>
                    </>
                  )
                }
              />
            </div>
          ) : (
            <div className="space-y-8">
              {Object.entries(groupedFolders).map(([month, monthFolders]) => (
                <div key={month} className="space-y-4">
                  <h2 className="text-sm font-bold text-text-muted uppercase tracking-wider pl-2 border-l-2 border-primary">
                    {month}
                  </h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4">
                    {monthFolders.map((folder) => (
                      <div
                        key={folder.id}
                        className="bg-surface border border-border rounded-2xl p-5 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5 transition-all group"
                      >
                        <div className="flex items-start justify-between mb-4">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedFolder(folder);
                              setJobSearch("");
                            }}
                            className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary group-hover:scale-110 transition-transform shrink-0 cursor-pointer"
                            aria-label={`Open folder ${folder.name}`}
                          >
                            <FolderIcon size={20} className="fill-primary/20" />
                          </button>
                          {/* Always visible: these were hover-only, so they were
                              unreachable on touch and easy to miss on desktop. */}
                          <div className="flex items-center gap-0.5">
                            <IconButton
                              label={`Rename ${folder.name}`}
                              size="sm"
                              icon={<Pencil size={14} />}
                              onClick={() => {
                                setRenamingFolder(folder);
                                setNewName(folder.name);
                              }}
                            />
                            <IconButton
                              label={`Delete ${folder.name}`}
                              size="sm"
                              variant="danger"
                              icon={<Trash2 size={14} />}
                              onClick={() => handleDeleteFolder(folder)}
                            />
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            setSelectedFolder(folder);
                            setJobSearch("");
                          }}
                          className="block w-full text-left cursor-pointer"
                        >
                          <h3
                            className="font-bold text-text mb-1 truncate hover:text-primary transition-colors"
                            title={folder.name}
                          >
                            {folder.name}
                          </h3>
                          <p className="text-xs font-semibold text-primary mb-1">
                            {folder[countKey]} {typeLabel} Job
                            {folder[countKey] === 1 ? "" : "s"}
                          </p>
                          <p className="text-[10px] text-text-muted">
                            Created {format(parseISO(folder.created_at), "MMM d, yyyy")}
                          </p>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        /* ─── Job table ─── */
        <>
          <SearchInput
            value={jobSearch}
            onChange={setJobSearch}
            scope={`${typeLabel} jobs`}
            resultCount={filteredJobs.length}
            totalCount={jobs.length}
            placeholder={`Search by job no, tool, status…`}
            className="max-w-lg"
          />

          <div className="flex gap-5 items-start">
            {/* Table */}
            <div className="flex-1 min-w-0 w-full">
              <div
                ref={tableRef}
                className="bg-surface border border-border rounded-xl overflow-hidden flex flex-col max-h-[calc(100dvh-16rem)]"
              >
                <InlineRefreshBar show={refreshing} />

                {refreshing && jobs.length > 0 ? (
                  <TableSkeleton rows={8} columns={6} />
                ) : filteredJobs.length === 0 ? (
                  <EmptyState
                    icon={<SearchX size={24} />}
                    title={
                      jobSearch.trim()
                        ? "No jobs match your search"
                        : inFolderView
                          ? `This folder has no ${typeLabel.toLowerCase()} jobs`
                          : `No ${typeLabel.toLowerCase()} jobs yet`
                    }
                    description={
                      jobSearch.trim() ? (
                        <>
                          Nothing in this {typeLabel.toLowerCase()} job list contains{" "}
                          <strong className="text-text">“{jobSearch.trim()}”</strong>. There{" "}
                          {jobs.length === 1 ? "is" : "are"} {jobs.length} job
                          {jobs.length === 1 ? "" : "s"} here in total.
                        </>
                      ) : inFolderView ? (
                        <>
                          Use <strong className="text-text">Add Jobs</strong> to pull jobs into{" "}
                          {selectedFolder?.name}.
                        </>
                      ) : (
                        <>Import an Excel file to create {typeLabel.toLowerCase()} jobs.</>
                      )
                    }
                    action={
                      jobSearch.trim() ? (
                        <button
                          type="button"
                          onClick={() => setJobSearch("")}
                          className="px-4 py-2.5 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-hover transition-colors cursor-pointer"
                        >
                          Clear search
                        </button>
                      ) : inFolderView ? (
                        <button
                          type="button"
                          onClick={() => setShowAddPanel(true)}
                          className="px-4 py-2.5 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-hover transition-colors cursor-pointer"
                        >
                          Add jobs to this folder
                        </button>
                      ) : (
                        <a
                          href="/jobs/import"
                          className="px-4 py-2.5 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-hover transition-colors"
                        >
                          Import from Excel
                        </a>
                      )
                    }
                  />
                ) : (
                  <>
                    {/* Sticky header + horizontal scroll for the wide columns,
                        with a frozen action column so the actions never scroll
                        out of reach.

                        The wire layer is a SIBLING of the table inside this same
                        scroll box, not a fixed overlay beside it. That is deliberate:
                        the browser scrolls one layer containing both, so a wire can
                        never end up a frame behind its row no matter how the table is
                        scrolled, and no scroll listener is needed to keep them
                        together. */}
                    <div className="overflow-auto scrollbar-thin flex-1 min-h-0">
                      <div ref={wireLayerRef} className="relative">
                        <ConnectionWires geometry={wireGeometry} hovered={hoveredWire} />
                        <BillNodeRail
                          nodes={wireGeometry.nodes}
                          railX={wireGeometry.railX}
                          railWidth={wireGeometry.railWidth}
                          height={wireGeometry.height}
                          hovered={hoveredWire}
                          jobMeta={railJobMeta}
                          onHover={setHoveredWire}
                          onUnlink={(node, link) => void handleUnlinkFromRail(node, link)}
                        />
                      <table className="w-full whitespace-nowrap relative z-[2]">
                        <thead className="sticky-head">
                          <tr className="border-b border-border">
                            {canSelect && (
                              <th className="px-4 py-3 w-11 text-left">
                                <SelectAllCheckbox
                                  ids={pageJobIds}
                                  selection={jobSelection}
                                  label={`Select all ${pageJobIds.length} jobs on this page`}
                                />
                              </th>
                            )}
                            <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-4 py-3">
                              Job No
                            </th>
                            <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-4 py-3">
                              Given Date
                            </th>
                            <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-4 py-3">
                              PO Status
                            </th>
                            <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-4 py-3">
                              Tool / Part
                            </th>
                            <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-4 py-3">
                              Qty
                            </th>
                            <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-4 py-3">
                              Expected
                            </th>
                            <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-4 py-3">
                              Machining
                            </th>
                            <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-4 py-3">
                              Status
                            </th>
                            <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-4 py-3">
                              DRG
                            </th>
                            <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-4 py-3">
                              Model
                            </th>
                            {/* Deliberately NOT `sticky-actions`: that class is for the
                                frozen right-hand column, and giving it a second use would
                                fight its z-index and its fade-out gradient.
                                The column is WIDER while Show Links is on, because the
                                shared bill targets are positioned inside it — no new
                                column is added, and the table is untouched when links are
                                off. */}
                            <th
                              className={`text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-4 py-3 ${
                                showLinks ? "w-[15rem]" : ""
                              }`}
                            >
                              Connections
                            </th>
                            <th className="sticky-actions sticky-head-cell text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-4 py-3 w-[9.5rem]">
                              Actions
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {pageJobs.map((item) => {
                            const rowBusy = rowBusyId === item.id;
                            const rowLinks = linksByJob.get(item.id) ?? [];
                            const rowBillIds = rowLinks.map((b) => b.bill_id);
                            /* Hovering a bill target lights every row that reaches it, which
                               is the whole reason the target is worth hovering. */
                            const rowOnHoveredBill =
                              !!hoveredWire?.billId && rowBillIds.includes(hoveredWire.billId);
                            return (
                              <tr
                                key={item.id}
                                aria-busy={rowBusy}
                                /* Hovering anywhere on the row emphasises its wires, so the
                                   relationship can be inspected without aiming at the
                                   count badge. Cheap: it only sets state while Show Links
                                   is on and the row actually has links. */
                                onMouseEnter={() => {
                                  if (showLinks && rowLinks.length > 0) {
                                    setHoveredWire(hoverJob(item.id, rowBillIds));
                                  }
                                }}
                                onMouseLeave={() => {
                                  if (showLinks) setHoveredWire(null);
                                }}
                                className={`transition-colors ${
                                  rowOnHoveredBill
                                    ? "bg-connection-muted"
                                    : jobSelection.isSelected(item.id)
                                      ? "bg-primary/5"
                                      : "hover:bg-surface-hover/50"
                                } ${rowBusy ? "opacity-60" : ""}`}
                              >
                                {canSelect && (
                                  <td className="px-4 py-3.5">
                                    <input
                                      type="checkbox"
                                      checked={jobSelection.isSelected(item.id)}
                                      onChange={() => jobSelection.toggle(item.id)}
                                      aria-label={`Select job ${item.job_no || "without a number"}`}
                                      className="w-4 h-4 rounded accent-primary cursor-pointer"
                                    />
                                  </td>
                                )}
                                {/* This cell is the wire's job-side anchor. Measuring an
                                    existing cell rather than adding a marker element keeps
                                    the row's DOM unchanged, so the wire starts at the same
                                    place whether or not links are shown. */}
                                <td
                                  className="px-4 py-3.5"
                                  {...{ [WIRE_ATTR_ANCHOR]: anchorAttr(item.id) }}
                                >
                                  <button
                                    type="button"
                                    onClick={() => setEditingJob(item)}
                                    title={`Edit job ${item.job_no || ""}`}
                                    className="text-sm font-semibold text-text hover:text-primary transition-colors cursor-pointer text-left"
                                  >
                                    {item.job_no || "—"}
                                  </button>
                                </td>
                                <td className="px-4 py-3.5 text-sm text-text-muted">
                                  {item.job_given_date || "—"}
                                </td>
                                <td className="px-4 py-3.5 text-sm text-text-muted">
                                  {item.po_status || "—"}
                                </td>
                                <td
                                  className="px-4 py-3.5 text-sm text-text-muted max-w-[22rem] truncate"
                                  title={
                                    [item.tool_description, item.tool_part].filter(Boolean).join(" / ") ||
                                    undefined
                                  }
                                >
                                  {item.tool_description || "—"}
                                  {item.tool_part ? ` / ${item.tool_part}` : ""}
                                </td>
                                <td className="px-4 py-3.5 text-sm text-text-muted">
                                  {item.quantity ?? "—"}
                                </td>
                                <td className="px-4 py-3.5 text-sm text-text-muted">
                                  {item.expected_completion_date ||
                                    item.expected_completion_note ||
                                    "—"}
                                </td>
                                <td className="px-4 py-3.5 text-sm text-text-muted">
                                  {item.current_machining_status || "—"}
                                </td>
                                <td className="px-4 py-3.5">
                                  <span className="px-2 py-1 bg-surface-hover rounded text-xs text-text inline-block">
                                    {item.status || "—"}
                                  </span>
                                </td>
                                <td className="px-4 py-3.5">
                                  <button
                                    type="button"
                                    onClick={() => setDrawingModalJob(item)}
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-surface border border-border text-xs font-semibold text-text hover:border-primary hover:text-primary transition-colors cursor-pointer"
                                  >
                                    <ImageIcon size={14} className="text-text-muted shrink-0" />
                                    {item.drawing_status || "—"}
                                  </button>
                                </td>
                                <td className="px-4 py-3.5 text-sm text-text-muted">
                                  {item.model_status || "—"}
                                </td>
                                <ConnectionsCell
                                  jobNo={item.job_no}
                                  bills={rowLinks}
                                  rail={showLinks}
                                  busy={rowBusy}
                                  onHover={setHoveredWire}
                                  onUnlink={(link) => void handleUnlink(item, link)}
                                />
                                <td className="sticky-actions px-4 py-3.5">
                                  <div className="flex items-center gap-1">
                                    <IconButton
                                      label={`Edit job ${item.job_no || ""}`}
                                      size="sm"
                                      tooltipPlacement="top-end"
                                      icon={<Pencil size={14} />}
                                      onClick={() => setEditingJob(item)}
                                      disabled={rowBusy}
                                    />
                                    <IconButton
                                      label={`Drawings for job ${item.job_no || ""}`}
                                      size="sm"
                                      tooltipPlacement="top-end"
                                      icon={<ImageIcon size={14} />}
                                      onClick={() => setDrawingModalJob(item)}
                                      disabled={rowBusy}
                                    />
                                    {inFolderView && (
                                      <IconButton
                                        label={`Remove ${item.job_no || "this job"} from folder ${selectedFolder?.name} (job is kept)`}
                                        size="sm"
                                        tooltipPlacement="top-end"
                                        icon={<X size={14} />}
                                        onClick={() => handleRemoveJob(item)}
                                        busy={rowBusy}
                                        disabled={rowBusy}
                                      />
                                    )}
                                    <IconButton
                                      label={`Permanently delete job ${item.job_no || ""}`}
                                      size="sm"
                                      tooltipPlacement="top-end"
                                      variant="danger"
                                      icon={<Trash2 size={14} />}
                                      onClick={() => setDeletingJob(item)}
                                      disabled={rowBusy}
                                    />
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      </div>
                    </div>

                    {inFolderView && (
                      <div className="px-4 py-2 border-t border-border bg-surface-hover/30 flex items-center justify-between gap-3 shrink-0">
                        <span className="text-xs text-text-muted">
                          {jobSelection.count > 0
                            ? `${jobSelection.count} of ${filteredJobs.length} selected`
                            : `${filteredJobs.length} job${filteredJobs.length === 1 ? "" : "s"} in this folder`}
                        </span>
                        {jobSelection.count > 0 && (
                          <button
                            type="button"
                            onClick={jobSelection.clear}
                            className="text-xs font-bold text-primary hover:underline cursor-pointer"
                          >
                            Clear selection
                          </button>
                        )}
                      </div>
                    )}

                    <Pagination {...pagination} itemLabel="jobs" scrollTargetRef={tableRef} />
                  </>
                )}
              </div>
            </div>

            {/* ─── Add Jobs panel ─── */}
            {showAddPanel && selectedFolder && (
              <aside
                id="add-jobs-panel"
                aria-label={`Add ${typeLabel} jobs to ${selectedFolder.name}`}
                className="w-full lg:w-[22rem] shrink-0 bg-surface border border-border rounded-xl p-4 flex flex-col gap-3
                           lg:sticky lg:top-[88px] lg:max-h-[calc(100dvh-7rem)]"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-bold text-text min-w-0 truncate">
                    Available {typeLabel} Jobs
                  </h3>
                  <IconButton
                    label="Close Add Jobs panel"
                    size="sm"
                    icon={<X size={16} />}
                    onClick={() => setShowAddPanel(false)}
                  />
                </div>

                <SearchInput
                  value={availableSearch}
                  onChange={setAvailableSearch}
                  scope={`available ${typeLabel} jobs`}
                  resultCount={filteredAvailable.length}
                  totalCount={availableJobs.length}
                  placeholder="Search job no or tool…"
                  inputClassName="text-xs"
                />

                <div className="flex items-center justify-between gap-2 pb-2 border-b border-border">
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-text">
                    <SelectAllCheckbox
                      ids={filteredAvailableIds}
                      selection={availableSelection}
                      label={`Select all ${filteredAvailableIds.length} matching jobs`}
                    />
                    {availableSearch.trim() ? "Select all matches" : "Select All"}
                  </label>
                  <span className="text-[11px] text-text-muted tabular-nums">
                    {availableSelection.count > 0
                      ? `${availableSelection.count} selected`
                      : `${availableJobs.length} available`}
                  </span>
                </div>

                {availableSelection.count > 0 && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleAddSelected}
                      disabled={addingJobs}
                      className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-primary text-white text-xs font-bold hover:bg-primary-hover transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {addingJobs ? (
                        <>
                          <Loader2 size={13} className="animate-spin" /> Adding…
                        </>
                      ) : (
                        <>
                          <Plus size={13} /> Add {availableSelection.count} to{" "}
                          {selectedFolder.name}
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={availableSelection.clear}
                      title="Clear selection"
                      aria-label="Clear selection"
                      className="w-9 h-9 rounded-lg border border-border text-text-muted hover:text-text hover:bg-surface-hover transition-colors cursor-pointer shrink-0"
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}

                <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin space-y-1 lg:min-h-[12rem]">
                  {loadingAvailable ? (
                    <div className="flex justify-center py-8">
                      <Loader2 size={20} className="text-primary animate-spin" />
                    </div>
                  ) : filteredAvailable.length === 0 ? (
                    <EmptyState
                      size="sm"
                      icon={<Layers size={20} />}
                      title={
                        availableSearch.trim() ? "No matches" : "Nothing left to add"
                      }
                      description={
                        availableSearch.trim()
                          ? `No available job matches “${availableSearch.trim()}”.`
                          : `Every ${typeLabel.toLowerCase()} job is already in ${selectedFolder.name}.`
                      }
                      action={
                        availableSearch.trim() ? (
                          <button
                            type="button"
                            onClick={() => setAvailableSearch("")}
                            className="text-xs font-bold text-primary hover:underline cursor-pointer"
                          >
                            Clear search
                          </button>
                        ) : undefined
                      }
                    />
                  ) : (
                    visibleAvailable.map((j) => {
                      const checked = availableSelection.isSelected(j.id);
                      const busy = addingOneId === j.id;
                      return (
                        <div
                          key={j.id}
                          className={`flex items-center gap-2 px-2.5 py-2 rounded-lg transition-colors ${
                            checked ? "bg-primary/10" : "hover:bg-surface-hover"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => availableSelection.toggle(j.id)}
                            aria-label={`Select ${j.job_no || "job"} to add`}
                            className="w-4 h-4 rounded accent-primary cursor-pointer shrink-0"
                          />
                          <label className="text-xs text-text truncate flex-1 min-w-0 cursor-pointer">
                            {j.job_no || "—"}
                          </label>
                          <button
                            type="button"
                            onClick={() => handleAddOne(j)}
                            disabled={busy}
                            className="px-2 py-1 text-[10px] font-bold rounded bg-primary/10 text-primary hover:bg-primary hover:text-white transition-colors cursor-pointer shrink-0 disabled:opacity-50 flex items-center gap-1"
                          >
                            {busy ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />}
                            Add
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* How much of the list is on screen, and how to reach the rest. */}
                {remainingAvailable > 0 && (
                  <div className="flex items-center justify-between gap-2 shrink-0 pt-1">
                    <span className="text-[11px] text-text-muted tabular-nums">
                      Showing {visibleAvailable.length.toLocaleString()} of{" "}
                      {filteredAvailable.length.toLocaleString()}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setAvailableVisible((c) =>
                            Math.min(c + AVAILABLE_PAGE, filteredAvailable.length)
                          )
                        }
                        className="text-[11px] font-bold text-primary hover:underline cursor-pointer"
                      >
                        Show {Math.min(AVAILABLE_PAGE, remainingAvailable)} more
                      </button>
                      <span className="text-border">·</span>
                      <button
                        type="button"
                        onClick={() => setAvailableVisible(filteredAvailable.length)}
                        className="text-[11px] font-bold text-text-muted hover:text-text cursor-pointer"
                      >
                        Show all
                      </button>
                    </div>
                  </div>
                )}

                {availableSearch.trim() && availableStats.total > 0 && (
                  <p className="text-[11px] text-text-muted shrink-0">
                    Select all matches picks the {availableStats.total} job
                    {availableStats.total === 1 ? "" : "s"} currently shown, not all{" "}
                    {availableJobs.length}.
                  </p>
                )}
              </aside>
            )}
          </div>
        </>
      ))}

      {/* ─── Bulk action bar (viewport-anchored) ─── */}
      {canSelect && (
        <BulkActionBar
          count={jobSelection.count}
          itemLabel={typeLabel}
          context={selectedFolder?.name}
          onClear={jobSelection.clear}
        >
          {/* Linking is meaningful in the full list as well as inside a folder, which is
              why this bar is no longer gated on `inFolderView`. "Remove from folder"
              stays folder-only: removing a job from a folder only means anything when
              there is one. */}
          <button
            type="button"
            onClick={() => setLinkModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-connection-muted text-connection text-xs font-bold hover:bg-connection hover:text-white transition-colors cursor-pointer whitespace-nowrap"
          >
            <Link2 size={13} />
            Link to Bill
          </button>
          {inFolderView && (
            <>
              <button
                type="button"
                onClick={handleRemoveSelected}
                className="px-3.5 py-2 rounded-lg bg-warning/15 text-warning text-xs font-bold border border-warning/30 hover:bg-warning/25 transition-colors cursor-pointer whitespace-nowrap"
              >
                Remove from folder
              </button>
              <span className="text-[11px] text-text-muted hidden md:inline whitespace-nowrap">
                jobs are kept
              </span>
            </>
          )}
        </BulkActionBar>
      )}

      {/* ─── Modals ─── */}

      <LinkJobsToBillModal
        open={linkModalOpen}
        jobIds={[...jobSelection.selected]}
        jobTypeLabel={typeLabel}
        onClose={() => setLinkModalOpen(false)}
        onLinked={(result) => void handleLinked(result)}
      />

      <JobEditModal
        open={!!editingJob}
        onClose={() => setEditingJob(null)}
        job={editingJob}
        onSaved={() => {
          setEditingJob(null);
          // Silent reload: the table stays put, so the user keeps their page
          // and scroll position after saving a row near the bottom.
          loadJobs(true);
          if (showAddPanel) loadAvailableJobs(true);
        }}
      />

      <JobDrawingModal
        open={!!drawingModalJob}
        onClose={() => setDrawingModalJob(null)}
        job={drawingModalJob}
        onChanged={() => {
          loadJobs(true);
          if (showAddPanel) loadAvailableJobs(true);
        }}
      />

      <Modal
        open={creatingFolder}
        onClose={() => setCreatingFolder(false)}
        size="sm"
        title="New Folder"
        subtitle={`Group ${typeLabel.toLowerCase()} jobs together.`}
        footer={
          <>
            <button
              type="button"
              onClick={() => setCreatingFolder(false)}
              className="px-4 py-2.5 rounded-xl text-sm font-medium text-text-muted hover:text-text hover:bg-surface-hover transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCreateFolder}
              className="px-5 py-2.5 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-hover shadow-lg shadow-primary/20 transition-colors cursor-pointer"
            >
              Create folder
            </button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleCreateFolder();
          }}
        >
          <label
            htmlFor="new-folder-name"
            className="block text-xs font-semibold text-text-secondary mb-1.5"
          >
            Folder name <span className="text-danger">*</span>
          </label>
          <input
            id="new-folder-name"
            type="text"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder={`e.g. ${typeLabel} — March`}
            required
            className={inputCls}
          />
          <p className="text-xs text-text-muted mt-2">
            The folder opens empty. You can add jobs from it at any time.
          </p>
        </form>
      </Modal>

      <Modal
        open={!!renamingFolder}
        onClose={() => setRenamingFolder(null)}
        size="sm"
        title="Rename Folder"
        subtitle={renamingFolder ? `Currently “${renamingFolder.name}”` : undefined}
        footer={
          <>
            <button
              type="button"
              onClick={() => setRenamingFolder(null)}
              className="px-4 py-2.5 rounded-xl text-sm font-medium text-text-muted hover:text-text hover:bg-surface-hover transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleRenameFolder}
              className="px-5 py-2.5 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-hover shadow-lg shadow-primary/20 transition-colors cursor-pointer"
            >
              Save name
            </button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleRenameFolder();
          }}
        >
          <label
            htmlFor="rename-folder"
            className="block text-xs font-semibold text-text-secondary mb-1.5"
          >
            New name <span className="text-danger">*</span>
          </label>
          <input
            id="rename-folder"
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            required
            className={inputCls}
          />
          <p className="text-xs text-text-muted mt-2">
            Renaming does not affect the jobs inside.
          </p>
        </form>
      </Modal>

      <Modal
        open={!!deletingJob}
        onClose={() => setDeletingJob(null)}
        size="sm"
        tone="danger"
        title={`Delete job ${deletingJob?.job_no}?`}
        footer={
          <>
            <button
              type="button"
              onClick={() => setDeletingJob(null)}
              disabled={deletingJobBusy}
              className="px-4 py-2.5 rounded-xl text-sm font-medium text-text-muted hover:text-text hover:bg-surface-hover transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDeleteJob}
              disabled={deletingJobBusy}
              className="px-5 py-2.5 rounded-xl bg-danger text-white text-sm font-bold hover:brightness-110 shadow-lg shadow-danger/20 transition-all cursor-pointer disabled:opacity-60 flex items-center gap-2"
            >
              {deletingJobBusy && <Loader2 size={14} className="animate-spin" />}
              {deletingJobBusy ? "Deleting…" : "Delete job permanently"}
            </button>
          </>
        }
      >
        <div className="text-sm text-text-muted leading-relaxed">
          <p>
            This <strong className="text-danger">permanently deletes</strong> the job and removes
            it from every folder it belongs to.
          </p>
          <p className="mt-3 font-semibold text-text">This cannot be undone.</p>
          {inFolderView && (
            <p className="mt-3">
              If you only want it out of{" "}
              <strong className="text-text">{selectedFolder?.name}</strong>, close this and use
              Remove instead — the job is then kept.
            </p>
          )}
        </div>
      </Modal>

      {/* Screen-reader announcement when a silent background refresh fails, so a
          failure is never invisible. */}
      <div className="sr-only" role="status" aria-live="assertive">
        {refreshing && error ? error : ""}
      </div>
    </div>
  );
}
