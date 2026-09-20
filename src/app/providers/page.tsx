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
  Phone,
  Globe,
  Bot,
  Compass,
  ExternalLink,
  ShieldCheck,
  Map,
  ArrowRight,
  Filter,
  Trash2,
  Check,
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

export default function ProvidersPage() {
  const [providers, setProviders] = useState<ExperienceProviderItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [tenantId, setTenantId] = useState<string>('');

  const dynamicSuggestions = useMemo(() => {
    const set = new Set<string>();
    for (const p of providers) {
      if (p.experience_type && p.city) {
        set.add(`${p.experience_type} في ${p.city}`);
      }
    }
    return Array.from(set).slice(0, 4);
  }, [providers]);

  const [sourcingMode, setSourcingMode] = useState<'auto' | 'url' | 'text'>('auto');

  const [autoSearchQuery, setAutoSearchQuery] = useState('');
  const [isAutoSearching, setIsAutoSearching] = useState(false);
  const [autoSearchStep, setAutoSearchStep] = useState<string>('');
  const [autoSearchResult, setAutoSearchResult] = useState<{
    count: number;
    providers: ExperienceProviderItem[];
    urls_scraped: string[];
  } | null>(null);
  const [autoSearchError, setAutoSearchError] = useState<string | null>(null);

  const [discoveryUrl, setDiscoveryUrl] = useState('');
  const [rawText, setRawText] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionResult, setExtractionResult] = useState<ExperienceProviderItem | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCity, setSelectedCity] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  const loadProviders = async (tId: string) => {
    setIsLoading(true);
    try {
      const supabase = createBrowserSupabaseClient();
      const { data, error } = await supabase
        .from('experience_providers')
        .select('id, tenant_id, name, city, experience_type, capacity, verification_status, phone_number, created_at')
        .eq('tenant_id', tId)
        .order('created_at', { ascending: false });

      if (data && !error) {
        setProviders(data as ExperienceProviderItem[]);
      }
    } catch {
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      let activeTenant = session?.user?.user_metadata?.tenant_id;
      if (!activeTenant) {
        const { data: org } = await supabase
          .from('organizations')
          .select('tenant_id')
          .limit(1)
          .maybeSingle();
        activeTenant = org?.tenant_id;
      }
      if (activeTenant) {
        setTenantId(activeTenant);
        loadProviders(activeTenant);
      } else {
        setIsLoading(false);
      }
    });
  }, []);

  const handleAutoSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!autoSearchQuery.trim() || isAutoSearching) return;

    setIsAutoSearching(true);
    setAutoSearchError(null);
    setAutoSearchResult(null);
    setAutoSearchStep('جارٍ البحث في الويب عن أفضل مزودي التجارب...');

    const t1 = setTimeout(() => {
      setAutoSearchStep('تم العثور على الروابط. جارٍ كشط الصفحات وتتبع الهواتف...');
    }, 3000);

    const t2 = setTimeout(() => {
      setAutoSearchStep('جارٍ التحليل والاستخراج بذكاء اصطناعي حقيقي (Groq LLM)...');
    }, 6500);

    const t3 = setTimeout(() => {
      setAutoSearchStep('جارٍ توليد التضمين الشعاعي (384d) وتثبيت المزودين في قاعدة البيانات...');
    }, 10000);

    try {
      const response = await fetch('/api/providers/auto-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: autoSearchQuery.trim(),
          tenant_id: tenantId,
          max_results: 3,
        }),
      });

      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'تعذر استكمال عملية البحث المستقل.');
      }

      const newProviders = (result.providers || []) as ExperienceProviderItem[];
      setAutoSearchResult({
        count: result.count || newProviders.length,
        providers: newProviders,
        urls_scraped: result.urls_scraped || [],
      });

      if (newProviders.length > 0) {
        const newIds = new Set(newProviders.map((p) => p.id));
        setProviders((prev) => [...newProviders, ...prev.filter((p) => !newIds.has(p.id))]);
      }
    } catch (err: unknown) {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      setAutoSearchError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع أثناء البحث التلقائي.');
    } finally {
      setIsAutoSearching(false);
      setAutoSearchStep('');
    }
  };

  const handleDirectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const hasUrl = sourcingMode === 'url' && discoveryUrl.trim();
    const hasText = sourcingMode === 'text' && rawText.trim();

    if (!hasUrl && !hasText) return;

    setIsExtracting(true);
    setFormError(null);
    setExtractionResult(null);

    try {
      const payload: Record<string, string> = { tenant_id: tenantId };
      if (hasUrl) payload.url = discoveryUrl.trim();
      if (hasText) payload.text_content = rawText.trim();

      const response = await fetch('/api/providers/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'فشل في استخراج بيانات المزود.');
      }

      const newProvider = result.provider as ExperienceProviderItem;
      setExtractionResult(newProvider);
      setDiscoveryUrl('');
      setRawText('');

      setProviders((prev) => [newProvider, ...prev.filter((p) => p.id !== newProvider.id)]);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'حدث خطأ أثناء الاستخراج.');
    } finally {
      setIsExtracting(false);
    }
  };

  const handleApproveProvider = async (id: string) => {
    try {
      setActionLoadingId(id);
      const supabase = createBrowserSupabaseClient();
      const { error } = await supabase
        .from('experience_providers')
        .update({ verification_status: 'verified' })
        .eq('id', id);

      if (error) {
        alert('فشل في اعتماد المزود: ' + error.message);
        return;
      }

      setProviders((prev) =>
        prev.map((p) => (p.id === id ? { ...p, verification_status: 'verified' } : p))
      );
    } catch {
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleDeleteProvider = async (id: string, name: string) => {
    if (!window.confirm(`هل أنت متأكد من حذف المزود "${name}" نهائياً من قاعدة البيانات؟`)) {
      return;
    }

    try {
      setActionLoadingId(id);
      const supabase = createBrowserSupabaseClient();
      const { error } = await supabase
        .from('experience_providers')
        .delete()
        .eq('id', id);

      if (error) {
        alert('فشل في حذف المزود: ' + error.message);
        return;
      }

      setProviders((prev) => prev.filter((p) => p.id !== id));
    } catch {
    } finally {
      setActionLoadingId(null);
    }
  };

  const cities = useMemo(() => {
    const unique = Array.from(new Set(providers.map((p) => p.city).filter(Boolean)));
    return unique;
  }, [providers]);

  const stats = useMemo(() => {
    return {
      total: providers.length,
      verified: providers.filter((p) => p.verification_status === 'verified').length,
      pending: providers.filter((p) => p.verification_status === 'pending').length,
      citiesCount: cities.length,
    };
  }, [providers, cities]);

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
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-20">
      <div className="bg-white border-b border-slate-200/80">
        <div className="mx-auto max-w-7xl px-6 py-6">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
            <div>
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-900 text-white shadow-xs">
                  <Sparkles className="h-4 w-4" />
                </span>
                <h1 className="text-xl font-bold tracking-tight text-slate-900">
                  محرك استكشاف وتوثيق مزودي التجارب
                </h1>
                <span className="hidden sm:inline-flex items-center rounded-md bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
                  The Sourcing Engine
                </span>
              </div>
              <p className="mt-1.5 text-xs text-slate-500 font-medium leading-relaxed">
                استكشاف آلي ذكي في الويب، كشط المواقع وتتبع الهواتف، واستخراج البيانات غير المهيكلة بالذكاء الاصطناعي مع التضمين الشعاعي 384d.
              </p>
            </div>

            <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
              <div className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2">
                <Building2 className="h-4 w-4 text-slate-400" />
                <div>
                  <div className="text-[10px] text-slate-400 font-medium">إجمالي المزودين</div>
                  <div className="text-sm font-bold text-slate-900">{stats.total}</div>
                </div>
              </div>

              <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200/80 bg-emerald-50/40 px-3.5 py-2">
                <ShieldCheck className="h-4 w-4 text-emerald-600" />
                <div>
                  <div className="text-[10px] text-emerald-600 font-medium">موثقون</div>
                  <div className="text-sm font-bold text-emerald-900">{stats.verified}</div>
                </div>
              </div>

              <div className="flex items-center gap-2.5 rounded-xl border border-amber-200/80 bg-amber-50/40 px-3.5 py-2">
                <Clock className="h-4 w-4 text-amber-600" />
                <div>
                  <div className="text-[10px] text-amber-600 font-medium">قيد المراجعة</div>
                  <div className="text-sm font-bold text-amber-900">{stats.pending}</div>
                </div>
              </div>

              <div className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2">
                <Map className="h-4 w-4 text-slate-400" />
                <div>
                  <div className="text-[10px] text-slate-400 font-medium">الوجهات المغطاة</div>
                  <div className="text-sm font-bold text-slate-900">{stats.citiesCount}</div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => loadProviders(tenantId)}
                className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer shadow-xs"
                title="تحديث البيانات"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin text-slate-900' : 'text-slate-500'}`} />
                <span className="hidden sm:inline">تحديث</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 pt-6 space-y-6">
        <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-100">
            <div>
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-slate-100 text-slate-800">
                  <Bot className="h-3.5 w-3.5" />
                </span>
                <span>وحدة استكشاف المزودين الذكية (Sourcing Console)</span>
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                اختر طريقة الاستكشاف المناسبة: بحث ويب مستقل، كشط مباشر من رابط، أو استخراج من نص حر.
              </p>
            </div>

            <div className="flex items-center rounded-xl bg-slate-100 p-1 text-xs font-semibold self-start sm:self-auto">
              <button
                type="button"
                onClick={() => setSourcingMode('auto')}
                className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 transition-all cursor-pointer ${
                  sourcingMode === 'auto'
                    ? 'bg-white text-slate-900 shadow-xs font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Compass className="h-3.5 w-3.5" />
                <span>بحث ويب ذكي (Autonomous)</span>
              </button>

              <button
                type="button"
                onClick={() => setSourcingMode('url')}
                className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 transition-all cursor-pointer ${
                  sourcingMode === 'url'
                    ? 'bg-white text-slate-900 shadow-xs font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Globe className="h-3.5 w-3.5" />
                <span>استكشاف من رابط</span>
              </button>

              <button
                type="button"
                onClick={() => setSourcingMode('text')}
                className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 transition-all cursor-pointer ${
                  sourcingMode === 'text'
                    ? 'bg-white text-slate-900 shadow-xs font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <FileText className="h-3.5 w-3.5" />
                <span>إدخال نص حر</span>
              </button>
            </div>
          </div>

          {sourcingMode === 'auto' && (
            <div className="pt-5 space-y-4">
              <form onSubmit={handleAutoSearchSubmit} className="space-y-3">
                <div className="flex flex-col sm:flex-row gap-2.5">
                  <div className="relative flex-1">
                    <div className="pointer-events-none absolute inset-y-0 start-0 ps-3.5 flex items-center">
                      <Search className="h-4 w-4 text-slate-400" />
                    </div>
                    <input
                      type="text"
                      value={autoSearchQuery}
                      onChange={(e) => setAutoSearchQuery(e.target.value)}
                      placeholder="اكتب استعلام البحث باللغة الطبيعية (مثال: Find stargazing camps in AlUla أو رحلات غوص في جدة)..."
                      disabled={isAutoSearching}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50/50 ps-10 pe-4 py-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:bg-white focus:ring-1 focus:ring-slate-900 transition-all shadow-2xs"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isAutoSearching || !autoSearchQuery.trim()}
                    className="flex items-center justify-center gap-2 rounded-xl bg-slate-900 hover:bg-slate-800 active:bg-black px-6 py-3 text-xs font-bold text-white shadow-xs transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                  >
                    {isAutoSearching ? (
                      <>
                        <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                        <span>جارٍ الاستكشاف...</span>
                      </>
                    ) : (
                      <>
                        <Compass className="h-3.5 w-3.5" />
                        <span>ابحث واستكشف (Search & Discover)</span>
                      </>
                    )}
                  </button>
                </div>

                {dynamicSuggestions.length > 0 && (
                  <div className="flex items-center gap-2 flex-wrap pt-1">
                    <span className="text-[11px] font-semibold text-slate-400">اقتراحات من المزودين الحاليين:</span>
                    {dynamicSuggestions.map((sugg, idx) => (
                      <button
                        key={idx}
                        type="button"
                        disabled={isAutoSearching}
                        onClick={() => setAutoSearchQuery(sugg)}
                        className="rounded-lg bg-slate-100 hover:bg-slate-200/80 px-2.5 py-1 text-[11px] font-medium text-slate-700 transition-colors cursor-pointer"
                      >
                        {sugg}
                      </button>
                    ))}
                  </div>
                )}

                {isAutoSearching && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-900 border-t-transparent" />
                        <span className="text-xs font-bold text-slate-900">
                          {autoSearchStep || 'جارٍ تنفيذ دورة البحث التلقائية عبر الويب...'}
                        </span>
                      </div>
                      <span className="text-[11px] font-mono text-slate-400">10–15 ثانية</span>
                    </div>

                    <div className="grid grid-cols-4 gap-2 pt-1 text-[10px] font-medium text-slate-400 text-center">
                      <div className="rounded-md bg-white border border-slate-200 py-1 text-slate-800 font-semibold">
                        1. استعلام الويب
                      </div>
                      <div className="rounded-md bg-white border border-slate-200 py-1 text-slate-800 font-semibold">
                        2. كشط المواقع والهواتف
                      </div>
                      <div className="rounded-md bg-white border border-slate-200 py-1 text-slate-800 font-semibold">
                        3. استخراج البيانات (Groq)
                      </div>
                      <div className="rounded-md bg-white border border-slate-200 py-1 text-slate-800 font-semibold">
                        4. التضمين الشعاعي 384d
                      </div>
                    </div>
                  </div>
                )}

                {autoSearchError && (
                  <div className="rounded-xl bg-red-50 border border-red-200 p-3.5 text-xs font-semibold text-red-700">
                    {autoSearchError}
                  </div>
                )}

                {autoSearchResult && (
                  <div className="rounded-xl bg-emerald-50/60 border border-emerald-200 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        <span className="text-xs font-bold text-emerald-900">
                          اكتملت دورة البحث المستقل! تم استخراج وتوثيق {autoSearchResult.count} مزود تجارب وحفظهم في قاعدة البيانات.
                        </span>
                      </div>
                      <span className="rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2.5 py-0.5">
                        384 أبعاد (Local pgvector)
                      </span>
                    </div>

                    {autoSearchResult.urls_scraped && autoSearchResult.urls_scraped.length > 0 && (
                      <div className="pt-1">
                        <span className="text-[10px] text-emerald-700 font-medium block mb-1">
                          المواقع والصفحات التي قام الوكيل بكشطها وتحليلها:
                        </span>
                        <div className="flex flex-wrap gap-2">
                          {autoSearchResult.urls_scraped.map((u, i) => (
                            <a
                              key={i}
                              href={u}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 rounded-lg bg-white border border-emerald-200 px-2.5 py-1 text-[11px] text-emerald-800 hover:border-emerald-400 font-mono transition-colors shadow-2xs"
                              dir="ltr"
                            >
                              <ExternalLink className="h-2.5 w-2.5 text-emerald-600" />
                              <span className="truncate max-w-[240px]">{u.replace(/^https?:\/\//, '')}</span>
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </form>
            </div>
          )}

          {sourcingMode === 'url' && (
            <div className="pt-5 space-y-4">
              <form onSubmit={handleDirectSubmit} className="space-y-3">
                <div className="flex flex-col sm:flex-row gap-2.5">
                  <div className="relative flex-1">
                    <div className="pointer-events-none absolute inset-y-0 start-0 ps-3.5 flex items-center">
                      <Globe className="h-4 w-4 text-slate-400" />
                    </div>
                    <input
                      type="url"
                      value={discoveryUrl}
                      onChange={(e) => setDiscoveryUrl(e.target.value)}
                      placeholder="https://example.com/provider-page — أدخل رابط الموقع أو صفحة التجربة للاستخراج المباشر..."
                      dir="ltr"
                      required
                      disabled={isExtracting}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50/50 ps-10 pe-4 py-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:bg-white focus:ring-1 focus:ring-slate-900 transition-all font-mono shadow-2xs"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isExtracting || !discoveryUrl.trim()}
                    className="flex items-center justify-center gap-2 rounded-xl bg-slate-900 hover:bg-slate-800 active:bg-black px-6 py-3 text-xs font-bold text-white shadow-xs transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                  >
                    {isExtracting ? (
                      <>
                        <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                        <span>جارٍ الكشط والاستخراج...</span>
                      </>
                    ) : (
                      <>
                        <Globe className="h-3.5 w-3.5" />
                        <span>استخراج من الرابط</span>
                      </>
                    )}
                  </button>
                </div>

                {formError && (
                  <div className="rounded-xl bg-red-50 border border-red-200 p-3.5 text-xs font-semibold text-red-700">
                    {formError}
                  </div>
                )}

                {extractionResult && (
                  <div className="rounded-xl bg-emerald-50/60 border border-emerald-200 p-4 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        <span className="font-bold text-emerald-900">
                          تم استخراج المزود وحفظه بنجاح: {extractionResult.name} ({extractionResult.city})
                        </span>
                      </div>
                      <span className="font-mono text-[10px] text-emerald-700">384d vector</span>
                    </div>
                  </div>
                )}
              </form>
            </div>
          )}

          {sourcingMode === 'text' && (
            <div className="pt-5 space-y-4">
              <form onSubmit={handleDirectSubmit} className="space-y-3">
                <div>
                  <label className="text-xs font-semibold text-slate-700 block">
                    النص غير المهيكل (رسالة واتساب، منشور إنستغرام، نبذة تعريفية):
                  </label>
                </div>

                <textarea
                  rows={3}
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  placeholder="ألصق هنا النص التعريفي للمزود أو تفاصيل الرحلة والتواصل..."
                  disabled={isExtracting}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/50 p-3.5 text-xs leading-relaxed text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:bg-white focus:ring-1 focus:ring-slate-900 transition-all shadow-2xs"
                />

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={isExtracting || !rawText.trim()}
                    className="flex items-center justify-center gap-2 rounded-xl bg-slate-900 hover:bg-slate-800 active:bg-black px-6 py-2.5 text-xs font-bold text-white shadow-xs transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isExtracting ? (
                      <>
                        <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                        <span>جارٍ الاستخراج والتضمين...</span>
                      </>
                    ) : (
                      <>
                        <Send className="h-3.5 w-3.5" />
                        <span>استخراج وحفظ المزود</span>
                      </>
                    )}
                  </button>
                </div>

                {formError && (
                  <div className="rounded-xl bg-red-50 border border-red-200 p-3.5 text-xs font-semibold text-red-700">
                    {formError}
                  </div>
                )}
              </form>
            </div>
          )}
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pt-2">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-slate-700" />
            <h2 className="text-sm font-bold text-slate-900">
              دليل مزودي التجارب المسجلين
            </h2>
            <span className="rounded-full bg-slate-200/80 px-2 py-0.5 text-[11px] font-bold text-slate-700">
              {filteredProviders.length}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative">
              <Search className="absolute inset-y-0 start-0 ps-3 flex items-center pointer-events-none h-4 w-4 text-slate-400 my-auto" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="بحث بالاسم أو النوع أو المدينة..."
                className="rounded-xl border border-slate-200 bg-white ps-8 pe-3 py-1.5 text-xs font-medium text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:ring-1 focus:ring-slate-900 shadow-2xs"
              />
            </div>

            <select
              value={selectedCity}
              onChange={(e) => setSelectedCity(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 focus:border-slate-900 shadow-2xs cursor-pointer"
            >
              <option value="all">جميع المدن ({cities.length})</option>
              {cities.map((city) => (
                <option key={city} value={city}>
                  {city}
                </option>
              ))}
            </select>

            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 focus:border-slate-900 shadow-2xs cursor-pointer"
            >
              <option value="all">جميع الحالات</option>
              <option value="verified">موثق</option>
              <option value="pending">قيد المراجعة</option>
              <option value="rejected">مرفوض</option>
            </select>
          </div>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-44 rounded-2xl border border-slate-200/70 bg-white p-5 animate-pulse"
              />
            ))}
          </div>
        ) : filteredProviders.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center">
            <FileText className="h-8 w-8 text-slate-300 mx-auto mb-2" />
            <h3 className="text-sm font-bold text-slate-900">لا يوجد مزودو تجارب مطابقون</h3>
            <p className="text-xs text-slate-500 mt-1">
              استخدم وحدة الاستكشاف في الأعلى للبحث عن مزودين جدد، أو قم بتغيير خيارات البحث والتصفية.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredProviders.map((provider) => (
              <div
                key={provider.id}
                className="group rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs hover:border-slate-400 hover:shadow-md transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between gap-2.5">
                    <div className="flex items-center gap-1.5 flex-1 min-w-0">
                      <h3 className="text-sm font-bold text-slate-900 truncate" title={provider.name}>
                        {provider.name}
                      </h3>
                      {provider.verification_status === 'verified' && (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                      )}
                    </div>

                    <span
                      className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                        provider.verification_status === 'verified'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/80'
                          : provider.verification_status === 'pending'
                            ? 'bg-amber-50 text-amber-700 border border-amber-200/80'
                            : 'bg-red-50 text-red-700 border border-red-200/80'
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

                  <div className="mt-2.5 flex items-center gap-3.5 text-xs text-slate-500">
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                      <span>{provider.city}</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <Users className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                      <span>{provider.capacity ? `${provider.capacity} ضيوف` : 'سعة مرنة'}</span>
                    </span>
                  </div>

                  <div className="mt-4 flex items-center justify-between gap-2 flex-wrap pt-3 border-t border-slate-100">
                    <span className="inline-block rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700">
                      {provider.experience_type}
                    </span>

                    {provider.phone_number ? (
                      <a
                        href={`https://wa.me/${provider.phone_number.replace(/[^\d]/g, '')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white shadow-2xs transition-all cursor-pointer"
                        title="مراسلة المزود مباشرة عبر واتساب"
                      >
                        <svg className="h-3 w-3 fill-white shrink-0" viewBox="0 0 24 24">
                          <path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.582 2.128 2.182-.573c.978.58 1.911.928 3.145.929 3.178 0 5.767-2.587 5.768-5.766.001-3.187-2.575-5.77-5.764-5.771zm3.392 8.244c-.144.405-.837.774-1.17.824-.299.045-.677.063-1.092-.069-.252-.08-.575-.187-.988-.365-1.739-.751-2.874-2.502-2.961-2.617-.087-.116-.708-.94-.708-1.793s.448-1.273.607-1.446c.159-.173.346-.217.462-.217l.332.006c.106.005.249-.04.39.298.144.347.491 1.2.534 1.287.043.087.072.188.014.303-.058.116-.087.188-.173.289l-.26.303c-.087.087-.177.181-.076.355.101.173.449.742.964 1.201.662.591 1.221.774 1.394.861.173.086.275.072.376-.044.101-.116.433-.506.549-.68.116-.173.231-.145.39-.087s1.011.477 1.184.564.289.13.332.203c.043.071.043.419-.101.824zM12 2C6.477 2 2 6.477 2 12c0 1.891.526 3.66 1.438 5.168L2 22l4.98-1.306A9.957 9.957 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18.167c-1.609 0-3.12-.489-4.385-1.326l-.314-.209-2.95.774.787-2.875-.231-.368A8.136 8.136 0 013.833 12c0-4.503 3.664-8.167 8.167-8.167 4.503 0 8.167 3.664 8.167 8.167 0 4.503-3.664 8.167-8.167 8.167z" />
                        </svg>
                        <span className="font-mono text-xs" dir="ltr">{provider.phone_number}</span>
                      </a>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] text-slate-400 bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-200">
                        <Phone className="h-3 w-3 text-slate-300" />
                        <span>لا يتوفر هاتف</span>
                      </span>
                    )}
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                    <span>
                      أضيف: {new Date(provider.created_at).toLocaleDateString('ar-SA')}
                    </span>
                    <span>•</span>
                    <span className="font-mono">384d</span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {provider.verification_status === 'pending' && (
                      <button
                        type="button"
                        onClick={() => handleApproveProvider(provider.id)}
                        disabled={actionLoadingId === provider.id}
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 active:bg-emerald-200 text-emerald-700 border border-emerald-200/80 px-2.5 py-1 text-xs font-bold transition-all cursor-pointer disabled:opacity-50"
                        title="اعتماد وتوثيق المزود"
                      >
                        {actionLoadingId === provider.id ? (
                          <div className="h-3 w-3 animate-spin rounded-full border-2 border-emerald-700 border-t-transparent" />
                        ) : (
                          <Check className="h-3 w-3" />
                        )}
                        <span>اعتماد</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleDeleteProvider(provider.id, provider.name)}
                      disabled={actionLoadingId === provider.id}
                      className="inline-flex items-center justify-center rounded-lg p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 border border-transparent hover:border-red-100 transition-all cursor-pointer disabled:opacity-50"
                      title="حذف المزود نهائياً"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
