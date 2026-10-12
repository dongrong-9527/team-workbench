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
