export function classifyPointerInput(event, mode) {
  if (
    (event.pointerType === "mouse" || event.pointerType === "pen") &&
    event.button !== 0
  )
    return null;
  if (mode === "auto") return event.pointerType === "pen" ? "paint" : "orbit";
  return mode === "paint" ? "paint" : "orbit";
}

export function normalizePressure(event, enabled = true) {
  const pressure = Number(event?.pressure);
  if (!enabled || !Number.isFinite(pressure) || pressure <= 0) return 0.65;
  return Math.min(1, Math.max(0.08, pressure));
}

export function coalescedPointerEvents(event) {
  const events =
    typeof event?.getCoalescedEvents === "function"
      ? event.getCoalescedEvents()
      : [];
  return events.length ? events : [event];
}
