export type Id = string;
export type Instant = string;
export type LocalDate = string;
export type Role = "product" | "frontend" | "backend" | "test";
export type Priority = "high" | "medium" | "low";
export type Ref = { kind: "requirement" | "task" | "bug"; id: Id };
export type JsonObject = Record<string, unknown>;
export interface Event {
  seq: number;
  time: Instant;
  action: string;
  actorId: Id;
  target: Ref | ProjectRef | { kind: "member"; id: Id };
  before: JsonObject | null;
  after: JsonObject | null;
}
export type ProjectRef = { kind: "project"; id: Id };
export type Action =
  | "attach"
  | "read"
  | "manageMembers"
  | "manageProject"
  | "refine"
  | "assign"
  | "claim"
  | "execute"
  | "test"
  | "accept"
  | "writeUpdate"
  | "manageReport";
// Scoped writes require an explicit role for Bugs and tasks of kind "other".
// For frontend/backend/test tasks, kind is the authoritative functional scope.
export interface AuthorizationFields {
  role?: Role;
  kind?: "frontend" | "backend" | "test" | "other";
  ownerId?: Id;
  acceptorId?: Id;
  authorId?: Id;
  participantIds?: Id[];
  creatorId?: Id;
}

export type RequirementState =
  | "draft"
  | "refining"
  | "ready"
  | "active"
  | "pending_acceptance"
  | "accepted"
  | "cancelled";
export interface RequirementSource {
  description?: string;
  url?: string;
  status?: "checked" | "unable";
  checkedAt?: Instant;
  reason?: string;
}
export interface Criterion {
  exclusionReason?: string;
  id: Id;
  text: string;
  required: boolean;
}
export interface Requirement {
  acceptanceTargetVersion?: string;
  id: Id;
  projectId: Id;
  title: string;
  source: RequirementSource;
  description: string;
  acceptorId: Id;
  criteria: Criterion[];
  priority: Priority;
  state: RequirementState;
  revision: number;
  version: number;
  blocked: boolean;
  evidenceReady: boolean;
  scopeConfirmed: boolean;
  affectedCheckIds?: Id[];
  affectedTaskIds?: Id[];
  role?: Role;
}
export type RequirementCommand = {
  action:
    | "suggestChange"
    | "refine"
    | "makeReady"
    | "start"
    | "revise"
    | "cancel"
    | "restore";
  [key: string]: unknown;
};

export interface Task {
  id: Id;
  projectId: Id;
  requirementId?: Id | null;
  title: string;
  kind: "frontend" | "backend" | "test" | "other";
  role?: Role;
  ownerId?: Id | null;
  reviewerId?: Id | null;
  definitionOfDone: string;
  required: boolean;
  exclusionReason?: string;
  state: "pending" | "active" | "pending_check" | "done" | "cancelled";
  priority: Priority;
  blocked: boolean;
  version: number;
  dependencyIds: Id[];
  [key: string]: unknown;
}
export type TaskCommand = {
  action:
    | "claim"
    | "assign"
    | "start"
    | "submit"
    | "checkPass"
    | "checkFail"
    | "transfer"
    | "requestTransfer"
    | "reopen"
    | "cancel"
    | "block"
    | "unblock"
    | "setDependencies"
    | "approveParallel"
    | "defineChecks"
    | "designateReviewer"
    | "setRequired"
    | "refine";
  [key: string]: unknown;
};

export interface TestCheck {
  checkId: Id;
  result: "pass" | "fail" | "untested";
  note?: string;
}
export interface TestInput {
  target: Ref;
  revision?: number;
  targetVersion: string;
  environment: string;
  checks: TestCheck[];
  reusedFromId?: Id;
  reuseReason?: string;
  bugId?: Id;
}
export interface TestRecord extends TestInput {
  id: Id;
  projectId: Id;
  requirementId?: Id;
  testerId: Id;
  recordedAt: Instant;
  recordedSeq: number;
  selfTest: boolean;
  targetObjectVersion: number;
  snapshot: JsonObject;
}
export interface CheckDefinition {
  id: Id;
  text: string;
  required: boolean;
  exclusionReason?: string;
}
export interface Bug {
  id: Id;
  projectId: Id;
  title: string;
  requirementId?: Id;
  taskId?: Id;
  reporterId: Id;
  ownerId?: Id | null;
  role: "frontend" | "backend" | "test";
  expected: string;
  actual: string;
  reproduction: string;
  environment: string;
  severity: "blocker" | "critical" | "normal" | "minor";
  priority: Priority;
  state:
    | "unconfirmed"
    | "ready"
    | "fixing"
    | "pending_verify"
    | "closed"
    | "rejected";
  blocked: boolean;
  version: number;
  reopenCount: number;
  checks?: CheckDefinition[];
  submission?: {
    fix: string;
    impact: string;
    selfCheck: string;
    environment: string;
    targetVersion: string;
  };
  [key: string]: unknown;
}
export type BugCommand = {
  action:
    | "confirm"
    | "reject"
    | "claim"
    | "start"
    | "submit"
    | "verifyPass"
    | "verifyFail"
    | "reopen"
    | "assign"
    | "transfer"
    | "block"
    | "unblock"
    | "refine"
    | "defineChecks";
  [key: string]: unknown;
};

