import { NextResponse } from 'next/server';
import { escalateItineraryEvent } from '@/lib/whatsapp/events';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const result = await escalateItineraryEvent({
      transcriptionText: 'تصوير الدرعية هيتآخر',
      reason: 'تأخير في جولة تصوير الدرعية بسبب حركة المرور',
      senderPhone: '+966500000000',
    });

    return NextResponse.json({
      success: true,
      result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
