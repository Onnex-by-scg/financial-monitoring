// Spacing between page requests within one pull (Settings → Data sync → "Wait between pages").
//
// With a wait set, page requests are queued: one at a time, and each starts the set number of seconds after the
// previous page finished (the first page of a pull goes out at once). This holds across lists read in parallel
// (e.g. PEAK's customers and invoices), so "5 seconds between pages" means exactly that.
// With no wait (0), pages run as before (in parallel where the loader allows it).

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface Pacer {
  /** Runs one page request, after the previous one has finished and the wait has passed. */
  run<T>(request: () => Promise<T>): Promise<T>;
}

export function makePacer(waitMs: number): Pacer {
  if (waitMs <= 0) return noPacer;
  let queue: Promise<unknown> | null = null;
  return {
    run<T>(request: () => Promise<T>): Promise<T> {
      const previous = queue;
      const next = (async () => {
        if (previous) {
          await previous.catch(() => undefined); // a failed page still counts as "finished"
          await sleep(waitMs);
        }
        return request();
      })();
      queue = next;
      return next;
    },
  };
}

export const noPacer: Pacer = { run: (request) => request() };
