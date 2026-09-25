import { OtelReadableSpan } from './telemetry';

export interface OtelExporterConfig {
  endpoint?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxRetries?: number;
  retryBackoffBaseMs?: number;
  fetchFn?: typeof fetch;
}

export interface OtelExportResult {
  success: boolean;
  exportedCount: number;
  statusCode?: number;
  error?: string;
}

export interface BatchSpanProcessorConfig {
  exporter: OtelHttpSpanExporter;
  maxQueueSize?: number;
  maxBatchSize?: number;
  scheduledDelayMillis?: number;
  dropPolicy?: 'drop_oldest' | 'drop_newest';
}

export interface BatchProcessorStats {
  queueSize: number;
  totalEmitted: number;
  totalExported: number;
  totalDropped: number;
  totalFailed: number;
  isShutdown: boolean;
}

export class OtelHttpSpanExporter {
  private readonly endpoint?: string;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBackoffBaseMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config?: OtelExporterConfig) {
    this.endpoint = config?.endpoint || process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    this.headers = {
      'Content-Type': 'application/json',
      ...(config?.headers || {}),
    };
    this.timeoutMs = config?.timeoutMs ?? 5000;
    this.maxRetries = config?.maxRetries ?? 3;
    this.retryBackoffBaseMs = config?.retryBackoffBaseMs ?? 200;
    this.fetchImpl = config?.fetchFn || globalThis.fetch;
  }

  getEndpoint(): string | undefined {
    return this.endpoint;
  }

  buildOtlpPayload(spans: OtelReadableSpan[]): Record<string, unknown> {
    const formattedSpans = spans.map((span) => {
      const attributes = Object.entries(span.attributes).map(([key, value]) => {
        if (typeof value === 'number') {
          return { key, value: { intValue: Math.round(value) } };
        }
        if (typeof value === 'boolean') {
          return { key, value: { boolValue: value } };
        }
        return { key, value: { stringValue: String(value ?? '') } };
      });

      return {
        traceId: span.context.traceId,
        spanId: span.context.spanId,
        parentSpanId: span.parentSpanId,
        name: span.name,
        kind: span.kind === 'SERVER' ? 2 : span.kind === 'CLIENT' ? 3 : 1,
        startTimeUnixNano: span.startTimeUnixNano,
        endTimeUnixNano: span.endTimeUnixNano,
        attributes,
        status: {
          code: span.status.code === 'OK' ? 1 : 2,
          message: span.status.message,
        },
      };
    });

    return {
      resourceSpans: [
        {
          resource: {
            attributes: [
              {
                key: 'service.name',
                value: { stringValue: 'agentic-travel-operations' },
              },
              {
                key: 'deployment.environment',
                value: { stringValue: process.env.NODE_ENV || 'production' },
              },
            ],
          },
          scopeSpans: [
            {
              scope: {
                name: 'there-dmc-tracer',
                version: '1.0.0',
              },
              spans: formattedSpans,
            },
          ],
        },
      ],
    };
  }

  async export(spans: OtelReadableSpan[]): Promise<OtelExportResult> {
    if (!this.endpoint) {
      return {
        success: false,
        exportedCount: 0,
        error: 'OTEL_EXPORTER_OTLP_ENDPOINT not configured',
      };
    }

    if (spans.length === 0) {
      return {
        success: true,
        exportedCount: 0,
      };
    }

    const payload = this.buildOtlpPayload(spans);
    let lastError: string | undefined;
    let lastStatusCode: number | undefined;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await this.fetchImpl(this.endpoint, {
          method: 'POST',
          headers: this.headers,
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        clearTimeout(timer);
        lastStatusCode = response.status;

        if (response.ok) {
          return {
            success: true,
            exportedCount: spans.length,
            statusCode: response.status,
          };
        }

        const isRetryable = response.status === 429 || response.status >= 500;
        lastError = `OTLP collector returned HTTP ${response.status}`;

        if (!isRetryable || attempt === this.maxRetries) {
          break;
        }

        const backoffMs = this.retryBackoffBaseMs * Math.pow(2, attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      } catch (err) {
        clearTimeout(timer);
        const errMsg = err instanceof Error ? err.message : String(err);
        lastError = `OTLP collector network error: ${errMsg}`;

        if (attempt === this.maxRetries) {
          break;
        }

        const backoffMs = this.retryBackoffBaseMs * Math.pow(2, attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }

    return {
      success: false,
      exportedCount: 0,
      statusCode: lastStatusCode,
      error: lastError,
    };
  }
}

export class BatchSpanProcessor {
  private readonly exporter: OtelHttpSpanExporter;
  private readonly maxQueueSize: number;
  private readonly maxBatchSize: number;
  private readonly scheduledDelayMillis: number;
  private readonly dropPolicy: 'drop_oldest' | 'drop_newest';

  private queue: OtelReadableSpan[] = [];
  private totalEmitted = 0;
  private totalExported = 0;
  private totalDropped = 0;
  private totalFailed = 0;
  private isShutdown = false;
  private timer?: NodeJS.Timeout;

  constructor(config: BatchSpanProcessorConfig) {
    this.exporter = config.exporter;
    this.maxQueueSize = config.maxQueueSize ?? 2048;
    this.maxBatchSize = config.maxBatchSize ?? 64;
    this.scheduledDelayMillis = config.scheduledDelayMillis ?? 5000;
    this.dropPolicy = config.dropPolicy ?? 'drop_oldest';

    this.startPeriodicExport();
  }

  private startPeriodicExport(): void {
    if (this.scheduledDelayMillis > 0 && typeof setInterval !== 'undefined') {
      this.timer = setInterval(() => {
        void this.flushBatch();
      }, this.scheduledDelayMillis);
      if (this.timer && typeof this.timer.unref === 'function') {
        this.timer.unref();
      }
    }
  }

  onEmit(span: OtelReadableSpan): void {
    if (this.isShutdown) {
      this.totalDropped += 1;
      return;
    }

    this.totalEmitted += 1;

    if (this.queue.length >= this.maxQueueSize) {
      this.totalDropped += 1;
      if (this.dropPolicy === 'drop_oldest') {
        this.queue.shift();
        this.queue.push(span);
      }
      return;
    }

    this.queue.push(span);

    if (this.queue.length >= this.maxBatchSize) {
      void this.flushBatch();
    }
  }

  async flushBatch(): Promise<OtelExportResult> {
    if (this.queue.length === 0) {
      return { success: true, exportedCount: 0 };
    }

    const batch = this.queue.splice(0, this.maxBatchSize);
    const result = await this.exporter.export(batch);

    if (result.success) {
      this.totalExported += result.exportedCount;
    } else {
      this.totalFailed += batch.length;
    }

    return result;
  }

  async forceFlush(): Promise<void> {
    while (this.queue.length > 0) {
      await this.flushBatch();
    }
  }

  async shutdown(): Promise<void> {
    if (this.isShutdown) {
      return;
    }
    this.isShutdown = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    await this.forceFlush();
  }

  getStats(): BatchProcessorStats {
    return {
      queueSize: this.queue.length,
      totalEmitted: this.totalEmitted,
      totalExported: this.totalExported,
      totalDropped: this.totalDropped,
      totalFailed: this.totalFailed,
      isShutdown: this.isShutdown,
    };
  }
}
