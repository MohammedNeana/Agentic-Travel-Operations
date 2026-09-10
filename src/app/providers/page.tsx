'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  Sparkles,
  Search,
  Building2,
  Users,
  MapPin,
  CheckCircle2,
  Clock,
  Send,
  PlusCircle,
  FileText,
  RefreshCw,
  SlidersHorizontal,
  Phone,
} from 'lucide-react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import ar from '@/lib/i18n/ar';

interface ExperienceProviderItem {
  id: string;
  tenant_id: string;
  name: string;
  city: string;
  experience_type: string;
  capacity: number | null;
  verification_status: 'pending' | 'verified' | 'rejected';
  phone_number?: string | null;
  created_at: string;
}

const SAMPLE_PROVIDER_TEXTS = [
  'مخيم نجوم العلا الفاخر في قلب وادي عِشار. نقدم تجارب مراقبة النجوم مع فلكيين سعوديين معتمدين، وحفلات عشاء تراثية خاصة تحت ضوء القمر. السعة الاستيعابية للمخيم حتى 25 ضيفاً مع خدمة نقل خاصة بدفع رباعي. للحجز والاستفسار عبر واتساب: +966501234567',
  'فريق دروب عسير للمغامرات الجبلية في أبها. تنظيم مسارات هايكنج احترافية في جبال السودة ووادي لجب، مع إرشاد سياحي محلي ووجبات عسيرية شعبية. السعة اليومية 15 مغامراً. للتواصل واتساب: 0558765432',
  'جولات جدة التاريخية الأصيلة. رحلات استكشافية ثقافية في حارة المظلوم وسوق العلوي مع مرشدين تراثيين مرخصين، وزيارة البيوت التاريخية وتذوق المأكولات الحجازية. سعة الجولة 12 شخصاً. هاتف وواتساب: +966549871234',
];

