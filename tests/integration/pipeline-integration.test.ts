import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import { NextRequest } from 'next/server';
import { clearIdempotencyCache } from '@/lib/whatsapp/idempotency';
import { clearAuditLogs, getRecentAgentAuditLogs } from '@/lib/agent/audit-log';

const integrationDbState: {
  itinerary_events: Array<{
    id: string;
    itinerary_id: string;
    tenant_id: string;
    event_date: string;
    start_time: string;
    end_time: string;
    title: string;
    status: string;
    sort_order: number;
    experience_provider_id: string;
    escalation_reason?: string | null;
    is_immutable?: boolean;
    updated_at?: string;
  }>;
  experience_providers: Array<{
    id: string;
    name: string;
    phone_number: string;
    tenant_id: string;
  }>;
  itineraries: Array<{
    id: string;
    title: string;
    guest_count: number;
    tenant_id: string;
    traveler_profile_id: string;
  }>;
  traveler_profiles: Array<{
    id: string;
    name: string;
    nationality: string;
    group_size: number;
    tenant_id: string;
  }>;
  whatsapp_messages: any[];
  notification_outbox: any[];
  agent_audit_log: any[];
  idempotency_records: any[];
} = {
  itinerary_events: [],
  experience_providers: [],
  itineraries: [],
  traveler_profiles: [],
  whatsapp_messages: [],
  notification_outbox: [],
  agent_audit_log: [],
  idempotency_records: [],
};

function resetIntegrationDb() {
  integrationDbState.itinerary_events = [
    {
      id: 'event-nabataean-walk',
      itinerary_id: 'itin-heritage-001',
      tenant_id: 'tenant-heritage-dmc',
      event_date: '2026-11-05',
      start_time: '09:00:00',
      end_time: '11:30:00',
      title: 'AlUla Heritage Walk',
      status: 'confirmed',
      sort_order: 1,
      experience_provider_id: 'prov-guide-ahmed',
    },
    {
      id: 'event-hegra-safari',
      itinerary_id: 'itin-heritage-001',
      tenant_id: 'tenant-heritage-dmc',
      event_date: '2026-11-05',
      start_time: '13:00:00',
      end_time: '16:00:00',
      title: 'Hegra Sunset Safari',
      status: 'confirmed',
      sort_order: 2,
      experience_provider_id: 'prov-safari-team',
    },
    {
      id: 'event-flight-riyadh',
      itinerary_id: 'itin-heritage-001',
      tenant_id: 'tenant-heritage-dmc',
      event_date: '2026-11-05',
      start_time: '19:00:00',
      end_time: '20:30:00',
      title: 'Domestic Flight to Riyadh',
      status: 'confirmed',
      sort_order: 3,
      experience_provider_id: 'prov-airline',
      is_immutable: true,
    },
  ];

  integrationDbState.experience_providers = [
    {
      id: 'prov-guide-ahmed',
      name: 'Ahmed Al-Harbi',
      phone_number: '966500000001',
      tenant_id: 'tenant-heritage-dmc',
    },
    {
      id: 'prov-safari-team',
      name: 'Hegra Safari Team',
      phone_number: '966500000002',
      tenant_id: 'tenant-heritage-dmc',
    },
  ];

  integrationDbState.itineraries = [
    {
      id: 'itin-heritage-001',
      title: 'Wonders of AlUla 3-Day Journey',
      guest_count: 6,
      tenant_id: 'tenant-heritage-dmc',
      traveler_profile_id: 'prof-italian-delegation',
    },
  ];

  integrationDbState.traveler_profiles = [
    {
      id: 'prof-italian-delegation',
      name: 'Italian Cultural Delegation',
      nationality: 'إيطالي',
      group_size: 6,
      tenant_id: 'tenant-heritage-dmc',
    },
  ];

  integrationDbState.whatsapp_messages = [];
  integrationDbState.notification_outbox = [];
  integrationDbState.agent_audit_log = [];
  integrationDbState.idempotency_records = [];
}

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: () => ({
    from: (table: string) => {
      const filters: Array<{ col: string; val: any }> = [];
      let inCol: string | null = null;
      let inVals: any[] = [];
      let pendingUpdates: any = null;

      const queryBuilder = {
        select: (_cols?: string) => queryBuilder,
        eq: (col: string, val: any) => {
          filters.push({ col, val });
          return queryBuilder;
        },
        neq: (_col: string, _val: any) => queryBuilder,
        in: (col: string, vals: any[]) => {
          inCol = col;
          inVals = vals;
          return queryBuilder;
        },
        order: (_col: string, _opts?: any) => queryBuilder,
        limit: (_n: number) => queryBuilder,
        insert: async (rows: any | any[]) => {
          const list = Array.isArray(rows) ? rows : [rows];
          const target = (integrationDbState as any)[table];
          if (target) {
            target.push(...list);
          }
          return { data: list, error: null };
        },
        update: (updates: any) => {
          pendingUpdates = updates;
          return queryBuilder;
        },
        single: async () => {
          const target = (integrationDbState as any)[table] || [];
          const row = target.find((r: any) => filters.every((f) => r[f.col] === f.val));
          return { data: row || null, error: row ? null : { message: 'Row not found' } };
        },
        maybeSingle: async () => {
          const target = (integrationDbState as any)[table] || [];
          const row = target.find((r: any) => filters.every((f) => r[f.col] === f.val));
          return { data: row || null, error: null };
        },
        then: (resolve: (val: any) => any) => {
          const target = (integrationDbState as any)[table] || [];
          if (pendingUpdates) {
            const updateKey = inCol;
            for (const r of target) {
              const matchesFilters = filters.length === 0 || filters.every((f) => r[f.col] === f.val);
              const matchesIn = !updateKey || inVals.includes(r[updateKey]);
              if (matchesFilters && matchesIn) {
                Object.assign(r, pendingUpdates);
              }
            }
            return resolve({ data: target, error: null });
          }

          let result = target;
          if (filters.length > 0) {
            result = result.filter((r: any) => filters.every((f) => r[f.col] === f.val));
          }
          if (inCol && inVals.length > 0) {
            const filterKey = inCol;
            result = result.filter((r: any) => inVals.includes(r[filterKey]));
          }
          return resolve({ data: result, error: null });
        },
      };

      return queryBuilder;
    },
  }),
}));

