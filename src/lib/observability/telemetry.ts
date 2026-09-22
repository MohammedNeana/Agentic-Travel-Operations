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

export class AgentTracer {
  private readonly context: TraceContext;
  private readonly spans: AgentSpan[] = [];

  constructor(context?: Partial<TraceContext>) {
    this.context = {
      traceId: context?.traceId || crypto.randomUUID(),
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

  startSpan(name: string, phase: SpanPhase): string {
    const spanId = crypto.randomUUID();
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
        spans: this.spans.map((s) => ({
          name: s.name,
          phase: s.phase,
          latencyMs: s.latencyMs,
          error: s.error,
          metadata: s.metadata,
        })),
        ...params.extraMetadata,
      },
    });
  }
}
