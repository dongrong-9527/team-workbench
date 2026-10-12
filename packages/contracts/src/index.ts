export type Id = string;
export type Instant = string;
export type LocalDate = string;
export type Role = 'product' | 'frontend' | 'backend' | 'test';
export type Priority = 'high' | 'medium' | 'low';
export type Ref = { kind: 'requirement' | 'task' | 'bug'; id: Id };
export type JsonObject = Record<string, unknown>;
export interface Event { seq:number; time:Instant; action:string; actorId:Id; target:Ref|{kind:'member';id:Id}; before:JsonObject|null; after:JsonObject|null }
