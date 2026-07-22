/**
 * Deduplicated Event Tracking Engine
 */
export const displayedEventKeys = new Set();

export function createEventKey(txHash, eventType, engagementId) {
  return `${txHash}:${eventType}:${engagementId ?? ""}`;
}

export function isEventDisplayed(txHash, eventType, engagementId) {
  const key = createEventKey(txHash, eventType, engagementId);
  return displayedEventKeys.has(key);
}

export function markEventDisplayed(txHash, eventType, engagementId) {
  const key = createEventKey(txHash, eventType, engagementId);
  displayedEventKeys.add(key);
}

export function resetEvents() {
  displayedEventKeys.clear();
}
