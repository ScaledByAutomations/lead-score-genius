import { getEnv } from "../env";

type LookupMeta = {
  query?: string;
  leadId?: string;
  cacheKey?: string;
  providedUrl?: string;
};

type QueueTask = {
  executor: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  meta?: LookupMeta;
};

type ThrottleSignal = {
  reason: string;
  status?: number;
  url?: string;
  error?: string;
};

type LimiterConfig = {
  maxConcurrency: number;
  minDelayMs: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
  backoffResetMs: number;
};

class MapsLookupLimiter {
  private readonly queue: QueueTask[] = [];
  private active = 0;
  private lastStart = 0;
  private throttleLevel = 0;
  private throttleUntil = 0;
  private lastThrottleAt = 0;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingTimerAt = 0;
  private readonly maxThrottleLevel: number;

  constructor(private readonly config: LimiterConfig) {
    const { baseBackoffMs, maxBackoffMs } = config;
    const safeBase = Math.max(baseBackoffMs, 1);
    const ratio = Math.max(maxBackoffMs / safeBase, 1);
    this.maxThrottleLevel = Math.max(1, Math.ceil(Math.log2(ratio)) + 1);
  }

  schedule<T>(executor: () => Promise<T>, meta?: LookupMeta): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        executor,
        resolve: resolve as (value: unknown) => void,
        reject: reject as (reason: unknown) => void,
        meta
      });
      this.processQueue();
    });
  }

  registerThrottle(signal: ThrottleSignal): void {
    const now = Date.now();
    this.lastThrottleAt = now;
    if (this.throttleLevel < this.maxThrottleLevel) {
      this.throttleLevel += 1;
    }

    const delay = Math.min(
      this.config.maxBackoffMs,
      this.config.baseBackoffMs * Math.pow(2, Math.max(this.throttleLevel - 1, 0))
    );
    this.throttleUntil = Math.max(this.throttleUntil, now + delay);

    console.warn("maps lookup throttled", {
      delay_ms: delay,
      level: this.throttleLevel,
      reason: signal.reason,
      status: signal.status,
      url: signal.url,
      error: signal.error
    });

    this.scheduleTimer(this.throttleUntil - now);
  }

  registerSuccess(): void {
    if (this.throttleLevel > 0) {
      this.throttleLevel = Math.max(this.throttleLevel - 1, 0);
      if (this.throttleLevel === 0) {
        this.throttleUntil = 0;
      }
    }
    this.processQueue();
  }

  private processQueue(): void {
    if (this.active >= this.config.maxConcurrency) {
      return;
    }

    const now = Date.now();
    this.maybeResetThrottle(now);

    const earliestStart = Math.max(this.lastStart + this.config.minDelayMs, this.throttleUntil);
    if (now < earliestStart) {
      this.scheduleTimer(earliestStart - now);
      return;
    }

    const task = this.queue.shift();
    if (!task) {
      return;
    }

    this.clearTimer();
    this.active += 1;
    this.lastStart = Date.now();

    Promise.resolve()
      .then(() => task.executor())
      .then((value) => {
        task.resolve(value);
      })
      .catch((error) => {
        task.reject(error);
      })
      .finally(() => {
        this.active = Math.max(this.active - 1, 0);
        this.processQueue();
      });

    if (this.active < this.config.maxConcurrency && this.queue.length > 0) {
      this.processQueue();
    }
  }

  private maybeResetThrottle(now: number): void {
    if (this.throttleLevel === 0) {
      return;
    }
    if (now - this.lastThrottleAt >= this.config.backoffResetMs) {
      this.throttleLevel = 0;
      this.throttleUntil = 0;
    }
  }

  private scheduleTimer(delayMs: number): void {
    const boundedDelay = Math.max(delayMs, 10);
    const targetAt = Date.now() + boundedDelay;
    if (this.pendingTimer && targetAt >= this.pendingTimerAt) {
      return;
    }
    this.clearTimer();
    this.pendingTimerAt = targetAt;
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null;
      this.pendingTimerAt = 0;
      this.processQueue();
    }, boundedDelay);
  }

  private clearTimer(): void {
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
      this.pendingTimerAt = 0;
    }
  }
}

const env = getEnv();

const limiter = new MapsLookupLimiter({
  maxConcurrency: Math.max(1, env.MAPS_LOOKUP_MAX_CONCURRENCY || 1),
  minDelayMs: Math.max(0, env.MAPS_LOOKUP_MIN_DELAY_MS || 0),
  baseBackoffMs: Math.max(1, env.MAPS_LOOKUP_BASE_BACKOFF_MS || 1),
  maxBackoffMs: Math.max(1, env.MAPS_LOOKUP_MAX_BACKOFF_MS || 1),
  backoffResetMs: Math.max(env.MAPS_LOOKUP_BACKOFF_RESET_MS || 0, env.MAPS_LOOKUP_MIN_DELAY_MS || 0)
});

export function scheduleMapsLookup<T>(executor: () => Promise<T>, meta?: LookupMeta): Promise<T> {
  return limiter.schedule(executor, meta);
}

export function registerThrottleSignal(signal: ThrottleSignal): void {
  limiter.registerThrottle(signal);
}

export function registerLookupSuccess(): void {
  limiter.registerSuccess();
}
