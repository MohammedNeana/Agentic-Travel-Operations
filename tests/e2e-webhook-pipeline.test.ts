import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import { NextRequest } from 'next/server';
import { clearIdempotencyCache } from '@/lib/whatsapp/idempotency';

const mockDbState: {
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
  notification_outbox: any[];
  agent_audit_log: any[];
  idempotency_records: any[];
} = {
  itinerary_events: [],
  experience_providers: [],
  itineraries: [],
  traveler_profiles: [],
  notification_outbox: [],
  agent_audit_log: [],
  idempotency_records: [],
};

function resetMockDb() {
  mockDbState.itinerary_events = [
    {
      id: 'event-safari-001',
      itinerary_id: 'itin-alula-100',
      tenant_id: 'tenant-alula-dmc',
      event_date: '2026-10-15',
      start_time: '09:00:00',
      end_time: '11:30:00',
      title: 'رحلة سفاري صباحية',
      status: 'planned',
      sort_order: 1,
      experience_provider_id: 'prov-safari-001',
    },
    {
      id: 'event-hegra-002',
      itinerary_id: 'itin-alula-100',
      tenant_id: 'tenant-alula-dmc',
      event_date: '2026-10-15',
      start_time: '13:00:00',
      end_time: '15:30:00',
      title: 'جولة الحجر الأثرية',
      status: 'planned',
      sort_order: 2,
      experience_provider_id: 'prov-hegra-002',
    },
  ];

  mockDbState.experience_providers = [
    {
      id: 'prov-safari-001',
      name: 'مرشد سفاري العلا',
      phone_number: '+966500000001',
      tenant_id: 'tenant-alula-dmc',
    },
    {
      id: 'prov-hegra-002',
      name: 'مرشد مدائن صالح',
      phone_number: '+966500000002',
      tenant_id: 'tenant-alula-dmc',
    },
  ];

  mockDbState.itineraries = [
    {
      id: 'itin-alula-100',
      title: 'برنامج العلا التراثي',
      guest_count: 4,
      tenant_id: 'tenant-alula-dmc',
      traveler_profile_id: 'prof-smith-001',
    },
  ];

  mockDbState.traveler_profiles = [
    {
      id: 'prof-smith-001',
      name: 'عائلة سميث',
      nationality: 'British',
      group_size: 4,
      tenant_id: 'tenant-alula-dmc',
    },
  ];

  mockDbState.notification_outbox = [];
  mockDbState.agent_audit_log = [];
  mockDbState.idempotency_records = [];
}

vi.mock('@/lib/supabase/server', () => {
  return {
    createServerSupabaseClient: () => {
      return {
        from: (tableName: keyof typeof mockDbState) => {
          let filters: Array<(item: any) => boolean> = [];
          let orderByField: string | null = null;
          let orderAsc = true;
          let limitCount: number | null = null;

          const builder: any = {
            select: () => builder,
            eq: (col: string, val: any) => {
              filters.push((item: any) => item[col] === val);
              return builder;
            },
            neq: (col: string, val: any) => {
              filters.push((item: any) => item[col] !== val);
              return builder;
            },
            in: (col: string, vals: any[]) => {
              filters.push((item: any) => vals.includes(item[col]));
              return builder;
            },
            order: (col: string, opts?: { ascending?: boolean }) => {
              orderByField = col;
              orderAsc = opts?.ascending !== false;
              return builder;
            },
            limit: (n: number) => {
              limitCount = n;
              return builder;
            },
            single: async () => {
              let rows = (mockDbState[tableName] || []) as any[];
              for (const f of filters) {
                rows = rows.filter(f);
              }
              if (rows.length === 0) {
                return { data: null, error: { message: 'Row not found' } };
              }
              return { data: rows[0], error: null };
            },
            maybeSingle: async () => {
              let rows = (mockDbState[tableName] || []) as any[];
              for (const f of filters) {
                rows = rows.filter(f);
              }
              return { data: rows[0] || null, error: null };
            },
            then: (resolve: any) => {
              let rows = [...((mockDbState[tableName] || []) as any[])];
              for (const f of filters) {
                rows = rows.filter(f);
              }
              if (orderByField) {
                rows.sort((a, b) => {
                  if (a[orderByField!] < b[orderByField!]) return orderAsc ? -1 : 1;
                  if (a[orderByField!] > b[orderByField!]) return orderAsc ? 1 : -1;
                  return 0;
                });
              }
              if (limitCount !== null) {
                rows = rows.slice(0, limitCount);
              }
              return Promise.resolve({ data: rows, error: null }).then(resolve);
            },
            update: (values: any) => {
              const updateBuilder: any = {
                eq: (col: string, val: any) => {
                  filters.push((item: any) => item[col] === val);
                  return updateBuilder;
                },
                then: (resolve: any) => {
                  const rows = (mockDbState[tableName] || []) as any[];
                  for (const r of rows) {
                    let match = true;
                    for (const f of filters) {
                      if (!f(r)) {
                        match = false;
                        break;
                      }
                    }
                    if (match) {
                      Object.assign(r, values);
                    }
                  }
                  return Promise.resolve({ data: null, error: null }).then(resolve);
                },
              };
              return updateBuilder;
            },
            insert: (rowsOrRow: any) => {
              const toInsert = Array.isArray(rowsOrRow) ? rowsOrRow : [rowsOrRow];
              if (!mockDbState[tableName]) {
                (mockDbState as any)[tableName] = [];
              }
              mockDbState[tableName].push(...toInsert);
              const insertBuilder: any = {
                select: () => ({
                  single: async () => ({ data: toInsert[0], error: null }),
                }),
                then: (resolve: any) =>
                  Promise.resolve({ data: toInsert, error: null }).then(resolve),
              };
              return insertBuilder;
            },
          };

          return builder;
        },
      };
    },
  };
});

