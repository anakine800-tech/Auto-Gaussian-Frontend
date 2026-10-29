export type Document<T = unknown> = { data: T | null; error: string | null };
export type AttemptSummary = {
  id: string;
  label: string | null;
  template: string | null;
  state: string;
  manifest: Document;
  status: Document;
  facts: Document;
  review_state: "missing" | "empty" | "present" | "unreadable";
};
export type Graph = {
  nodes: { id: string; state: string; missing: boolean }[];
  edges: { parent: string; child: string; relation: string }[];
};
export type StructureFile = { parts: string[]; error: string | null };
export type StudySection = {
  present: boolean;
  text: string;
  entries: {
    text: string;
    line: number;
    label?: string;
    state?:
      | "pending"
      | "recorded"
      | "not_applicable"
      | "unknown"
      | "not_started";
  }[];
};
export type CatalogReview = {
  available: boolean;
  attempts: string[];
  warning: string | null;
};
export type Study = {
  catalog_review?: CatalogReview;
  id: string;
  study: Document<string>;
  sections: Record<string, StudySection>;
  attempts: AttemptSummary[];
  graph: Graph;
  structure_files: StructureFile[];
  analyses: (Document & {
    name: string;
    schema: string | null;
    updated_at: string | null;
  })[];
  issues: { path: string; error: string }[];
};
export type CrestSource = {
  index: number;
  error: string | null;
  file?: string;
  sha256?: string;
  line_start?: number;
  line_end?: number;
  findings: { level: string; message: string }[];
};
export type CrestDiagnostics =
  | { available: false; error: string }
  | {
      available: true;
      token: string;
      status: "identified" | "unresolved" | "none" | "unavailable";
      summary: string;
      sources: CrestSource[];
      files: {
        error: string | null;
        file?: string;
        sha256?: string;
        size?: number;
      }[];
      missing_sources: string[];
      scan_truncated: boolean;
      summary_truncated: boolean;
      parse_status: "complete" | "incomplete" | null;
      parse_error: string | null;
    };
export type CrestExcerpt = {
  status: string;
  text: string;
  name?: string;
  start?: number;
  total_lines?: number;
  shown_lines?: number;
  truncated?: boolean;
  sha256?: string;
  line_start?: number;
  line_end?: number;
};
export type Attempt = {
  id: string;
  manifest: Document;
  status: Document;
  facts: Document;
  review: Document<string>;
  geometry: Document;
  input_geometry: Document;
  input_files: { name: string; error: string | null }[];
  logs: string[];
  issues: { path: string; error: string }[];
  crest_diagnostics?: CrestDiagnostics | null;
};
export function endpoint(...parts: string[]) {
  return "/api/studies/" + parts.map(encodeURIComponent).join("/");
}
export async function get<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, cache: "no-store" });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw Error(body.detail ?? `读取失败 (${response.status})`);
  }
  return response.json();
}
export const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
export const display = (value: unknown) =>
  typeof value === "number" || typeof value === "string" ? String(value) : "—";

export function coreHours(m: Record<string, unknown>): string {
  if (
    typeof m.cores !== "number" ||
    !Number.isFinite(m.cores) ||
    m.cores <= 0 ||
    typeof m.walltime !== "string" ||
    !/^\d+:[0-5]\d:[0-5]\d$/.test(m.walltime)
  )
    return "—";
  const [h, min, sec] = m.walltime.split(":").map(Number);
  return `${Number((m.cores * (h + min / 60 + sec / 3600)).toFixed(3))} 核时（核数 × walltime）`;
}

export type MonitorRetry = {
  entry: string;
  result: "queued" | "already_queued" | "in_progress" | "refused";
  reason:
    | null
    | "monitor_not_running"
    | "auth_confirmation_required"
    | "unknown_entry";
  requested_at: string | null;
  request_id?: string | null;
};
export async function retryMonitor(
  cluster: string,
  auth_fixed: boolean,
  token: string,
): Promise<MonitorRetry> {
  const response = await fetch("/api/monitor/retry", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-AG-Token": token },
    body: JSON.stringify({ cluster, auth_fixed }),
  });
  const body = await response.json();
  if (!response.ok)
    throw Error(body.detail ?? `重试请求失败 (${response.status})`);
  const utc = (v: unknown) =>
    typeof v === "string" &&
    v.includes("T") &&
    /(Z|\+00:00)$/.test(v) &&
    Number.isFinite(Date.parse(v));
  if (
    !object(body) ||
    body.entry !== cluster ||
    !["queued", "already_queued", "in_progress", "refused"].includes(
      body.result as string,
    ) ||
    ![
      "monitor_not_running",
      "auth_confirmation_required",
      "unknown_entry",
      null,
    ].includes(body.reason as string | null) ||
    (body.result === "refused") !== (body.reason !== null) ||
    !(body.requested_at === null || utc(body.requested_at)) ||
    ("request_id" in body &&
      (body.result === "refused"
        ? body.request_id !== null
        : typeof body.request_id !== "string" ||
          !/^[0-9a-f]{32}$/.test(body.request_id) ||
          !utc(body.requested_at)))
  )
    throw Error("ag monitor 返回无效的重试 JSON；未自动重试");
  return body as MonitorRetry;
}

