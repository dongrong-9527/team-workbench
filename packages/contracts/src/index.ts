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
