import type { AuditLogPort } from '@/lib/ports/audit-log.port';
import type { AgentTracer } from '@/lib/observability/telemetry';

export interface SemanticAuthParams {
  senderPhone?: string;
  targetEvent: { id: string; experience_provider_id?: string | null; itinerary_id: string };
  providers: Array<{ id: string; phone_number?: string | null }>;
  tenantId: string;
  triggerMessageId?: string;
  auditLog?: AuditLogPort;
  tracer: AgentTracer;
}

export interface SemanticAuthResult {
  authorized: boolean;
  violation?: string;
}

export class SemanticAuthorizationGuard {
  async authorize(params: SemanticAuthParams): Promise<SemanticAuthResult> {
    const { senderPhone, targetEvent, providers, tenantId, triggerMessageId, auditLog, tracer } = params;

    if (!senderPhone) {
      return { authorized: true };
    }

    const normalizedSender = senderPhone.replace(/\D/g, '');
    const senderProvider = providers.find(
      (p) => (p.phone_number || '').replace(/\D/g, '') === normalizedSender
    );

    const isAuthorized = Boolean(
      senderProvider && senderProvider.id === targetEvent.experience_provider_id
    );

    if (isAuthorized) {
      return { authorized: true };
    }

    const violation = `Semantic Authorization Block: Sender ${senderPhone} is not authorized for target event ${targetEvent.id}.`;

    if (auditLog) {
      await auditLog.record({
        operationId: tracer.getContext().agentRunId,
        operationType: 'action_boundary_block',
        tenantId,
        itineraryId: targetEvent.itinerary_id,
        eventId: targetEvent.id,
        triggerMessageId,
        senderPhone,
        latencyMs: tracer.getTotalDurationMs(),
        rationale: `Unauthorized access attempt from sender phone ${senderPhone}`,
        validationStatus: 'rejected',
        violations: [violation],
        metadata: {
          traceId: tracer.getContext().traceId,
          traceparent: tracer.toTraceparent(),
          spans: tracer.getSpans(),
        },
      });
    }

    return {
      authorized: false,
      violation,
    };
  }
}
