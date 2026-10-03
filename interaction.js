export function classifyPointerInput(event, mode) {
  if ((event.pointerType === 'mouse' || event.pointerType === 'pen') && event.button !== 0) return null;
  if (mode === 'auto') return event.pointerType === 'pen' ? 'paint' : 'orbit';
  return mode === 'paint' ? 'paint' : 'orbit';
}
