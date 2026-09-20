import type { ItineraryEvent, ScheduleWarning, TravelerProfile } from '@/types/itinerary';

export function detectScheduleWarnings(
  events: ItineraryEvent[],
  profile?: TravelerProfile | null
): ScheduleWarning[] {
  const warnings: ScheduleWarning[] = [];

  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      const e1 = events[i];
      const e2 = events[j];
      if (e1.eventDate === e2.eventDate && e1.status !== 'cancelled' && e2.status !== 'cancelled') {
        const start1 = e1.startTime;
        const end1 = e1.endTime;
        const start2 = e2.startTime;
        const end2 = e2.endTime;

        if (start1 < end2 && start2 < end1) {
          warnings.push({
            id: `conflict-${e1.id}-${e2.id}`,
            severity: 'error',
            title: 'تم اكتشاف تعارض في الجدول',
            message: `فعالية "${e1.title}" (${start1}–${end1}) تتعارض مع "${e2.title}" (${start2}–${end2}) بتاريخ ${e1.eventDate}.`,
            relatedEventIds: [e1.id, e2.id],
          });
        }
      }
    }
  }

  for (const ev of events) {
    if (ev.status === 'escalated') {
      const reasonText = ev.escalationReason || 'تأخير في الموعد أو طارئ يتطلب تدخل فريق العمليات';
      warnings.push({
        id: `escalated-${ev.id}`,
        severity: 'error',
        title: `تنبيه تصعيد تشغيلي عاجل (واتساب) — ${ev.title}`,
        message: `تم استلام بلاغ صوتي عاجل من المزود/المرشد بشأن هذه الفعالية (${ev.eventDate} | ${ev.startTime}–${ev.endTime}).`,
        detail: reasonText,
        relatedEventIds: [ev.id],
      });
    }
  }

  if (profile?.groupSize) {
    for (const ev of events) {
      if (ev.status === 'cancelled') continue;
      const cap = ev.provider?.capacity;
      if (!cap) continue;

      if (profile.groupSize > cap) {
        warnings.push({
          id: `cap-exceeded-${ev.id}`,
          severity: 'error',
          title: 'تجاوز السعة الاستيعابية للمزود',
          message: `${ev.provider?.name || ev.title}: السعة القصوى للمزود (${cap} ضيوف) أقل من عدد أفراد مجموعتكم (${profile.groupSize} أفراد).`,
          relatedEventIds: [ev.id],
        });
      } else if (cap - profile.groupSize <= 2 && cap <= 10) {
        warnings.push({
          id: `cap-tight-${ev.id}`,
          severity: 'warning',
          title: 'ملاحظة حول السعة الاستيعابية',
          message: `${ev.provider?.name || ev.title}: السعة القصوى ${cap} ضيوف — مجموعتكم المكونة من ${profile.groupSize} أفراد تترك هامشاً بسيطاً للمرشدين والمرافقين (${cap - profile.groupSize} مقاعد متبقية).`,
          relatedEventIds: [ev.id],
        });
      }
    }
  }

  if (profile?.mobilityNotes) {
    const hasMobilityConstraint = /كرسي|كراسي|تنقل|إعاقة|مريح|wheelchair|mobility/i.test(
      profile.mobilityNotes
    );

    if (hasMobilityConstraint) {
      for (const ev of events) {
        if (ev.status === 'cancelled') continue;
        const searchable = `${ev.title} ${ev.description || ''} ${ev.provider?.experienceType || ''}`;
        const isRuggedTerrain = /صحراو|سفاري|الحِجر|تضاريس|رمل|تسلق|وعر/i.test(searchable);

        if (isRuggedTerrain) {
          warnings.push({
            id: `access-${ev.id}`,
            severity: 'info',
            title: 'ملاحظة حول إمكانية الوصول',
            message: `تنبيه خاص بالزائر (${profile.name}): فعالية "${ev.title}" تقع في منطقة ذات تضاريس قد تتطلب ترتيبات مسبقة لملاءمة متطلبات التنقل (${profile.mobilityNotes}).`,
            relatedEventIds: [ev.id],
          });
        }
      }
    }
  }

  return warnings;
}
