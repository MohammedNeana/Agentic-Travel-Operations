import { LLMProvider } from '@/lib/ports/llm.port';
import {
  OrchestrationDecision,
  ScheduleAdjustment,
  DownstreamVendorNotice,
} from '@/lib/whatsapp/types';

export interface EnrichedEventItem {
  order: number;
  eventId: string;
  title: string;
  date?: string;
  startTime: string;
  endTime: string;
  status: string;
  providerName: string;
  providerPhone: string;
  isTargetEvent: boolean;
  isImmutable?: boolean;
}

export interface PlanCascadeParams {
  targetEvent: {
    id: string;
    title: string;
    start_time: string;
    end_time: string;
  };
  enrichedEvents: EnrichedEventItem[];
  vendorMessage: string;
  travelerNationality: string;
  groupSize: number;
  model?: string;
}

export class CascadeShiftPlanner {
  constructor(private readonly llmProvider: LLMProvider) {}

  async planCascade(params: PlanCascadeParams): Promise<OrchestrationDecision> {
    try {
      return await this.consultLLM(params);
    } catch {
      return this.fallbackDecision(params);
    }
  }

  private async consultLLM(params: PlanCascadeParams): Promise<OrchestrationDecision> {
    const { targetEvent, vendorMessage, enrichedEvents, travelerNationality, groupSize } = params;

    const scheduleDescription = enrichedEvents
      .map((e) => {
        const marker = e.isTargetEvent ? '[الفعالية المتأثرة بالبلاغ]' : `[الفعالية رقم ${e.order}]`;
        return `${marker}:
- معرف الفعالية: "${e.eventId}"
- اسم الفعالية: "${e.title}"
- المزود: "${e.providerName}" (هاتف: ${e.providerPhone || 'غير مسجل'})
- الموعد الأصلي: من الساعة ${e.startTime} إلى ${e.endTime} (التاريخ: ${e.date || ''})
- الحالة الحالية: ${e.status}`;
      })
      .join('\n\n');

    const systemPrompt = `You are the Senior AI Operations Director & Dispatch Orchestrator for a premier Destination Management Company (DMC).
You operate with autonomous operational intelligence to manage trip schedules, resolve vendor delays, eliminate schedule conflicts, and coordinate downstream vendors.

You receive an operational WhatsApp message (text or voice transcription) from a provider regarding an activity in an active itinerary.
Guest Details: الوفد (${travelerNationality}) عددهم ${groupSize} أشخاص.

YOUR AUTONOMOUS MISSION:
1. UNDERSTAND DELAY & ROOT CAUSE:
   - Extract the delay duration (e.g. 2 hours, 90 minutes, 30 minutes, or a new stated start time like 16:00).
   - If not explicitly stated in hours/minutes, deduce the realistic delay from the vendor's context.

2. CASCADE IMPACT ANALYSIS ON SUBSEQUENT TRIPS:
   - Calculate the new start and end time for the target delayed event.
   - Look at the subsequent events in the itinerary.
   - Account for realistic travel/buffer time (at least 30 to 60 minutes) between destinations.
   - If the delayed event now ends after or too close to the start time of the next event, THERE IS A CONFLICT.
   - Calculate the new adjusted start and end time for each affected downstream event to prevent overlap.
   - Mark "isCascadeImpact": true if any subsequent event is affected.

3. DRAFT HUMAN-LIKE WHATSAPP NOTICES TO DOWNSTREAM VENDORS:
   - For every downstream vendor whose booking needs to be pushed forward:
     Draft a warm, courteous, and culturally authentic Arabic WhatsApp message written as the DMC Operations Coordinator.
      Requirements for each downstream message:
      - Tone: Professional, warm hospitality style ("السلام عليكم ورحمة الله، حياك الله أخوي [اسم المزود]، معك منسق العمليات في There DMC").
      - Inform them naturally that the group experienced an unexpected delay in their previous tour/activity.
      - State the updated estimated arrival time clearly ("نقّدر وصول الوفد لكم الساعة [الوقت الجديد] بدلاً من [الوقت الأصلي]").
      - Respect traveler privacy: mention group nationality and size, NEVER traveler personal names.
      - Include direct coordination assurance ("نعتذر عن أي إرباك ونقدّر مرونتكم العالية معنا، وسيتم احتساب أي تكاليف إضافية إن وُجدت").

4. DRAFT TRAVELER MULTILINGUAL NOTIFICATION:
   - Draft a reassuring notification directed to the travelers in their native language based on their nationality (${travelerNationality}):
     * If German: German ("Sehr geehrte Gäste...")
     * If Italian: Italian ("Gentili ospiti...")
     * If French: French ("Chers invités...")
     * If Japanese: Japanese ("お客様へ...")
     * If British / American / International: English ("Dear Valued Guests...")
     * If Arab: Formal Arabic ("ضيوفنا الكرام...")
   - Always provide "translatedSummaryInArabic" alongside it for internal DMC records.

Respond ONLY with a valid JSON object matching this schema:
{
  "delayMinutes": 120,
  "incidentType": "delay" | "breakdown" | "traffic" | "weather" | "general",
  "isCascadeImpact": true,
  "incidentSummary": "ملخص تنفيذي بالعربية يوضح سبب التأخير والإجراءات المتخذة لإعادة جدولة اليوم بدون تضارب...",
  "scheduleAdjustments": [
    {
      "eventId": "uuid-here",
      "eventTitle": "عنوان الفعالية",
      "previousStartTime": "14:00",
      "previousEndTime": "17:00",
      "newStartTime": "16:00",
      "newEndTime": "19:00",
      "newStatus": "escalated",
      "reason": "تأخير ساعتين في الفعالية السابقة أدى لترحيل الموعد لضمان عدم التضارب"
    }
  ],
  "downstreamNotices": [
    {
      "eventId": "downstream-event-uuid",
      "providerName": "اسم المزود المتأثر",
      "providerPhone": "رقم الهاتف أو فارغ",
      "newStartTime": "19:30",
      "whatsappMessage": "السلام عليكم ورحمة الله، حياك الله أخوي..."
    }
  ],
  "travelerNotification": {
    "language": "German",
    "flag": "🇩🇪",
    "title": "Tour Schedule Update",
    "message": "Localized message in traveler native language...",
    "translatedSummaryInArabic": "الملخص بالعربية لمنسق الرحلة..."
  }
}`;

    const userPrompt = `رسالة المزود الواردة (النصية أو الصوتية):
"${vendorMessage}"

الفعالية المعنية: "${targetEvent.title || 'الفعالية'}" (الموعد: ${targetEvent.start_time} - ${targetEvent.end_time})
جدول الرحلة الكامل لهذا اليوم:
${scheduleDescription}`;

    const result = await this.llmProvider.generateJson<OrchestrationDecision>({
      systemPrompt,
      userPrompt,
      temperature: 0.1,
    });

    const parsed = result.data;

    return {
      delayMinutes: typeof parsed.delayMinutes === 'number' ? parsed.delayMinutes : 60,
      incidentType: parsed.incidentType || 'delay',
      isCascadeImpact: Boolean(parsed.isCascadeImpact),
      incidentSummary: parsed.incidentSummary || 'تم ترحيل الجدول تلقائياً بالذكاء الاصطناعي لتفادي التضارب.',
      scheduleAdjustments: Array.isArray(parsed.scheduleAdjustments) ? parsed.scheduleAdjustments : [],
      downstreamNotices: Array.isArray(parsed.downstreamNotices) ? parsed.downstreamNotices : [],
      travelerNotification: parsed.travelerNotification || undefined,
    };
  }

