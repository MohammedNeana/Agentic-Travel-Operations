import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, resolveAuthorizedTenantId } from '@/lib/supabase/server';
import { callLLMJson } from '@/lib/ai/llm-client';

export const dynamic = 'force-dynamic';

export interface SupplierScorecard {
  providerId: string;
  providerName: string;
  city: string;
  experienceType: string;
  reliabilityScore: number;
  tier: 'ممتاز (Tier 1)' | 'شريك موثوق (Tier 2)' | 'تحت المراقبة (Watchlist)' | 'يحتاج تحسين (Needs Improvement)';
  onTimeRate: string;
  incidentsCount: number;
  aiEvaluation: string;
  recommendedAction: string;
}

export interface RecurringOperationalIssue {
  title: string;
  category: 'النقل واللوجستيات' | 'المرشدين واللغات' | 'التنسيق مع المزودين' | 'الطقس والظروف الطبيعية';
  frequency: string;
  severity: 'عالي' | 'متوسط' | 'منخفض';
  impactAnalysis: string;
  mitigationStrategy: string;
}

export interface AnalyticsDashboardResult {
  executiveSummary: string;
  metrics: {
    totalOperations: number;
    disruptionRate: string;
    autonomousResolutionRate: string;
    averageRecoveryMinutes: number;
    totalActiveSuppliers: number;
    overallSatisfactionRate: string;
    provenance?: {
      totalOperations: 'computed';
      disruptionRate: 'computed';
      totalActiveSuppliers: 'computed';
      autonomousResolutionRate: 'simulated';
      averageRecoveryMinutes: 'simulated';
      overallSatisfactionRate: 'simulated';
    };
  };
  recurringIssues: RecurringOperationalIssue[];
  supplierScorecards: SupplierScorecard[];
  dmcRecommendations: string[];
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const filterCity = searchParams.get('city') || undefined;

    const requestedTenant = searchParams.get('tenant_id') || undefined;
    let tenantId: string;
    try {
      tenantId = await resolveAuthorizedTenantId(req, requestedTenant);
    } catch (authError) {
      return NextResponse.json(
        {
          success: false,
          error: authError instanceof Error ? authError.message : 'Unauthorized: Valid tenant session required.',
        },
        { status: 401 }
      );
    }

    const supabase = createServerSupabaseClient();

    const [{ data: eventsData }, { data: providersData }, { data: itinerariesData }] =
      await Promise.all([
        supabase
          .from('itinerary_events')
          .select('id, title, status, escalation_reason, start_time, end_time, event_date, experience_provider_id')
          .eq('tenant_id', tenantId),
        supabase
          .from('experience_providers')
          .select('id, name, city, experience_type, verification_status, capacity, phone_number')
          .eq('tenant_id', tenantId),
        supabase
          .from('itineraries')
          .select('id, title, status, guest_count, start_date, end_date')
          .eq('tenant_id', tenantId),
      ]);

    const events = eventsData || [];
    let providers = providersData || [];
    const itineraries = itinerariesData || [];

    if (filterCity) {
      providers = providers.filter((p) => p.city.includes(filterCity));
    }

    const totalEvents = events.length || 1;
    const escalatedEvents = events.filter((e) => e.status === 'escalated');
    const confirmedEvents = events.filter((e) => e.status === 'confirmed');
    const disruptionPercent = Math.round((escalatedEvents.length / totalEvents) * 100);

    const escalationReasons = escalatedEvents
      .map((e) => e.escalation_reason)
      .filter(Boolean) as string[];

    const operationalContext = {
      timestamp: new Date().toISOString(),
      itinerariesCount: itineraries.length,
      totalEventsLogged: events.length,
      confirmedEventsCount: confirmedEvents.length,
      escalatedEventsCount: escalatedEvents.length,
      disruptionPercentage: `${disruptionPercent}%`,
      activeProvidersInDB: providers.map((p) => ({
        id: p.id,
        name: p.name,
        city: p.city,
        experienceType: p.experience_type,
        status: p.verification_status,
      })),
      recentEscalationsSample: escalationReasons.slice(0, 10),
    };

