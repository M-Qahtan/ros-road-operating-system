export type BackgroundWorker = (signal: AbortSignal) => Promise<void>;

/**
 * Owns the shared cancellation signal and the lifetime of required background
 * workers so runtime resources cannot be closed while a worker is still using
 * them.
 */
export class BackgroundWorkerSupervisor {
  private readonly controller = new AbortController();
  private workerTask: Promise<void> | null = null;
  private workerFailed = false;

  get failed(): boolean { return this.workerFailed; }

  start(workers: readonly BackgroundWorker[], onFailure: (error: unknown) => void): void {
    if (this.workerTask !== null) throw new Error('Background workers have already started');
    if (workers.length === 0) return;

    const task = Promise.all(workers.map((worker) => worker(this.controller.signal))).then(() => undefined);
    this.workerTask = task;
    void task.catch((error: unknown) => {
      this.workerFailed = true;
      onFailure(error);
    });
  }

  async stop(reason: string): Promise<void> {
    this.controller.abort(reason);
    const task = this.workerTask;
    if (task === null) return;
    try {
      await task;
    } catch {
      // The failure callback owns reporting and process status. Shutdown still
      // waits for the rejected task to settle before closing shared resources.
    }
  }
}