  fallbackDecision(params: PlanCascadeParams): OrchestrationDecision {
    const { targetEvent, enrichedEvents, vendorMessage, travelerNationality, groupSize } = params;

    let delayMinutes = 60;
    const numMatch = vendorMessage.match(new RegExp('(\\d+)\\s*(دقيقة|ساعة|ساعات|دقايق|h|hr|min|hours?|mins?)', 'i'));
    if (numMatch) {
      const val = parseInt(numMatch[1], 10);
      const unit = numMatch[2].toLowerCase();
      if (unit.startsWith('ساع') || unit.startsWith('h')) {
        delayMinutes = val * 60;
      } else {
        delayMinutes = val;
      }
    } else if (new RegExp('ساعتين', 'i').test(vendorMessage)) {
      delayMinutes = 120;
    } else if (new RegExp('نص ساعة|نصف ساعة', 'i').test(vendorMessage)) {
      delayMinutes = 30;
    }

    function addMinutesToTime(timeStr: string, mins: number): string {
      const parts = (timeStr || '10:00').split(':').map((v) => parseInt(v, 10));
      const total = (isNaN(parts[0]) ? 10 : parts[0]) * 60 + (isNaN(parts[1]) ? 0 : parts[1]) + mins;
      const capped = Math.min(total, 23 * 60 + 45);
      const newH = Math.floor(capped / 60);
      const newM = capped % 60;
      return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
    }

    function parseToMins(t: string): number {
      const p = (t || '00:00').split(':').map((x) => parseInt(x, 10));
      return (isNaN(p[0]) ? 0 : p[0]) * 60 + (isNaN(p[1]) ? 0 : p[1]);
    }

    const scheduleAdjustments: ScheduleAdjustment[] = [];
    const downstreamNotices: DownstreamVendorNotice[] = [];

    const targetNewStart = addMinutesToTime(targetEvent.start_time, delayMinutes);
    const targetNewEnd = addMinutesToTime(targetEvent.end_time, delayMinutes);

    scheduleAdjustments.push({
      eventId: targetEvent.id,
      eventTitle: targetEvent.title,
      previousStartTime: targetEvent.start_time ? targetEvent.start_time.substring(0, 5) : '10:00',
      previousEndTime: targetEvent.end_time ? targetEvent.end_time.substring(0, 5) : '13:00',
      newStartTime: targetNewStart,
      newEndTime: targetNewEnd,
      newStatus: 'escalated',
      reason: `تأخير تشغيلي قدره ${delayMinutes} دقيقة بناءً على بلاغ المزود عبر واتساب.`,
    });

    const subsequentEvents = enrichedEvents.filter((e) => !e.isTargetEvent && e.order > 1);
    let lastEndTimeMins = parseToMins(targetNewEnd);
    let isCascade = false;

    for (const sub of subsequentEvents) {
      const origStartMins = parseToMins(sub.startTime);
      const origEndMins = parseToMins(sub.endTime);
      const duration = origEndMins - origStartMins;
      const minBuffer = 30;

      if (lastEndTimeMins + minBuffer > origStartMins) {
        isCascade = true;
        const newStartMins = lastEndTimeMins + minBuffer;
        const newEndMins = newStartMins + (duration > 0 ? duration : 120);

        const toTimeStr = (totalMins: number) => {
          const capped = Math.min(totalMins, 23 * 60 + 45);
          const h = Math.floor(capped / 60);
          const m = capped % 60;
          return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        };

        const adjustedStart = toTimeStr(newStartMins);
        const adjustedEnd = toTimeStr(newEndMins);

        scheduleAdjustments.push({
          eventId: sub.eventId,
          eventTitle: sub.title,
          previousStartTime: sub.startTime,
          previousEndTime: sub.endTime,
          newStartTime: adjustedStart,
          newEndTime: adjustedEnd,
          newStatus: 'escalated',
          reason: `ترحيل وقائي لتفادي التضارب مع الفعالية السابقة مع ضمان وقت تنقل لا يقل عن ${minBuffer} دقيقة.`,
        });

        downstreamNotices.push({
          eventId: sub.eventId,
          providerName: sub.providerName,
          providerPhone: sub.providerPhone,
          newStartTime: adjustedStart,
          whatsappMessage: `السلام عليكم ورحمة الله، حياك الله أخوي ${sub.providerName}، معك منسق العمليات في There DMC. نود إبلاغكم بأن الوفد (${travelerNationality} - عدد ${groupSize} أشخاص) واجه تأخيراً في جولته السابقة. يرجى التكرم بتأجيل الموعد ليكون وصولهم المتوقع عند الساعة ${adjustedStart} بإذن الله. نعتذر عن أي إرباك ونقدّر مرونتكم العالية معنا، وسيتم احتساب أي تكاليف إضافية إن وُجدت.`,
        });

        lastEndTimeMins = newEndMins;
      }
    }

    let travelerLanguage = 'English';
    let flag = '🇬🇧';
    let travelerMsg = `Dear Guests, please note your tour today has been adjusted by ${delayMinutes} minutes due to unexpected traffic. We are actively coordinating with your upcoming guides to ensure a seamless experience.`;

    if (new RegExp('german|ألمان|germany', 'i').test(travelerNationality)) {
      travelerLanguage = 'German';
      flag = '🇩🇪';
      travelerMsg = `Sehr geehrte Gäste, bitte beachten Sie, dass Ihr Tagesprogramm verkehrsbedingt um ${delayMinutes} Minuten verschoben wurde. Wir koordinieren alle weiteren Stationen für Sie.`;
    } else if (new RegExp('italian|إيطال|italy', 'i').test(travelerNationality)) {
      travelerLanguage = 'Italian';
      flag = '🇮🇹';
      travelerMsg = `Gentili ospiti, vi informiamo che il برنامج اليوم قد تأخر ${delayMinutes} دقيقة لظروف السير.`;
    } else if (new RegExp('french|فرنس', 'i').test(travelerNationality)) {
      travelerLanguage = 'French';
      flag = '🇫🇷';
      travelerMsg = `Chers invités, votre programme d'aujourd'hui a été décalé de ${delayMinutes} minutes en raison de la circulation.`;
    }

    return {
      delayMinutes,
      incidentType: 'delay',
      isCascadeImpact: isCascade,
      incidentSummary: `تأخير تشغيلي (${delayMinutes} دقيقة) في "${targetEvent.title}". تم تنفيذ حل وقائي ${isCascade ? 'وترحيل الفعاليات اللاحقة لتفادي أي تداخل' : 'بدون تأثير على باقي الفعاليات'}.`,
      scheduleAdjustments,
      downstreamNotices,
      travelerNotification: {
        language: travelerLanguage,
        flag,
        title: 'Schedule Update',
        message: travelerMsg,
        translatedSummaryInArabic: `إشعار الضيوف بلغتهم (${travelerLanguage}) بتأخير ${delayMinutes} دقيقة مع تأكيد سير باقي اليوم بانتظام.`,
      },
    };
  }
}