    const systemPrompt = `You are the Head of Operations & AI Post-Incident Analytics for Saudi Destination Management Companies (DMCs).
Your mission is to analyze operational performance, supplier dependability, and disruption handling across Saudi tourism experiences.

ACTUAL SUPABASE DATABASE LOGS:
${JSON.stringify(operationalContext, null, 2)}

TASK:
Based strictly on the actual providers and operational logs above:
1. Synthesize an authentic, data-grounded Arabic Post-Trip Executive Briefing ("executiveSummary") reviewing SLA performance and autonomous AI recovery.
2. Calculate realistic operational metrics:
   - "totalOperations": ${events.length || 15}
   - "disruptionRate": "${disruptionPercent}%"
   - "autonomousResolutionRate": "92.6%" (reflecting AI auto-cascade dispatch without manual phone calls)
   - "averageRecoveryMinutes": 4
   - "totalActiveSuppliers": ${providers.length || 5}
   - "overallSatisfactionRate": "96.7%"
3. Analyze 3-4 recurring operational issues ("recurringIssues") relevant to the cities and experience types represented in the database (AlUla heritage tours, Asir mountain guides, Riyadh safari logistics, Red Sea diving).
4. Evaluate EVERY single provider listed in "activeProvidersInDB" and return their "supplierScorecards":
   - Use the exact "id", "name", "city", and "experienceType" from the database.
   - Calculate realistic "reliabilityScore" (between 75 and 98).
   - Assign tier: 'ممتاز (Tier 1)', 'شريك موثوق (Tier 2)', 'تحت المراقبة (Watchlist)', or 'يحتاج تحسين (Needs Improvement)'.
   - "aiEvaluation": Nuanced Arabic qualitative analysis of their responsiveness on WhatsApp and tour execution.
   - "recommendedAction": Specific, actionable recommendation for DMC procurement.
5. "dmcRecommendations": 3 strategic recommendations for DMC executive leadership.

Respond ONLY with valid JSON in this exact structure:
{
  "executiveSummary": "...",
  "metrics": {
    "totalOperations": ${events.length || 15},
    "disruptionRate": "${disruptionPercent}%",
    "autonomousResolutionRate": "92.6%",
    "averageRecoveryMinutes": 4,
    "totalActiveSuppliers": ${providers.length || 5},
    "overallSatisfactionRate": "96.7%"
  },
  "recurringIssues": [
    {
      "title": "...",
      "category": "النقل واللوجستيات",
      "frequency": "...",
      "severity": "عالي",
      "impactAnalysis": "...",
      "mitigationStrategy": "..."
    }
  ],
  "supplierScorecards": [
    {
      "providerId": "...",
      "providerName": "...",
      "city": "...",
      "experienceType": "...",
      "reliabilityScore": 95,
      "tier": "ممتاز (Tier 1)",
      "onTimeRate": "96%",
      "incidentsCount": 0,
      "aiEvaluation": "...",
      "recommendedAction": "..."
    }
  ],
  "dmcRecommendations": ["...", "...", "..."]
}`;

    const userPrompt = `Generate a dynamic AI Post-Trip Analytics Report and Supplier Reliability Evaluation for There DMC based on real database records.`;

    const result = await callLLMJson<AnalyticsDashboardResult>({
      systemPrompt,
      userPrompt,
      temperature: 0.2,
    });

    const finalData: AnalyticsDashboardResult = {
      ...result.data,
      metrics: {
        totalOperations: events.length,
        disruptionRate: `${disruptionPercent}%`,
        totalActiveSuppliers: providers.length,
        autonomousResolutionRate: result.data?.metrics?.autonomousResolutionRate || '92.6%',
        averageRecoveryMinutes: result.data?.metrics?.averageRecoveryMinutes || 4,
        overallSatisfactionRate: result.data?.metrics?.overallSatisfactionRate || '96.7%',
        provenance: {
          totalOperations: 'computed',
          disruptionRate: 'computed',
          totalActiveSuppliers: 'computed',
          autonomousResolutionRate: 'simulated',
          averageRecoveryMinutes: 'simulated',
          overallSatisfactionRate: 'simulated',
        },
      },
    };

    return NextResponse.json({
      success: true,
      source: result.provider,
      model: result.model,
      data: finalData,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate analytics via LLM',
      },
      { status: 500 }
    );
  }
}
