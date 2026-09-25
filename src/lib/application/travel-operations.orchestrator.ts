import {
  OrchestrationExecutionResult,
} from '@/lib/whatsapp/types';
import { validateOrchestrationDecision } from '@/lib/agent/action-validator';
import { AuditLogPort, AgentAuditEntry } from '@/lib/ports/audit-log.port';
import { AgentTracer } from '@/lib/observability/telemetry';
import { LLMProvider } from '@/lib/ports/llm.port';
import {
  ItineraryRepository,
  SupplierRepository,
  AtomicCascadeAdjustment,
  AtomicCascadeOutboxNotice,
} from '@/lib/ports/repository.port';
import { NotificationGateway } from '@/lib/ports/notification.port';
import { SemanticAuthorizationGuard } from './semantic-authorization.guard';
import { CascadeShiftPlanner } from './cascade-shift-planner';

export interface TravelOperationsOrchestratorDependencies {
  readonly llmProvider: LLMProvider;
  readonly itineraryRepo: ItineraryRepository;
  readonly supplierRepo: SupplierRepository;
  readonly notificationGateway: NotificationGateway;
  readonly auditLog?: AuditLogPort;
  readonly authGuard?: SemanticAuthorizationGuard;
  readonly shiftPlanner?: CascadeShiftPlanner;
}

export interface OrchestrationRequest {
  eventId: string;
  vendorMessage: string;
  senderPhone?: string;
  triggerMessageId?: string;
  tenantId?: string;
}

export class TravelOperationsOrchestrator {
  private readonly authGuard: SemanticAuthorizationGuard;
  private readonly shiftPlanner: CascadeShiftPlanner;

  constructor(private readonly deps: TravelOperationsOrchestratorDependencies) {
    this.authGuard = deps.authGuard || new SemanticAuthorizationGuard();
    this.shiftPlanner = deps.shiftPlanner || new CascadeShiftPlanner(deps.llmProvider);
  }