export default function ProvidersPage() {
  const [providers, setProviders] = useState<ExperienceProviderItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [tenantId, setTenantId] = useState<string>('a1b2c3d4-0001-4000-8000-000000000001');

  // Discovery Form State
  const [rawText, setRawText] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionResult, setExtractionResult] = useState<ExperienceProviderItem | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCity, setSelectedCity] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');

  // Load providers from Supabase
  const loadProviders = async (tId: string) => {
    setIsLoading(true);
    try {
      const supabase = createBrowserSupabaseClient();
      const { data, error } = await supabase
        .from('experience_providers')
        .select('id, tenant_id, name, city, experience_type, capacity, verification_status, phone_number, created_at')
        .eq('tenant_id', tId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching providers:', error);
      } else if (data) {
        setProviders(data as ExperienceProviderItem[]);
      }
    } catch (err) {
      console.error('Unexpected error loading providers:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      const activeTenant = session?.user?.user_metadata?.tenant_id || 'a1b2c3d4-0001-4000-8000-000000000001';
      setTenantId(activeTenant);
      loadProviders(activeTenant);
    });
  }, []);

  // Handle Discovery Submission
  const handleDiscoverSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rawText.trim()) return;

    setIsExtracting(true);
    setFormError(null);
    setExtractionResult(null);

    try {
      const response = await fetch('/api/providers/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text_content: rawText.trim(),
          tenant_id: tenantId,
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'فشل في استخراج بيانات المزود.');
      }

      const newProvider = result.provider as ExperienceProviderItem;
      setExtractionResult(newProvider);
      setRawText('');

      // Prepend to current list
      setProviders((prev) => [newProvider, ...prev.filter((p) => p.id !== newProvider.id)]);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'حدث خطأ أثناء الاستخراج.');
    } finally {
      setIsExtracting(false);
    }
  };

  // Distinct cities for filter
  const cities = useMemo(() => {
    const unique = Array.from(new Set(providers.map((p) => p.city).filter(Boolean)));
    return unique;
  }, [providers]);

  // Filtered providers
  const filteredProviders = useMemo(() => {
    return providers.filter((provider) => {
      const matchesSearch =
        searchQuery === '' ||
        provider.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        provider.experience_type.toLowerCase().includes(searchQuery.toLowerCase()) ||
        provider.city.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesCity = selectedCity === 'all' || provider.city === selectedCity;
      const matchesStatus =
        selectedStatus === 'all' || provider.verification_status === selectedStatus;

      return matchesSearch && matchesCity && matchesStatus;
    });
  }, [providers, searchQuery, selectedCity, selectedStatus]);

  return (
    <div className="min-h-screen bg-gray-50/50 pb-16">
      {/* Top Header */}
      <div className="bg-white border-b border-gray-100 py-6">
        <div className="mx-auto max-w-screen-2xl px-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <div className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
                  <Sparkles className="h-4 w-4" />
                </span>
                <h1 className="text-xl font-bold tracking-tight text-gray-900">
                  محرك استكشاف وتوثيق مزودي التجارب (The Sourcing Engine)
                </h1>
              </div>
              <p className="mt-1 text-xs text-gray-500 font-medium">
                استخراج بيانات مزودي التجارب المحليين غير المهيكلين بالذكاء الاصطناعي وتوليد التضمين الشعاعي (pgvector)
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => loadProviders(tenantId)}
                className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-all cursor-pointer shadow-xs"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                <span>تحديث القائمة</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-screen-2xl px-6 pt-6 space-y-6">
        {/* Sourcing Form Card */}
        <div className="rounded-2xl border border-violet-100 bg-linear-to-b from-violet-50/40 to-white p-6 shadow-xs">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <div className="flex items-center gap-2">
                <PlusCircle className="h-4 w-4 text-violet-600" />
                <h2 className="text-sm font-bold text-gray-900">
                  إدخال مزود تجارب جديد (استخراج ذكي عبر الذكاء الاصطناعي)
                </h2>
              </div>
              <p className="mt-0.5 text-xs text-gray-500">
                ألصق نصاً غير مهيكل (منشور إنستغرام، رسالة واتساب، نبذة تعريفية) وسيتولى النموذج استخراج الاسم والمدينة ونوع التجربة والسعة وتوليد التضمين الشعاعي آلياً.
              </p>
            </div>

            {/* Quick Samples */}
            <div className="hidden lg:flex items-center gap-2">
              <span className="text-[11px] font-bold text-gray-400">أمثلة سريعة:</span>
              {SAMPLE_PROVIDER_TEXTS.map((sample, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setRawText(sample)}
                  className="rounded-lg bg-white border border-gray-200 px-2.5 py-1 text-[10px] font-semibold text-gray-600 hover:border-violet-300 hover:text-violet-700 transition-colors cursor-pointer"
                >
                  مثال {idx + 1}
                </button>
              ))}
            </div>
          </div>

          <form onSubmit={handleDiscoverSubmit} className="space-y-3">
            <div className="relative">
              <textarea
                rows={3}
                required
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                placeholder="مثال: جولات واحة العلا التراثية. ننظم تجارب قطف التمور والمشي بين مزارع الحمضيات مع عوائل العلا، تذوق القهوة السعودية والحلويات التراثية. السعة 18 ضيفاً..."
                className="w-full rounded-xl border border-gray-200 bg-white p-3.5 text-xs leading-relaxed text-gray-900 placeholder:text-gray-400 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 shadow-xs"
              />
            </div>

            {formError && (
              <div className="rounded-xl bg-red-50 p-3 text-xs font-semibold text-red-700 border border-red-200">
                {formError}
              </div>
            )}

            {extractionResult && (
              <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    <span className="text-xs font-bold text-emerald-900">
                      تم استخراج المزود وحفظ التضمين الشعاعي بنجاح!
                    </span>
                  </div>
                  <span className="rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2.5 py-0.5">
                    1536 أبعاد (pgvector)
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-1 text-xs">
                  <div>
                    <span className="text-[10px] text-emerald-600 block">اسم المزود:</span>
                    <strong className="text-gray-900">{extractionResult.name}</strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-emerald-600 block">المدينة:</span>
                    <strong className="text-gray-900">{extractionResult.city}</strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-emerald-600 block">نوع التجربة:</span>
                    <strong className="text-gray-900">{extractionResult.experience_type}</strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-emerald-600 block">السعة:</span>
                    <strong className="text-gray-900">{extractionResult.capacity ?? 'مرن'} ضيوف</strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-emerald-600 block">رقم الواتساب:</span>
                    <strong className="text-gray-900 font-mono" dir="ltr">
                      {extractionResult.phone_number || 'غير متوفر'}
                    </strong>
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={isExtracting || !rawText.trim()}
                className="flex items-center gap-2 rounded-xl bg-gray-900 px-5 py-2.5 text-xs font-bold text-white shadow-xs hover:bg-gray-800 transition-all cursor-pointer disabled:opacity-50"
              >
                {isExtracting ? (
                  <>
                    <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    <span>جارٍ الاستخراج والتضمين الشعاعي...</span>
                  </>
                ) : (
                  <>
                    <Send className="h-3.5 w-3.5" />
                    <span>استخراج وإضافة المزود</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>

        {/* Directory Header & Filters */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pt-2">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-gray-700" />
            <h2 className="text-sm font-bold text-gray-900">
              دليل مزودي التجارب المسجلين في المنظمة ({filteredProviders.length})
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Search */}
            <div className="relative">
              <Search className="absolute inset-y-0 start-0 ps-3 flex items-center pointer-events-none h-4 w-4 text-gray-400 my-auto" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="بحث بالاسم أو نوع التجربة..."
                className="rounded-xl border border-gray-200 bg-white ps-8 pe-3 py-1.5 text-xs font-medium focus:border-violet-500 focus:ring-1 focus:ring-violet-500 shadow-xs"
              />
            </div>

            {/* City Filter */}
            <select
              value={selectedCity}
              onChange={(e) => setSelectedCity(e.target.value)}
              className="rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium focus:border-violet-500 shadow-xs cursor-pointer"
            >
              <option value="all">جميع المدن</option>
              {cities.map((city) => (
                <option key={city} value={city}>
                  {city}
                </option>
              ))}
            </select>

            {/* Status Filter */}
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium focus:border-violet-500 shadow-xs cursor-pointer"
            >
              <option value="all">جميع الحالات</option>
              <option value="verified">موثق</option>
              <option value="pending">قيد المراجعة</option>
              <option value="rejected">مرفوض</option>
            </select>
          </div>
        </div>

        {/* Providers Grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-40 rounded-2xl border border-gray-100 bg-white p-5 animate-pulse"
              />
            ))}
          </div>
        ) : filteredProviders.length === 0 ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-12 text-center">
            <FileText className="h-8 w-8 text-gray-300 mx-auto mb-2" />
            <h3 className="text-sm font-bold text-gray-900">لا يوجد مزودو تجارب مطابقون</h3>
            <p className="text-xs text-gray-500 mt-1">
              قم بإدخال بيانات مزود جديد عبر النموذج أعلاه، أو عدّل خيارات البحث والتصفية.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredProviders.map((provider) => (
              <div
                key={provider.id}
                className="rounded-2xl border border-gray-100 bg-white p-5 shadow-xs hover:border-violet-200 hover:shadow-md transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <h3 className="text-sm font-bold text-gray-900 line-clamp-1">
                        {provider.name}
                      </h3>
                      {provider.verification_status === 'verified' && (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                      )}
                    </div>

                    <span
                      className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        provider.verification_status === 'verified'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : provider.verification_status === 'pending'
                            ? 'bg-amber-50 text-amber-700 border border-amber-200'
                            : 'bg-red-50 text-red-700 border border-red-200'
                      }`}
                    >
                      {provider.verification_status === 'verified' ? (
                        <CheckCircle2 className="h-3 w-3" />
                      ) : (
                        <Clock className="h-3 w-3" />
                      )}
                      {ar.verification[provider.verification_status] ?? provider.verification_status}
                    </span>
                  </div>

                  <div className="mt-2.5 flex items-center gap-3 text-xs text-gray-500">
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3.5 w-3.5 text-gray-400" />
                      <span>{provider.city}</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <Users className="h-3.5 w-3.5 text-gray-400" />
                      <span>{provider.capacity ? `${provider.capacity} ضيوف` : 'سعة مرنة'}</span>
                    </span>
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-2 flex-wrap">
                    <span className="inline-block rounded-lg bg-gray-100 px-2.5 py-1 text-[11px] font-semibold text-gray-700">
                      {provider.experience_type}
                    </span>

                    {provider.phone_number ? (
                      <a
                        href={`https://wa.me/${provider.phone_number.replace(/[^\d]/g, '')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 border border-emerald-200/80 hover:bg-emerald-100 transition-colors cursor-pointer group"
                        title="مراسلة المزود مباشرة عبر واتساب"
                      >
                        <svg className="h-3 w-3 fill-emerald-600 shrink-0" viewBox="0 0 24 24">
                          <path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.582 2.128 2.182-.573c.978.58 1.911.928 3.145.929 3.178 0 5.767-2.587 5.768-5.766.001-3.187-2.575-5.77-5.764-5.771zm3.392 8.244c-.144.405-.837.774-1.17.824-.299.045-.677.063-1.092-.069-.252-.08-.575-.187-.988-.365-1.739-.751-2.874-2.502-2.961-2.617-.087-.116-.708-.94-.708-1.793s.448-1.273.607-1.446c.159-.173.346-.217.462-.217l.332.006c.106.005.249-.04.39.298.144.347.491 1.2.534 1.287.043.087.072.188.014.303-.058.116-.087.188-.173.289l-.26.303c-.087.087-.177.181-.076.355.101.173.449.742.964 1.201.662.591 1.221.774 1.394.861.173.086.275.072.376-.044.101-.116.433-.506.549-.68.116-.173.231-.145.39-.087s1.011.477 1.184.564.289.13.332.203c.043.071.043.419-.101.824zM12 2C6.477 2 2 6.477 2 12c0 1.891.526 3.66 1.438 5.168L2 22l4.98-1.306A9.957 9.957 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18.167c-1.609 0-3.12-.489-4.385-1.326l-.314-.209-2.95.774.787-2.875-.231-.368A8.136 8.136 0 013.833 12c0-4.503 3.664-8.167 8.167-8.167 4.503 0 8.167 3.664 8.167 8.167 0 4.503-3.664 8.167-8.167 8.167z"/>
                        </svg>
                        <span className="font-mono text-[11px]" dir="ltr">{provider.phone_number}</span>
                      </a>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] text-gray-400 bg-gray-50 px-2 py-0.5 rounded-md border border-gray-100">
                        <Phone className="h-2.5 w-2.5 text-gray-300" />
                        <span>لا يوجد هاتف</span>
                      </span>
                    )}
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between text-[10px] text-gray-400">
                  <span>
                    أضيف بتاريخ: {new Date(provider.created_at).toLocaleDateString('ar-SA')}
                  </span>
                  <span className="font-mono text-gray-300">pgvector: 1536d</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