vi.mock('@/lib/whatsapp/sender', () => ({
  sendWhatsAppTextMessage: vi.fn().mockImplementation(async () => {
    return { success: true, messageId: 'wa-msg-mock-id-789' };
  }),
  sendProviderNotification: vi.fn().mockResolvedValue({
    success: true,
    messageId: 'wa-notif-mock-id-789',
  }),
}));

vi.mock('@/lib/whatsapp/intent', () => ({
  classifyWhatsAppMessageIntent: vi.fn().mockImplementation(async (text: string, options: any) => {
    if (text.includes('عطل') || text.includes('ساعة ونص') || text.includes('نتأخر')) {
      const targetId = options?.candidateEvents?.[0]?.eventId || 'event-safari-001';
      return {
        category: 'Delay',
        confidence: 0.97,
        matchedEventId: targetId,
        matchedGroupSummary: 'وفد بريطاني (4 أشخاص) - رحلة سفاري صباحية',
        isAmbiguous: false,
        reason: 'تأخير ساعة ونصف بسبب عطل في الباص على طريق العلا',
        isEscalationRequired: true,
      };
    }
    return {
      category: 'General',
      confidence: 0.85,
      matchedEventId: null,
      isAmbiguous: false,
      reason: 'استفسار عام',
      isEscalationRequired: false,
    };
  }),
  classifyVoiceIntent: vi.fn(),
}));

vi.mock('@/lib/ai/llm-client', () => ({
  callLLMJson: vi.fn().mockImplementation(async () => {
    return {
      data: {
        delayMinutes: 90,
        incidentType: 'delay',
        isCascadeImpact: true,
        incidentSummary: 'تأخر رحلة السفاري 90 دقيقة وترحيل جولة الحجر 30 دقيقة للحفاظ على نافذة الانتقال',
        scheduleAdjustments: [
          {
            eventId: 'event-safari-001',
            eventTitle: 'رحلة سفاري صباحية',
            previousStartTime: '09:00',
            previousEndTime: '11:30',
            newStartTime: '10:30',
            newEndTime: '13:00',
            newStatus: 'escalated',
            reason: 'عطل في الباص على طريق العلا',
          },
          {
            eventId: 'event-hegra-002',
            eventTitle: 'جولة الحجر الأثرية',
            previousStartTime: '13:00',
            previousEndTime: '15:30',
            newStartTime: '13:30',
            newEndTime: '16:00',
            newStatus: 'escalated',
            reason: 'ترحيل 30 دقيقة للحفاظ على فاصل التنقل',
          },
        ],
        downstreamNotices: [
          {
            eventId: 'event-hegra-002',
            providerName: 'مرشد مدائن صالح',
            providerPhone: '+966500000002',
            newStartTime: '13:30',
            whatsappMessage: 'السلام عليكم، نبلغكم بترحيل موعد الجولة إلى 13:30 نظراً لتأخر وصول الفوج.',
          },
        ],
        travelerNotification: {
          language: 'en',
          message: 'Dear guests, your morning safari timing has shifted to 10:30 AM due to bus maintenance.',
        },
      },
      raw: '',
      model: 'llama-3.3-70b-versatile',
      latencyMs: 820,
    };
  }),
}));

import { POST } from '@/app/api/webhooks/whatsapp/route';

