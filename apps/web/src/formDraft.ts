export interface DraftContext {
  actor: string;
  draftKey: string;
  path: string;
  method: string;
  projectId?: string;
}
const record = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === "object" && !Array.isArray(value);

// Legacy drafts keep their original account-scoped key. New envelopes also
// bind every field that can change the target or meaning of a command.
export function compatibleDraft(
  saved: unknown,
  context: DraftContext,
): boolean {
  if (!record(saved) || (saved.values !== undefined && !record(saved.values)))
    return false;
  if (
    saved.version !== undefined &&
    (!Number.isSafeInteger(saved.version) || saved.version < 1)
  )
    return false;
  if (
    saved.context !== undefined &&
    (!record(saved.context) ||
      (["actor", "draftKey", "path", "method", "projectId"] as const).some(
        (key) => saved.context[key] !== context[key],
      ))
  )
    return false;
  if (saved.fingerprint || saved.key) {
    if (
      typeof saved.fingerprint !== "string" ||
      typeof saved.key !== "string" ||
      !saved.key
    )
      return false;
    try {
      const command = JSON.parse(saved.fingerprint);
      if (
        !Array.isArray(command) ||
        command.length !== 3 ||
        command[0] !== context.path ||
        command[1] !== context.method ||
        !record(command[2])
      )
        return false;
      if (
        command[2].projectId !== undefined &&
        command[2].projectId !== context.projectId
      )
        return false;
      if (
        ["/api/requirements", "/api/tasks", "/api/bugs"].includes(
          context.path,
        ) &&
        command[2].projectId !== context.projectId
      )
        return false;
    } catch {
      return false;
    }
  }
  return true;
}