export type AutonomyCounts = {
  attempt: number;
  remedy: number;
  cancel: number;
  reroute: number;
};
export type AutonomyGaussianMethod = {
  method: string;
  basis: string;
  basis_function_type: string;
  dispersion: string;
  solvent_model: string;
  solvent: string;
  integration_grid: string;
  opt_convergence: "normal" | "tight" | "verytight";
  scf_convergence: number;
};
export type AutonomySubmissionPolicy = {
  templates: string[];
  clusters: Record<
    string,
    {
      nodes: string[];
      max_committed_cores: number;
      max_queued_cores: number;
      max_jobs: number;
    }
  >;
  max_cores_per_job: number;
  max_walltime: string;
  methods: Record<
    string,
    (AutonomyGaussianMethod | { parameters: Record<string, string> })[]
  >;
  routing_sha256: string;
  allow_relaxed: boolean;
};
export type AutonomyPlan = {
  id: string;
  sha256: string;
  created_at: number;
  versions: {
    ag_version: string;
    git_commit: string;
    dirty: boolean;
    rdkit: string;
    goodvibes: string;
  };
  spec: {
    goal: string;
    comparison_groups: string[];
    method_policy: string;
    mechanism_scope: string;
    system_rules: { main: string; small: string };
    estimated_hours: number;
    attempt_limit: number;
    valid_until: number;
    submission_policy?: AutonomySubmissionPolicy;
  };
  confirmation: { at: number; quote: string; sha256: string } | null;
};
export type AutonomySnapshot = {
  attempt: string;
  run_id: string;
  round_id: string;
  snapshot: string;
  captured_at: number;
  snapshot_sha256: string;
  log_sha256: string;
};
export type AutonomySubmission = {
  attempt_id: string;
  object_id: string;
  failure_class: string | null;
  ownership_sha256: string;
  round_id: string;
  run_id: string;
  plan_sha256: string;
  rule_sha256: string;
  max_attempts: number;
  plan_id: string;
  at: number;
  dispatch_started: { at: number } | null;
  aborted_before_dispatch: { at: number; reason: string } | null;
  boundary_failure?: { at: number; dispatched: boolean; reason: string };
};
export type AutonomyWaiting = {
  object_id: string;
  record_sha256: string;
  round_id: string;
  run_id: string;
  plan_sha256: string;
  plan_id: string;
  at: number;
};
export type AutonomyCancellation = {
  attempt_id: string;
  run_id: string;
  round_id: string;
  plan_sha256: string;
  ownership_sha256: string;
  kind: "no_progress" | "reroute";
  reason: string;
  evidence_sha256: string;
  lineage_sha256: string | null;
  at: number;
  seq: number;
  consumption_sha256: string;
};
export type AutonomyCancellationResult = {
  attempt_id: string;
  run_id: string;
  consumption_sha256: string;
  outcome: "accepted" | "unknown";
  reason: string;
  evidence_sha256: string;
  at: number;
  seq: number;
};
export type AutonomyRerouteLineage = {
  lineage_sha256: string;
  attempt_id: string;
};
export type AutonomyStatus = {
  status: "absent" | "ok" | "unsupported" | "invalid" | "missing";
  reason: string | null;
  phase: "running" | "paused" | "ended" | null;
  manual_actions_blocked: boolean;
  manual_block_reason: string | null;
  verification: "saved-files-only";
  integration: "pending-backend-action-boundary";
  checked_at: number;
  plans: AutonomyPlan[];
  current_plan: string | null;
  current_round: {
    id: string;
    started_at: number;
    ended_at: number | null;
    totals: AutonomyCounts;
    plan_ids: string[];
  } | null;
  current_run: {
    id: string;
    started_at: number;
    ended_at: number | null;
    outcome: string | null;
    observe_only?: boolean;
    totals: AutonomyCounts;
  } | null;
  lease: {
    run_id: string;
    round_id: string;
    started_at: number;
    run_until: number;
    expires_at: number;
    status: "active" | "expired";
    observe_only?: boolean;
  } | null;
  totals: AutonomyCounts | null;
  updated_at: number | null;
  summary: string | null;
  pending: string[];
  events: {
    seq: number;
    op: string;
    at: number;
    reason?: string;
    summary?: string;
    snapshot?: AutonomySnapshot;
    submission?: Pick<
      AutonomySubmission,
      | "attempt_id"
      | "object_id"
      | "failure_class"
      | "ownership_sha256"
      | "round_id"
      | "run_id"
      | "plan_sha256"
      | "rule_sha256"
      | "max_attempts"
    >;
    attempt_id?: string;
    run_id?: string;
    round_id?: string;
    object_id?: string;
    record_sha256?: string;
    dispatched?: boolean;
    cancellation?: Omit<
      AutonomyCancellation,
      "at" | "seq" | "consumption_sha256"
    >;
    cancellation_result?: Omit<AutonomyCancellationResult, "at" | "seq">;
  }[];
  events_truncated: boolean;
  snapshots?: (AutonomySnapshot & { seq: number })[];
  snapshots_truncated?: boolean;
  submissions?: AutonomySubmission[];
  submissions_count?: number;
  current_round_submission_count?: number | null;
  submissions_truncated?: boolean;
  submission_pause?: {
    at: number;
    attempt_id: string;
    round_id: string;
    reason: string;
  };
  waiting?: AutonomyWaiting[];
  waiting_count?: number;
  waiting_truncated?: boolean;
  cancellations?: AutonomyCancellation[];
  cancellations_count?: number;
  cancellations_truncated?: boolean;
  cancellation_results?: AutonomyCancellationResult[];
  cancellation_results_count?: number;
  cancellation_results_truncated?: boolean;
  reroute_lineages?: AutonomyRerouteLineage[];
  reroute_lineages_count?: number;
  reroute_lineages_truncated?: boolean;
  relaxed_inputs: {
    attempt: string;
    mode: "relaxed";
    skipped_checks: string[];
    method_verified: false;
  }[];
  relaxed_inputs_warning: string | null;
};
