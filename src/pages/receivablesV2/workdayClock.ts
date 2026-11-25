/** Align updates with wall-clock minutes; refresh immediately after tab suspension. */
export function startWorkdayClock(onTick: (now: Date) => void): () => void {
  let timer: number;
  const refresh = () => {
    window.clearTimeout(timer);
    const now = new Date();
    onTick(now);
    timer = window.setTimeout(refresh, 60_000 - now.getTime() % 60_000);
  };
  refresh();
  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", refresh);
  return () => {
    window.clearTimeout(timer);
    window.removeEventListener("focus", refresh);
    document.removeEventListener("visibilitychange", refresh);
  };
}
