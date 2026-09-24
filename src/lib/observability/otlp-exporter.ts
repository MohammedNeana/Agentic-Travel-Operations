import { OtelReadableSpan } from './telemetry';

export interface OtelExporterConfig {
  endpoint?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export interface OtelExportResult {
  success: boolean;
  exportedCount: number;
  statusCode?: number;
  error?: string;
}

export class OtelHttpSpanExporter {
  private readonly endpoint?: string;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config?: OtelExporterConfig) {
    this.endpoint = config?.endpoint || process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    this.headers = {
      'Content-Type': 'application/json',
      ...(config?.headers || {}),
    };
    this.timeoutMs = config?.timeoutMs ?? 5000;
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

      if (response.ok) {
        return {
          success: true,
          exportedCount: spans.length,
          statusCode: response.status,
        };
      }

      return {
        success: false,
        exportedCount: 0,
        statusCode: response.status,
        error: `OTLP collector returned HTTP ${response.status}`,
      };
    } catch (err) {
      clearTimeout(timer);
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        exportedCount: 0,
        error: `OTLP collector network error: ${errMsg}`,
      };
    }
  }
}