describe('Full End-to-End Autonomous Pipeline Integration Test', () => {
  const secret = 'whsec_pipeline_integration_secret_test_999';
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.stubEnv('WHATSAPP_APP_SECRET', secret);
    vi.stubEnv('GROQ_API_KEY', 'gsk_mock_pipeline_groq_key_999');
    resetIntegrationDb();
    clearIdempotencyCache();
    clearAuditLogs();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  function createSignedWebhookRequest(bodyObj: any): NextRequest {
    const rawBody = JSON.stringify(bodyObj);
    const signature = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const targetUrl = 'https:' + String.fromCharCode(47, 47) + 'localhost:3000/api/webhooks/whatsapp';

    return new NextRequest(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-hub-signature-256': signature,
      },
      body: rawBody,
    });
  }

  it('executes full pipeline from signed incoming message to outbox dispatch and distributed audit span', async () => {
    global.fetch = vi.fn().mockImplementation(async (url, opts) => {
      const urlStr = String(url);

      if (urlStr.includes('api.groq.com')) {
        const bodyStr = opts && opts.body ? String(opts.body) : '';

        if (bodyStr.includes('Incident Dispatcher')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      category: 'Delay',
                      confidence: 0.98,
                      matchedEventId: 'event-nabataean-walk',
                      matchedGroupSummary: 'وفد إيطالي (6 أشخاص) - موعد الصباح 09:00',
                      isAmbiguous: false,
                      reason: 'تأخير 60 دقيقة في جولة التراث',
                      suggestedAction: 'orchestrate_cascade',
                    }),
                  },
                },
              ],
            }),
          };
        }

        if (bodyStr.includes('Senior AI Operations Director')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      delayMinutes: 60,
                      incidentType: 'delay',
                      isCascadeImpact: true,
                      incidentSummary: 'تأخير 60 دقيقة في جولة التراث مع ترحيل سفاري الحجر لتفادي التضارب وضمان وقت تنقل كافي.',
                      scheduleAdjustments: [
                        {
                          eventId: 'event-nabataean-walk',
                          eventTitle: 'AlUla Heritage Walk',
                          previousStartTime: '09:00',
                          previousEndTime: '11:30',
                          newStartTime: '10:00',
                          newEndTime: '12:30',
                          newStatus: 'escalated',
                          reason: 'تأخير 60 دقيقة في الطريق',
                        },
                        {
                          eventId: 'event-hegra-safari',
                          eventTitle: 'Hegra Sunset Safari',
                          previousStartTime: '13:00',
                          previousEndTime: '16:00',
                          newStartTime: '13:30',
                          newEndTime: '16:30',
                          newStatus: 'escalated',
                          reason: 'ترحيل وقائي لتفادي التضارب وضمان وقت التنقل',
                        },
                      ],
                      downstreamNotices: [
                        {
                          eventId: 'event-hegra-safari',
                          providerName: 'Hegra Safari Team',
                          providerPhone: '966500000002',
                          newStartTime: '13:30',
                          whatsappMessage: 'السلام عليكم ورحمة الله، نبلغكم بترحيل موعد الاستقبال إلى 13:30',
                        },
                      ],
                      travelerNotification: {
                        language: 'Italian',
                        flag: '🇮🇹',
                        title: 'Aggiornamento Itinerario',
                        message: 'Gentili ospiti, il tour è posticipato di 60 minuti.',
                        translatedSummaryInArabic: 'إشعار الوفد الإيطالي بتأخير 60 دقيقة',
                      },
                    }),
                  },
                },
              ],
            }),
          };
        }
      }

      if (urlStr.includes('graph.facebook.com')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            messages: [{ id: 'wamid.HBgLMTIzNDU2Nzg5MA==' }],
          }),
        };
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({}),
      };
    });

    const { POST } = await import('@/app/api/webhooks/whatsapp/route');

    const incomingPayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba-test-pipeline-101',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '15550009999',
                  phone_number_id: 'pni-test-pipeline-888',
                },
                contacts: [{ profile: { name: 'Ahmed Guide' }, wa_id: '966500000001' }],
                messages: [
                  {
                    from: '966500000001',
                    id: 'msg-pipeline-integration-msg-001',
                    timestamp: '1729000000',
                    type: 'text',
                    text: {
                      body: 'السلام عليكم، الطريق مقفل وبنتأخر ساعة كاملة عن موعد جولة الصباح',
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const request = createSignedWebhookRequest(incomingPayload);
    const response = await POST(request);

    expect(response.status).toBe(200);
    const resJson = await response.json();
    expect(resJson.success).toBe(true);
    expect(resJson.results).toBeDefined();
    expect(resJson.results.length).toBeGreaterThanOrEqual(1);
    const firstResult = resJson.results[0];
    expect(firstResult.actionTaken).toBe('schedule_cascade_orchestrated');

    const walkEvent = integrationDbState.itinerary_events.find(
      (e) => e.id === 'event-nabataean-walk'
    );
    expect(walkEvent?.start_time).toBe('10:00:00');
    expect(walkEvent?.end_time).toBe('12:30:00');
    expect(walkEvent?.status).toBe('escalated');

    const safariEvent = integrationDbState.itinerary_events.find(
      (e) => e.id === 'event-hegra-safari'
    );
    expect(safariEvent?.start_time).toBe('13:30:00');
    expect(safariEvent?.end_time).toBe('16:30:00');
    expect(safariEvent?.status).toBe('escalated');

    expect(integrationDbState.notification_outbox.length).toBeGreaterThanOrEqual(1);
    const notice = integrationDbState.notification_outbox[0];
    expect(notice.recipient_phone).toBe('966500000002');
    expect(notice.event_id).toBe('event-hegra-safari');

    const auditLogs = getRecentAgentAuditLogs(10);
    expect(auditLogs.length).toBeGreaterThanOrEqual(1);
    const cascadeAudit = auditLogs.find((a) => a.operationType === 'schedule_cascade');
    expect(cascadeAudit).toBeDefined();
    expect(cascadeAudit?.validationStatus).toBe('passed');
    expect(cascadeAudit?.metadata?.traceId).toBeDefined();
    expect(Array.isArray(cascadeAudit?.metadata?.spans)).toBe(true);
  });

  it('guarantees idempotency when an identical webhook payload is replayed', async () => {
    const { POST } = await import('@/app/api/webhooks/whatsapp/route');

    const replayedPayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba-test-pipeline-101',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '15550009999',
                  phone_number_id: 'pni-test-pipeline-888',
                },
                contacts: [{ profile: { name: 'Ahmed Guide' }, wa_id: '966500000001' }],
                messages: [
                  {
                    from: '966500000001',
                    id: 'msg-pipeline-replayed-unique-002',
                    timestamp: '1729000000',
                    type: 'text',
                    text: {
                      body: 'جاهزين ومؤكدين الحجز بإذن الله',
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    global.fetch = vi.fn().mockImplementation(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  category: 'Acceptance',
                  confidence: 0.99,
                  matchedEventId: 'event-nabataean-walk',
                  isAmbiguous: false,
                  reason: 'تأكيد الحجز',
                  suggestedAction: 'booking_confirmed',
                }),
              },
            },
          ],
        }),
      };
    });

    const firstReq = createSignedWebhookRequest(replayedPayload);
    const firstRes = await POST(firstReq);
    expect(firstRes.status).toBe(200);

    const secondReq = createSignedWebhookRequest(replayedPayload);
    const secondRes = await POST(secondReq);
    expect(secondRes.status).toBe(200);
    const secondJson = await secondRes.json();
    expect(secondJson.results).toBeDefined();
    expect(secondJson.results.length).toBeGreaterThanOrEqual(1);
    const secondFirstResult = secondJson.results[0];
    expect(secondFirstResult.actionTaken).toBe('no_action_needed');
    expect(secondFirstResult.details?.reason).toBe('duplicate_delivery_ignored');
  });
});
