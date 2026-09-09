/**
 * Arabic (ar-SA) translation dictionary.
 * All static UI strings live here for single-source-of-truth localisation.
 */

const ar = {
  // ─── App Shell ─────────────────────────────────────────────
  meta: {
    title: 'There DMC — أداة بناء الرحلات الذكية',
    description: 'أداة بناء رحلات مدعومة بالذكاء الاصطناعي لشركات إدارة الوجهات السعودية',
  },

  header: {
    title: 'مُنشئ الرحلات',
    loadingTraveler: 'جارٍ تحميل بيانات المسافر...',
    saveItinerary: 'حفظ الرحلة',
  },

  // ─── Traveler Profile Sidebar ──────────────────────────────
  sidebar: {
    title: 'الملف الشخصي للمسافر',
    noProfile: 'لم يتم تحميل ملف مسافر.',
    groupSize: 'حجم المجموعة',
    guests: 'ضيوف',
    budgetTier: 'فئة الميزانية',
    dates: 'التواريخ',
    interests: 'الاهتمامات',
    dietary: 'القيود الغذائية',
    mobilityNote: 'ملاحظة التنقل',
  },

  // ─── Timeline ──────────────────────────────────────────────
  timeline: {
    title: 'الجدول الزمني للرحلة',
    events: 'فعاليات',
    noEvents: 'لا توجد فعاليات مجدولة بعد',
    noEventsCta: '← أضف تجارب من لوحة التوصيات الذكية',
  },

  // ─── Smart Match Panel ─────────────────────────────────────
  smartMatch: {
    title: 'التوصيات الذكية',
    subtitle: 'مُرتبة بالذكاء الاصطناعي',
    match: 'تطابق',
    addToItinerary: 'أضف إلى الرحلة',
  },

  // ─── Statuses ──────────────────────────────────────────────
  status: {
    draft: 'مسودة',
    confirmed: 'مؤكد',
    planned: 'مخطط',
    cancelled: 'ملغي',
    escalated: 'تم التصعيد',
    in_progress: 'قيد التنفيذ',
    completed: 'مكتمل',
  } as Record<string, string>,

  // ─── Verification Statuses ─────────────────────────────────
  verification: {
    verified: 'موثق',
    pending: 'قيد المراجعة',
    rejected: 'مرفوض',
  } as Record<string, string>,

  // ─── Budget Tiers ──────────────────────────────────────────
  budget: {
    economy: 'اقتصادي',
    standard: 'عادي',
    premium: 'مميز',
    luxury: 'فاخر',
  } as Record<string, string>,

  // ─── Warning Messages ─────────────────────────────────────
  warnings: {
    schedulingConflict: 'تم اكتشاف تعارض في الجدول',
    capacityConcern: 'ملاحظة حول السعة',
    accessibilityNote: 'ملاحظة حول إمكانية الوصول',
  },
} as const;

export default ar;
