import crypto from 'crypto';
import {
  AgentOperationType,
  AgentAuditEntry,
  AuditRecordResult,
  recordAgentOperation,
} from '@/lib/agent/audit-log';

export interface TraceContext {
  traceId: string;
  tenantId?: string;
  agentRunId: string;
  triggerMessageId?: string;
  senderPhone?: string;
  startTime: number;
}

export type SpanPhase =
  | 'transcription'
  | 'disambiguation'
  | 'reasoning'
  | 'validation'
  | 'mutation'
  | 'notification';

export interface AgentSpan {
  spanId: string;
  name: string;
  phase: SpanPhase;
  startTime: number;
  endTime?: number;
  latencyMs?: number;
  metadata?: Record<string, unknown>;
  error?: string;
}

export interface OtelReadableSpan {
  name: string;
  context: {
    traceId: string;
    spanId: string;
    traceFlags: number;
  };
  parentSpanId?: string;
  kind: 'INTERNAL' | 'SERVER' | 'CLIENT';
  startTimeUnixNano: string;
  endTimeUnixNano?: string;
  status: {
    code: 'OK' | 'ERROR';
    message?: string;
  };
  attributes: Record<string, unknown>;
}

export function generateW3CTraceId(): string {
  return crypto.randomBytes(16).toString('hex');
}

export function generateW3CSpanId(): string {
  return crypto.randomBytes(8).toString('hex');
}

export function formatTraceparent(traceId: string, spanId: string, sampled: boolean = true): string {
  const flags = sampled ? '01' : '00';
  const cleanTrace = traceId.replace(/-/g, '').padStart(32, '0').slice(-32);
  const cleanSpan = spanId.replace(/-/g, '').padStart(16, '0').slice(-16);
  return `00-${cleanTrace}-${cleanSpan}-${flags}`;
}

export function parseTraceparent(header: string): { traceId: string; spanId: string; sampled: boolean } | null {
  const match = header.match(/^00-([0-9a-fA-F]{32})-([0-9a-fA-F]{16})-([0-9a-fA-F]{2})$/);
  if (!match) return null;
  return {
    traceId: match[1].toLowerCase(),
    spanId: match[2].toLowerCase(),
    sampled: match[3] === '01',
  };
}

export class AgentTracer {
  private readonly context: TraceContext;
  private readonly spans: AgentSpan[] = [];
  private readonly rootSpanId: string;

  constructor(context?: Partial<TraceContext>) {
    this.rootSpanId = generateW3CSpanId();
    this.context = {
      traceId: context?.traceId || generateW3CTraceId(),
      agentRunId: context?.agentRunId || crypto.randomUUID(),
      tenantId: context?.tenantId,
      triggerMessageId: context?.triggerMessageId,
      senderPhone: context?.senderPhone,
      startTime: Date.now(),
    };
  }

  getContext(): TraceContext {
    return this.context;
  }

  getSpans(): AgentSpan[] {
    return this.spans;
  }

  toTraceparent(): string {
    return formatTraceparent(this.context.traceId, this.rootSpanId, true);
  }

  startSpan(name: string, phase: SpanPhase): string {
    const spanId = generateW3CSpanId();
    this.spans.push({
      spanId,
      name,
      phase,
      startTime: Date.now(),
    });
    return spanId;
  }

  endSpan(spanId: string, metadata?: Record<string, unknown>, error?: Error | string): void {
    const span = this.spans.find((s) => s.spanId === spanId);
    if (!span) {
      return;
    }
    span.endTime = Date.now();
    span.latencyMs = span.endTime - span.startTime;
    if (metadata) {
      span.metadata = { ...span.metadata, ...metadata };
    }
    if (error) {
      span.error = error instanceof Error ? error.message : String(error);
    }
  }

  getTotalDurationMs(): number {
    return Date.now() - this.context.startTime;
  }

  toOtelSpans(): OtelReadableSpan[] {
    const cleanTrace = this.context.traceId.replace(/-/g, '').padStart(32, '0').slice(-32);

    return this.spans.map((span) => {
      const cleanSpan = span.spanId.replace(/-/g, '').padStart(16, '0').slice(-16);
      const startNano = BigInt(span.startTime) * BigInt(1_000_000);
      const endNano = span.endTime ? (BigInt(span.endTime) * BigInt(1_000_000)).toString() : undefined;

      return {
        name: span.name,
        context: {
          traceId: cleanTrace,
          spanId: cleanSpan,
          traceFlags: 1,
        },
        parentSpanId: this.rootSpanId,
        kind: 'INTERNAL',
        startTimeUnixNano: startNano.toString(),
        endTimeUnixNano: endNano,
        status: {
          code: span.error ? 'ERROR' : 'OK',
          message: span.error,
        },
        attributes: {
          'service.name': 'agentic-travel-operations',
          'operation.phase': span.phase,
          'tenant.id': this.context.tenantId,
          'whatsapp.sender.phone': this.context.senderPhone,
          'whatsapp.message.id': this.context.triggerMessageId,
          ...(span.metadata || {}),
        },
      };
    });
  }

  async recordSummaryToAuditLog(params: {
    operationType: AgentOperationType;
    itineraryId?: string;
    eventId?: string;
    llmModel?: string;
    rationale?: string;
    validationStatus: 'passed' | 'rejected' | 'skipped';
    violations?: string[];
    extraMetadata?: Record<string, unknown>;
  }): Promise<AuditRecordResult> {
    return recordAgentOperation({
      operationId: this.context.agentRunId,
      operationType: params.operationType,
      tenantId: this.context.tenantId,
      itineraryId: params.itineraryId,
      eventId: params.eventId,
      triggerMessageId: this.context.triggerMessageId,
      senderPhone: this.context.senderPhone,
      llmModel: params.llmModel,
      latencyMs: this.getTotalDurationMs(),
      rationale: params.rationale,
      validationStatus: params.validationStatus,
      violations: params.violations,
      metadata: {
        traceId: this.context.traceId,
        traceparent: this.toTraceparent(),
        spans: this.spans.map((s) => ({
          name: s.name,
          phase: s.phase,
          latencyMs: s.latencyMs,
          error: s.error,
          metadata: s.metadata,
        })),
        otelSpans: this.toOtelSpans(),
        ...params.extraMetadata,
      },
    });
  }
}