export interface AcceptanceInput {
  decision: "pass" | "return";
  revision: number;
  targetVersion: string;
  criteria: { id: Id; passed: boolean; note?: string }[];
  reason?: string;
  reworkTaskIds?: Id[];
  bugIds?: Id[];
}
export interface AcceptanceRecord extends AcceptanceInput {
  id: Id;
  requirementId: Id;
  projectId: Id;
  acceptorId: Id;
  recordedAt: string;
  recordedSeq: number;
  snapshot: Record<string, unknown>;
}

export interface AcceptanceReadiness {
  requirement: Requirement;
  requirementId: Id;
  projectId: Id;
  requirementVersion: number;
  revision: number;
  state: RequirementState;
  targetVersion: string;
  archived: boolean;
  checkedAt: Instant;
  ok: boolean;
  reasons: string[];
  total: 5;
  satisfied: number;
  conditions: {
    id: "tasks" | "tests" | "bugs" | "unblocked" | "acceptor";
    passed: boolean;
    reasons: string[];
  }[];
  tasks: { required: number; completed: number };
  criteria: {
    passed: number;
    failed: number;
    untested: number;
    required: number;
  };
  bugs: {
    id: Id;
    title: string;
    severity: string;
    state: string;
    waived: boolean;
  }[];
  bugSummary: { open: number; criticalOpen: number; waived: number };
  acceptor: { id: Id; name: string };
}

export type ContributionType =
  | "development"
  | "repair"
  | "testing"
  | "coordination";
export interface UpdateInput {
  target: Ref;
  workDate: LocalDate;
  done: string;
  next?: string;
  obstacle?: string;
  contributionType: ContributionType;
  correctsId?: Id;
  reason?: string;
}
export interface ObjectSnapshot {
  id: Id;
  requirementId: Id | null;
  title: string;
  projectId: Id;
  projectName: string | null;
  ownerId: Id | null;
  ownerName: string | null;
  state: string;
  revision: number | null;
  blocked: boolean;
  version: number;
}
export interface WorkUpdate extends UpdateInput {
  id: Id;
  logicalId: Id;
  version: number;
  authorId: Id;
  authorName: string;
  recordedAt: Instant;
  recordedSeq: number;
  originalSeq: number;
  lateEntry: boolean;
  snapshot: ObjectSnapshot;
}
export interface HistoryEntry extends Event {
  actorName: string | null;
  localTime: string;
  reason: string | null;
}
export interface SeqPage<T> {
  items: T[];
  cutoffSeq: number;
  nextAfterSeq: number | null;
}

// JavaScript/HTML text lengths use UTF-16 code units. Reserve room for review notes.
export const REPORT_TEXT_LIMITS = {
  generated: 190_000,
  edited: 200_000,
} as const;

export interface ReportInput {
  date: LocalDate;
  timeZone: string;
  memberIds: Id[];
  projectIds: Id[];
  previousReportId?: Id;
}
export interface ReportSourceRef {
  kind: "update" | "state" | "event" | "member" | "project";
  id: Id;
  version: number;
  seq: number;
}
export type ReportSource =
  | (ReportSourceRef & { kind: "update"; update: WorkUpdate })
  | (ReportSourceRef & { kind: "state"; target: Ref; snapshot: ObjectSnapshot })
  | (ReportSourceRef & { kind: "event"; event: HistoryEntry; projectId: Id })
  | (ReportSourceRef & { kind: "member" | "project"; name: string | null });
export interface ReportSources {
  input: ReportInput;
  entries: ReportSource[];
  // Counts belong to selected transition operators, never inferred from owner or prose.
  counts: {
    tasksDone: number;
    bugsClosed: number;
    requirementsAccepted: number;
  };
  reopenedIds: Id[];
}
export interface ReportVersion {
  id: Id;
  seriesId: Id;
  version: number;
  creatorId: Id;
  input: ReportInput;
  generatedAt: Instant;
  createdAt: Instant;
  sourceCutoffSeq: number;
  stateCutoff: { time: Instant; seq: number };
  sources: ReportSourceRef[];
  text: string;
  edited: boolean;
  counts: ReportSources["counts"];
  reopenedIds: Id[];
}
export interface ReportSourceChanges {
  changed: boolean;
  message: string | null;
  checkedAt: Instant;
  sourceCutoffSeq: number;
  added: ReportSourceRef[];
  removed: ReportSourceRef[];
  updated: ReportSourceRef[];
}

// Workbench current-state reads use query-bound creation cursors. These are not
// immutable historical/report cutoffs; each returned business value is current.
export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}
export interface DirectoryMember {
  id: Id;
  displayName: string;
  active: boolean;
  isAdmin: boolean;
  version: number;
  roles?: { role: Role; lead: number }[];
}
export interface WorkspaceProject {
  id: Id;
  name: string;
  description: string;
  archived: number;
  version: number;
  myRoles: { role: Role; lead: number }[];
}
export type WorkbenchItem = (Requirement | Task | Bug) & {
  objectKind: Ref["kind"];
  projectName: string;
  archived: number;
  ownerName: string | null;
  ownerActive: number | null;
  responsibility:
    | "owner"
    | "reviewer"
    | "acceptor"
    | "participant"
    | "tester"
    | "claimable"
    | "observer";
  flags: {
    unassigned: boolean;
    inactiveOwner: boolean;
    pendingRevision: boolean;
    missingUpdate: boolean;
  };
};