describe('End-to-End WhatsApp Webhook Ingress & Autonomous Pipeline', () => {
  const testSecret = 'secret_webhook_meta_app_key_999';

  beforeEach(() => {
    process.env.WHATSAPP_APP_SECRET = testSecret;
    process.env.GROQ_API_KEY = 'gsk_mock_api_key_valid';
    resetMockDb();
    clearIdempotencyCache();
    vi.clearAllMocks();
  });

  function createSignedRequest(payload: object, signatureSecret?: string): NextRequest {
    const rawBody = JSON.stringify(payload);
    const secret = signatureSecret !== undefined ? signatureSecret : testSecret;
    const hmac = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

    const targetUrl = new URL('/api/webhooks/whatsapp', 'https:' + String.fromCharCode(47, 47) + 'localhost:3000');
    return new NextRequest(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-hub-signature-256': `sha256=${hmac}`,
      },
      body: rawBody,
    });
  }

  it('rejects unauthenticated webhook requests with invalid HMAC signature', async () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [],
    };
    const req = createSignedRequest(payload, 'wrong_tampered_secret');
    const res = await POST(req);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain('Unauthorized: Invalid signature');
  });

  it('executes full autonomous incident lifecycle from webhook ingress to database, outbox, and audit', async () => {
    const messageId = `wamid.HBgLM_${Date.now()}`;
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'entry-test-1',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '966500000000',
                  phone_number_id: 'phone-id-001',
                },
                contacts: [
                  {
                    wa_id: '966500000001',
                    profile: { name: 'مرشد سفاري العلا' },
                  },
                ],
                messages: [
                  {
                    from: '966500000001',
                    id: messageId,
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    type: 'text',
                    text: {
                      body: 'نتأخر ساعة ونص بسبب عطل في الباص على طريق العلا',
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const req = createSignedRequest(payload);
    const res = await POST(req);

    expect(res.status).toBe(200);
    const resBody = await res.json();
    expect(resBody.success).toBe(true);
    expect(resBody.results).toBeDefined();
    expect(resBody.results).toHaveLength(1);

    const firstResult = resBody.results[0];
    expect(firstResult.actionTaken).toBe('schedule_cascade_orchestrated');
    expect(firstResult.success).toBe(true);
    expect(firstResult.details.updatedEventsCount).toBe(2);
    expect(firstResult.details.dispatchedNoticesCount).toBe(1);

    const safariEvent = mockDbState.itinerary_events.find((e) => e.id === 'event-safari-001');
    expect(safariEvent).toBeDefined();
    expect(safariEvent?.start_time).toBe('10:30:00');
    expect(safariEvent?.end_time).toBe('13:00:00');
    expect(safariEvent?.status).toBe('escalated');

    const hegraEvent = mockDbState.itinerary_events.find((e) => e.id === 'event-hegra-002');
    expect(hegraEvent).toBeDefined();
    expect(hegraEvent?.start_time).toBe('13:30:00');
    expect(hegraEvent?.end_time).toBe('16:00:00');
    expect(hegraEvent?.status).toBe('escalated');

    expect(mockDbState.notification_outbox.length).toBeGreaterThanOrEqual(1);
    const stagedNotice = mockDbState.notification_outbox[0];
    expect(stagedNotice.recipient_phone).toBe('+966500000002');
    expect(stagedNotice.tenant_id).toBe('tenant-alula-dmc');

    expect(mockDbState.agent_audit_log.length).toBeGreaterThanOrEqual(1);
    const auditEntry = mockDbState.agent_audit_log[0];
    expect(auditEntry.operation_type).toBe('schedule_cascade');
    expect(auditEntry.validation_status).toBe('passed');
    expect(auditEntry.tenant_id).toBe('tenant-alula-dmc');
  });

  it('suppresses duplicate webhook deliveries and prevents duplicate mutations via idempotency layer', async () => {
    const messageId = `wamid.duplicate_test_${Date.now()}`;
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'entry-test-dup',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '966500000000',
                  phone_number_id: 'phone-id-001',
                },
                contacts: [
                  {
                    wa_id: '966500000001',
                    profile: { name: 'مرشد سفاري العلا' },
                  },
                ],
                messages: [
                  {
                    from: '966500000001',
                    id: messageId,
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    type: 'text',
                    text: {
                      body: 'نتأخر ساعة ونص بسبب عطل في الباص على طريق العلا',
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const initialReq = createSignedRequest(payload);
    const initialRes = await POST(initialReq);
    expect(initialRes.status).toBe(200);

    const outboxCountAfterFirst = mockDbState.notification_outbox.length;
    const auditCountAfterFirst = mockDbState.agent_audit_log.length;

    const duplicateReq = createSignedRequest(payload);
    const duplicateRes = await POST(duplicateReq);
    expect(duplicateRes.status).toBe(200);

    const duplicateBody = await duplicateRes.json();
    expect(duplicateBody.results).toHaveLength(1);
    expect(duplicateBody.results[0].actionTaken).toBe('no_action_needed');
    expect(duplicateBody.results[0].details.reason).toBe('duplicate_delivery_ignored');

    expect(mockDbState.notification_outbox.length).toBe(outboxCountAfterFirst);
    expect(mockDbState.agent_audit_log.length).toBe(auditCountAfterFirst);
  });

  it('blocks unauthorized suppliers from modifying events via semantic authorization gate', async () => {
    const unassignedPhone = '966599999999';
    const messageId = `wamid.unauthorized_${Date.now()}`;
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'entry-test-unauth',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '966500000000',
                  phone_number_id: 'phone-id-001',
                },
                contacts: [
                  {
                    wa_id: unassignedPhone,
                    profile: { name: 'متطفل غير مسجل' },
                  },
                ],
                messages: [
                  {
                    from: unassignedPhone,
                    id: messageId,
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    type: 'text',
                    text: {
                      body: 'نتأخر ساعة ونص بسبب عطل في الباص على طريق العلا',
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const req = createSignedRequest(payload);
    const res = await POST(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toHaveLength(1);
    expect(body.results[0].success).toBe(false);
    expect(body.results[0].error).toContain('Semantic Authorization Block');
  });
});
