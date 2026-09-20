import { NextRequest, NextResponse } from 'next/server';
import { callLLMJson } from '@/lib/ai/llm-client';

export const dynamic = 'force-dynamic';

export interface DemandForecastResult {
  city: string;
  season: string;
  travelerSegment: string;
  visitorSurgePercent: number;
  capacityPressureScore: number;
  priceSurgeEstimate: string;
  executiveSummary: string;
  keyDrivers: string[];
  criticalShortageCategories: Array<{
    category: string;
    riskLevel: 'عالي جداً (Critical)' | 'مرتفع' | 'متوسط' | 'منخفض';
    recommendation: string;
  }>;
  dmcStrategyRecommendations: string[];
  quarterlyForecast: Array<{
    period: string;
    demandLevel: string;
    occupancyRate: string;
  }>;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const city = body.city || 'العلا';
    const season = body.season || 'شتاء طنطورة وموسم الشتاء';
    const travelerSegment = body.travelerSegment || 'سياحة ثقافية وتراث فاخر';
    const customPrompt = body.customPrompt ? `\n\nتوجيه إضافي من مدير التخطيط في الـ DMC:\n"${body.customPrompt}"` : '';

    const systemPrompt = `You are the Chief Regional Tourism Demand Strategist & AI Predictive Intelligence Specialist for Saudi Destination Management Companies (DMCs).
Your role is to produce realistic, nuanced, dynamic operational demand forecasts for Saudi tourism destinations.
You must analyze capacity constraints, seasonal surges, supplier pressures, and pricing fluctuations dynamically for the given inputs.

DESTINATION / INPUTS:
- City / Region: "${city}"
- Season / Timing: "${season}"
- Target Traveler Segment: "${travelerSegment}"${customPrompt}

MANDATORY INSTRUCTIONS:
- Do NOT use canned or static answers. Generate realistic, data-backed analytical metrics specifically tailored to ${city}.
- "visitorSurgePercent": Integer representing estimated % visitor influx above normal baseline (e.g. 35 to 75).
- "capacityPressureScore": Integer (1 to 100) representing operational strain on local hotels, luxury 4x4s, guides, and permits.
- "priceSurgeEstimate": Estimated % increase in supplier rates during this peak (e.g. "+30% إلى +50%").
- "executiveSummary": An in-depth, professional Arabic executive brief (3-4 sentences) breaking down real-world demand dynamics, logistics bottlenecks, and capacity risks in ${city}.
- "keyDrivers": 3-4 specific local drivers (festivals, climate, flights, cultural attractions, international marketing).
- "criticalShortageCategories": 2-3 specific supply bottlenecks in ${city} (e.g. bilingual guides, luxury desert camp permits, 4x4 vehicles, stargazing astronomers) with risk level and specific actionable recommendation.
- "dmcStrategyRecommendations": 2-3 proactive, practical operational actions the DMC team must implement right now.
- "quarterlyForecast": 3 sequential quarters with period name, demandLevel ('ذروة قصوى (Peak)', 'مرتفع جداً (High)', 'معتدل (Moderate)', 'منخفض (Low)'), and occupancyRate (e.g. '88%').

Respond ONLY with valid JSON in this exact structure:
{
  "city": "${city}",
  "season": "${season}",
  "travelerSegment": "${travelerSegment}",
  "visitorSurgePercent": 48,
  "capacityPressureScore": 86,
  "priceSurgeEstimate": "+35% إلى +45%",
  "executiveSummary": "...",
  "keyDrivers": ["...", "..."],
  "criticalShortageCategories": [
    {
      "category": "...",
      "riskLevel": "عالي جداً (Critical)",
      "recommendation": "..."
    }
  ],
  "dmcStrategyRecommendations": ["...", "..."],
  "quarterlyForecast": [
    { "period": "الربع القادم 1", "demandLevel": "ذروة قصوى (Peak)", "occupancyRate": "92%" },
    { "period": "الربع القادم 2", "demandLevel": "مرتفع (High)", "occupancyRate": "78%" },
    { "period": "الربع القادم 3", "demandLevel": "معتدل (Moderate)", "occupancyRate": "55%" }
  ]
}`;

    const userPrompt = `Generate a dynamic, real-time AI Demand Forecast for DMC operations in "${city}" during "${season}" for "${travelerSegment}".`;

    const result = await callLLMJson<DemandForecastResult>({
      systemPrompt,
      userPrompt,
      temperature: 0.3,
    });

    return NextResponse.json({
      success: true,
      source: result.provider,
      model: result.model,
      forecast: result.data,
    });
  } catch (error) {
    console.error('Error in POST /api/ai/forecasting:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate demand forecast via LLM',
      },
      { status: 500 }
    );
  }
}