  async orchestrateCascade(options: OrchestrationRequest): Promise<OrchestrationExecutionResult> {
    const { eventId, vendorMessage } = options;

    const targetEvent = await this.deps.itineraryRepo.getTargetEvent(eventId, options.tenantId);

    if (!targetEvent) {
      return {
        success: false,
        updatedEventsCount: 0,
        dispatchedNoticesCount: 0,
        error: `Event ${eventId} not found in database.`,
      };
    }

    const tenantId = options.tenantId || targetEvent.tenant_id;

    const tracer = new AgentTracer({
      tenantId,
      triggerMessageId: options.triggerMessageId,
      senderPhone: options.senderPhone,
    });

    const providers = await this.deps.supplierRepo.getProviders(tenantId);

    const authResult = await this.authGuard.authorize({
      senderPhone: options.senderPhone,
      targetEvent,
      providers,
      tenantId,
      triggerMessageId: options.triggerMessageId,
      auditLog: this.deps.auditLog,
      tracer,
    });

    if (!authResult.authorized) {
      const authViolation = authResult.violation || 'Semantic Authorization Block';
      return {
        success: false,
        updatedEventsCount: 0,
        dispatchedNoticesCount: 0,
        error: authViolation,
        incidentSummary: authViolation,
        validationViolations: [authViolation],
      };
    }

    const allEvents = await this.deps.itineraryRepo.getDayEvents(
      targetEvent.itinerary_id,
      targetEvent.event_date,
      tenantId
    );

    if (!allEvents || allEvents.length === 0) {
      return {
        success: false,
        updatedEventsCount: 0,
        dispatchedNoticesCount: 0,
        error: 'Failed to fetch itinerary events.',
      };
    }

    const itineraryData = await this.deps.itineraryRepo.getItinerary(targetEvent.itinerary_id, tenantId);

    let travelerNationality = 'دولي';
    let groupSize = itineraryData?.guest_count || 2;

    if (itineraryData?.traveler_profile_id) {
      const profileData = await this.deps.itineraryRepo.getTravelerProfile(
        itineraryData.traveler_profile_id,
        tenantId
      );
      if (profileData) {
        travelerNationality = profileData.nationality || travelerNationality;
        groupSize = profileData.group_size || groupSize;
      }
    }

    const enrichedEvents = allEvents.map((ev, index) => {
      const prov = providers?.find((p) => p.id === ev.experience_provider_id);
      const isImmutable =
        Boolean(ev.is_immutable) ||
        new RegExp('flight|طيران|مطار|airport|border|منفذ|قطار|train', 'i').test(ev.title);
      return {
        order: index + 1,
        eventId: ev.id,
        title: ev.title,
        date: ev.event_date,
        startTime: (ev.start_time || '10:00').substring(0, 5),
        endTime: (ev.end_time || '13:00').substring(0, 5),
        status: ev.status,
        providerName: prov?.name || ev.title,
        providerPhone: prov?.phone_number || '',
        isTargetEvent: ev.id === targetEvent.id,
        isImmutable,
      };
    });

    const model = process.env.GROQ_LLM_MODEL || 'llama-3.3-70b-versatile';

    const reasoningSpan = tracer.startSpan('consult_llm_orchestrator', 'reasoning');
    const decision = await this.shiftPlanner.planCascade({
      targetEvent: {
        id: targetEvent.id,
        title: targetEvent.title,
        start_time: targetEvent.start_time,
        end_time: targetEvent.end_time,
      },
      enrichedEvents,
      vendorMessage,
      travelerNationality,
      groupSize,
      model,
    });
    tracer.endSpan(reasoningSpan, { model, isCascade: decision.isCascadeImpact });

    const validationSpan = tracer.startSpan('validate_orchestration_decision', 'validation');
    const validation = validateOrchestrationDecision(decision, {
      targetEventDate: targetEvent.event_date,
      knownEvents: enrichedEvents.map((e) => ({
        id: e.eventId,
        title: e.title,
        date: e.date,
        startTime: e.startTime,
        endTime: e.endTime,
        status: e.status,
        isImmutable: e.isImmutable,
      })),
      minTransitBufferMinutes: 30,
    });
    tracer.endSpan(validationSpan, { isValid: validation.isValid, violationCount: validation.violations.length });

    if (!validation.isValid || !validation.validatedDecision) {
      const escalationReason = `AI Action Boundary Block: Schedule adjustments rejected due to domain constraint violations: ${validation.violations.join('; ')}`;
      await this.deps.itineraryRepo.updateEvent(
        {
          id: targetEvent.id,
          startTime: targetEvent.start_time,
          endTime: targetEvent.end_time,
          status: 'escalated',
          escalationReason,
        },
        tenantId
      );

      if (this.deps.auditLog) {
        await this.deps.auditLog.record({
          operationId: tracer.getContext().agentRunId,
          operationType: 'action_boundary_block',
          tenantId,
          itineraryId: targetEvent.itinerary_id,
          eventId: targetEvent.id,
          triggerMessageId: options.triggerMessageId,
          senderPhone: options.senderPhone,
          llmModel: model,
          latencyMs: tracer.getTotalDurationMs(),
          rationale: vendorMessage,
          validationStatus: 'rejected',
          violations: validation.violations,
          metadata: {
            traceId: tracer.getContext().traceId,
            traceparent: tracer.toTraceparent(),
            spans: tracer.getSpans(),
          },
        });
      }

      return {
        success: false,
        updatedEventsCount: 0,
        dispatchedNoticesCount: 0,
        error: escalationReason,
        incidentSummary: escalationReason,
        validationViolations: validation.violations,
      };
    }

    const validatedDecision = validation.validatedDecision;

    const adjustments: AtomicCascadeAdjustment[] = validatedDecision.scheduleAdjustments.map((adj) => {
      const startStr = adj.newStartTime.length === 5 ? `${adj.newStartTime}:00` : adj.newStartTime;
      const endStr = adj.newEndTime.length === 5 ? `${adj.newEndTime}:00` : adj.newEndTime;
      const baseReason = adj.reason || validatedDecision.incidentSummary;
      const fullReason = validatedDecision.travelerNotification
        ? `${baseReason} [${validatedDecision.travelerNotification.language}]: "${validatedDecision.travelerNotification.message}"`
        : baseReason;
      return {
        eventId: adj.eventId,
        startTime: startStr,
        endTime: endStr,
        status: adj.newStatus || 'escalated',
        escalationReason: fullReason,
      };
    });

    const rawNotices: AtomicCascadeOutboxNotice[] = validatedDecision.downstreamNotices
      .filter((n) => n.whatsappMessage && n.whatsappMessage.trim().length > 0)
      .map((notice) => ({
        eventId: notice.eventId,
        providerName: notice.providerName,
        providerPhone: notice.providerPhone || '',
        message: notice.whatsappMessage,
      }));

    const auditEntry: AgentAuditEntry = {
      operationId: tracer.getContext().agentRunId,
      operationType: 'schedule_cascade',
      tenantId,
      itineraryId: targetEvent.itinerary_id,
      eventId: targetEvent.id,
      triggerMessageId: options.triggerMessageId,
      senderPhone: options.senderPhone,
      llmModel: model,
      latencyMs: tracer.getTotalDurationMs(),
      rationale: validatedDecision.incidentSummary,
      validationStatus: 'passed',
      metadata: {
        traceId: tracer.getContext().traceId,
        traceparent: tracer.toTraceparent(),
        spans: tracer.getSpans(),
        otelSpans: tracer.toOtelSpans(),
        delayMinutes: validatedDecision.delayMinutes,
        incidentType: validatedDecision.incidentType,
        domainEvents: validation.domainEvents || [],
      },
    };

    const mutationSpan = tracer.startSpan('execute_atomic_cascade', 'mutation');
    const atomicResult = await this.deps.itineraryRepo.executeAtomicCascade({
      tenantId,
      adjustments,
      outboxNotices: rawNotices,
      auditEntry,
    });
    tracer.endSpan(mutationSpan, {
      success: atomicResult.success,
      updatedCount: atomicResult.updatedEventsCount,
      stagedCount: atomicResult.stagedOutboxNotices.length,
      error: atomicResult.error,
    });

    if (!atomicResult.success) {
      return {
        success: false,
        updatedEventsCount: 0,
        dispatchedNoticesCount: 0,
        error: `Transaction rolled back due to update error: ${atomicResult.error}`,
        incidentSummary: validatedDecision.incidentSummary,
        rollbackOccurred: true,
      };
    }

    const notificationSpan = tracer.startSpan('dispatch_downstream_notices', 'notification');
    const { dispatchedCount: dispatchedNoticesCount, updatedNotices: outboxNotices } =
      await this.deps.notificationGateway.dispatchOutbox(atomicResult.stagedOutboxNotices);
    tracer.endSpan(notificationSpan, { dispatchedCount: dispatchedNoticesCount });

    return {
      success: true,
      decision: validatedDecision,
      updatedEventsCount: atomicResult.updatedEventsCount,
      dispatchedNoticesCount,
      incidentSummary: validatedDecision.incidentSummary,
      travelerNotification: validatedDecision.travelerNotification,
      outboxNotices: outboxNotices.map((n) => ({
        id: n.id,
        tenantId: n.tenantId,
        eventId: n.eventId,
        providerName: n.providerName,
        providerPhone: n.providerPhone,
        message: n.message,
        status: n.status,
        attempts: n.attempts,
        createdAt: n.createdAt,
        dispatchedAt: n.dispatchedAt,
        error: n.error,
      })),
    };
  }
}
