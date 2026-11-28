type Visibility = Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;

/** Poll only while the user can see the page, without overlapping requests. */
export function startVisiblePolling(
  visibility: Visibility,
  intervalMs: number,
  poll: (signal: AbortSignal) => Promise<void>
): () => void {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let refreshOnSettle = false;

  const clear = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const canPoll = () => !controller.signal.aborted && visibility.visibilityState === 'visible';
  const schedule = () => {
    if (canPoll() && !running) timer = setTimeout(run, intervalMs);
  };
  async function run() {
    clear();
    if (!canPoll() || running) return;
    running = true;
    try {
      await poll(controller.signal);
    } catch {
      // Keep the normal cadence after a transient failure.
    } finally {
      running = false;
      const refresh = refreshOnSettle;
      refreshOnSettle = false;
      if (refresh && canPoll()) void run();
      else schedule();
    }
  }
  const onVisibilityChange = () => {
    clear();
    if (!canPoll()) {
      refreshOnSettle = false;
      return;
    }
    if (running) refreshOnSettle = true;
    else void run();
  };

  visibility.addEventListener('visibilitychange', onVisibilityChange);
  schedule();
  return () => {
    clear();
    visibility.removeEventListener('visibilitychange', onVisibilityChange);
    controller.abort();
  };
}
