import { describe, it, expect } from 'vitest';
import {
  AgentTracer,
  formatTraceparent,
  parseTraceparent,
  generateW3CTraceId,
  generateW3CSpanId,
} from '@/lib/observability/telemetry';

describe('W3C Trace Context & OpenTelemetry Alignment', () => {
  it('generates valid 32-hex traceId and 16-hex spanId', () => {
    const traceId = generateW3CTraceId();
    const spanId = generateW3CSpanId();

    expect(traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(spanId).toMatch(/^[0-9a-f]{16}$/);
  });

  it('formats and parses compliant W3C traceparent headers', () => {
    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
    const spanId = '00f067aa0ba902b7';

    const header = formatTraceparent(traceId, spanId, true);
    expect(header).toBe(`00-${traceId}-${spanId}-01`);

    const parsed = parseTraceparent(header);
    expect(parsed).not.toBeNull();
    expect(parsed?.traceId).toBe(traceId);
    expect(parsed?.spanId).toBe(spanId);
    expect(parsed?.sampled).toBe(true);

    const invalid = parseTraceparent('invalid-traceparent-header');
    expect(invalid).toBeNull();
  });

  it('serializes tracer execution spans into OpenTelemetry readable span format', () => {
    const tracer = new AgentTracer({
      tenantId: 'tenant-alula-dmc',
      senderPhone: '966500000001',
      triggerMessageId: 'msg-trace-001',
    });

    const spanId = tracer.startSpan('resolve_delay', 'reasoning');
    tracer.endSpan(spanId, { model: 'llama-3.3-70b-versatile', delayMinutes: 60 });

    const traceparent = tracer.toTraceparent();
    expect(traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);

    const otelSpans = tracer.toOtelSpans();
    expect(otelSpans.length).toBe(1);

    const span = otelSpans[0];
    expect(span.name).toBe('resolve_delay');
    expect(span.kind).toBe('INTERNAL');
    expect(span.context.traceFlags).toBe(1);
    expect(span.status.code).toBe('OK');
    expect(span.attributes['service.name']).toBe('agentic-travel-operations');
    expect(span.attributes['tenant.id']).toBe('tenant-alula-dmc');
    expect(span.attributes['whatsapp.sender.phone']).toBe('966500000001');
    expect(span.attributes['operation.phase']).toBe('reasoning');
    expect(span.attributes['delayMinutes']).toBe(60);
    expect(typeof span.startTimeUnixNano).toBe('string');
    expect(typeof span.endTimeUnixNano).toBe('string');
  });
});
