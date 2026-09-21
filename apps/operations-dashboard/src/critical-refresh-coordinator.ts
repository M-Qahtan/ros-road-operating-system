export class CriticalRefreshCoordinator {
  private refreshDeferred = false;

  constructor(
    private readonly isCriticalActionInFlight: () => boolean,
    private readonly refresh: () => Promise<void>
  ) {}

  request(): Promise<void> {
    if (this.isCriticalActionInFlight()) {
      this.refreshDeferred = true;
      return Promise.resolve();
    }
    return this.refresh();
  }

  async flushAfterCriticalAction(): Promise<void> {
    if (!this.refreshDeferred || this.isCriticalActionInFlight()) return;
    this.refreshDeferred = false;
    await this.request();
  }
}
