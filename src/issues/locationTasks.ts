// Distinguish a live GPS request from a pending flag left by an interrupted app.
const active = new Set<string>();
const key = (ownerId: string, issueId: string) => `${ownerId}/${issueId}`;
export const locationIsActive = (ownerId: string, issueId: string) =>
  active.has(key(ownerId, issueId));
export function startLocationTask(ownerId: string, issueId: string) {
  active.add(key(ownerId, issueId));
}
export function finishLocationTask(ownerId: string, issueId: string) {
  active.delete(key(ownerId, issueId));
}
