const ARABIC_MONTHS = [
  'يناير',
  'فبراير',
  'مارس',
  'أبريل',
  'مايو',
  'يونيو',
  'يوليو',
  'أغسطس',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
];

const ARABIC_DAYS = [
  'الأحد',
  'الاثنين',
  'الثلاثاء',
  'الأربعاء',
  'الخميس',
  'الجمعة',
  'السبت',
];

export function formatArabicDate(iso: string): string {
  if (!iso) return '';
  const parts = iso.split('-');
  if (parts.length < 3) return iso;

  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);

  if (isNaN(month) || isNaN(day) || month < 1 || month > 12) {
    return iso;
  }

  return `${day} ${ARABIC_MONTHS[month - 1]}`;
}

export function formatArabicDateHeading(iso: string): string {
  if (!iso) return '';
  const parts = iso.split('-');
  if (parts.length < 3) return iso;

  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);

  if (isNaN(year) || isNaN(month) || isNaN(day)) {
    return iso;
  }

  const d = new Date(Date.UTC(year, month - 1, day));
  const weekday = ARABIC_DAYS[d.getUTCDay()];

  return `${weekday}، ${day} ${ARABIC_MONTHS[month - 1]}`;
}

export function formatArabicDateRange(start: string, end: string): string {
  if (!start || !end) return '';
  return `${formatArabicDate(start)} – ${formatArabicDate(end)}`;
}
