'use client';

import { useState, useEffect } from 'react';
import {
  BarChart3,
  Sparkles,
  ShieldCheck,
  AlertTriangle,
  Clock,
  CheckCircle2,
  RefreshCw,
  Loader2,
  Award,
  TrendingUp,
  Cpu,
  Zap,
  Filter,
} from 'lucide-react';
import type { AnalyticsDashboardResult, SupplierScorecard } from '@/app/api/ai/analytics/route';

const CITY_FILTERS = [
  { id: 'all', label: 'كافة الوجهات' },
  { id: 'العلا', label: 'العُلا' },
  { id: 'الرياض', label: 'الرياض' },
  { id: 'جدة', label: 'جدة' },
  { id: 'عسير', label: 'عسير' },
  { id: 'تبوك', label: 'تبوك' },
];

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsDashboardResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [modelUsed, setModelUsed] = useState<string>('');
  const [providerUsed, setProviderUsed] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'scorecards' | 'issues' | 'recommendations'>('scorecards');
  const [selectedCityFilter, setSelectedCityFilter] = useState('all');

  const fetchAnalytics = async (city = selectedCityFilter) => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const url = city && city !== 'all' ? `/api/ai/analytics?city=${encodeURIComponent(city)}` : '/api/ai/analytics';
      const res = await fetch(url);
      const json = await res.json();
      if (json.success && json.data) {
        setData(json.data);
        setModelUsed(json.model || 'llama-3.3-70b-versatile');
        setProviderUsed(json.source || 'groq');
      } else {
        setErrorMessage(json.error || 'فشل توليد التحليلات عبر نموذج الذكاء الاصطناعي.');
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'خطأ في الاتصال بالشبكة.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, []);

  const getTierBadgeColor = (tier: SupplierScorecard['tier']) => {
    if (tier.includes('Tier 1') || tier.includes('ممتاز')) {
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    }
    if (tier.includes('Tier 2') || tier.includes('موثوق')) {
      return 'bg-blue-50 text-blue-700 border-blue-200';
    }
    if (tier.includes('Watchlist') || tier.includes('مراقبة')) {
      return 'bg-amber-50 text-amber-700 border-amber-200';
    }
    return 'bg-red-50 text-red-700 border-red-200';
  };

  return (
    <div className="min-h-screen bg-gray-50/50 pb-16">
      <div className="border-b border-gray-100 bg-white/90 backdrop-blur-md sticky top-[57px] z-20">
        <div className="mx-auto flex max-w-screen-2xl items-center justify-between px-6 py-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-white shadow-xs">
                <BarChart3 className="h-4 w-4" />
              </div>
              <h1 className="text-xl font-bold tracking-tight text-gray-900">
                لوحة تحليلات الحوادث وموثوقية الموردين (Live AI Operations Analytics)
              </h1>
              {modelUsed && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-700 border border-emerald-200">
                  <Sparkles className="h-3 w-3 text-emerald-600" />
                  <span>توليد حي عبر {modelUsed} ({providerUsed.toUpperCase()})</span>
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-1">
              تحليل مباشر 100% بالـ AI مستخلص من سجلات قاعدة بيانات Supabase الحقيقية لقياس جودة الموردين والأداء التشغيلي
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fetchAnalytics(selectedCityFilter)}
              disabled={isLoading}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white px-4 py-2 text-xs font-bold transition-all shadow-xs cursor-pointer disabled:opacity-60"
            >
              {isLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              <span>إعادة تحليل العمليات حياً بالـ AI</span>
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-screen-2xl px-6 pt-6 space-y-6">
        <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-xs flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-gray-400" />
            <span className="text-xs font-bold text-gray-700">تصفية الموردين حسب الوجهة:</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {CITY_FILTERS.map((f) => {
              const isSelected = selectedCityFilter === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => {
                    setSelectedCityFilter(f.id);
                    fetchAnalytics(f.id);
                  }}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer border ${
                    isSelected
                      ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                      : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                  }`}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
        </div>

        {errorMessage && (
          <div className="flex items-start gap-3 rounded-2xl bg-red-50 p-4 border border-red-200">
            <AlertTriangle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
            <div className="flex-1 text-xs">
              <span className="font-bold text-red-900 block mb-1">تعذر تحميل التحليلات عبر الذكاء الاصطناعي:</span>
              <p className="text-red-700">{errorMessage}</p>
              <button
                type="button"
                onClick={() => fetchAnalytics(selectedCityFilter)}
                className="mt-2 text-xs font-bold text-red-800 underline hover:no-underline"
              >
                إعادة المحاولة
              </button>
            </div>
          </div>
        )}

        {isLoading && (
          <div className="flex flex-col items-center justify-center p-16 bg-white rounded-2xl border border-gray-100 shadow-xs">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-600 mb-3" />
            <p className="text-sm font-bold text-gray-800">
              جارٍ فحص سجلات قاعدة بيانات Supabase وتوليد التحليلات حياً عبر {modelUsed || 'Llama 3.3 70B'}...
            </p>
            <p className="text-xs text-gray-400 mt-1">
              يتم استخلاص معدلات التأخير، تقييم سرعة تجاوب الواتساب، وتصنيف بطاقات الموردين بدقة
            </p>
          </div>
        )}

        {!isLoading && data && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-xs">
                <div className="flex items-center justify-between text-gray-500 mb-2">
                  <span className="text-xs font-bold">العمليات المسجلة في الـ DB</span>
                  <Award className="h-4 w-4 text-gray-400" />
                </div>
                <div className="text-2xl font-extrabold text-gray-900">
                  {data.metrics.totalOperations} فعالية
                </div>
                <div className="text-[11px] text-gray-400 mt-1 flex items-center gap-1">
                  <span>معدل الحوادث والتأخير:</span>
                  <span className="font-bold text-amber-600">{data.metrics.disruptionRate}</span>
                </div>
              </div>

              <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-xs ring-1 ring-emerald-500/20 bg-emerald-50/10">
                <div className="flex items-center justify-between text-emerald-700 mb-2">
                  <span className="text-xs font-bold">الحل الذاتي للأزمات بالـ AI</span>
                  <Cpu className="h-4 w-4 text-emerald-600" />
                </div>
                <div className="text-2xl font-extrabold text-emerald-600">
                  {data.metrics.autonomousResolutionRate}
                </div>
                <p className="text-[11px] text-emerald-700 font-medium mt-1">
                  أتمتة إعادة الجدولة وإشعار المزودين بدون اتصالات هاتفية
                </p>
              </div>

              <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-xs">
                <div className="flex items-center justify-between text-gray-500 mb-2">
                  <span className="text-xs font-bold">متوسط زمن التعافي الذكي</span>
                  <Clock className="h-4 w-4 text-violet-600" />
                </div>
                <div className="text-2xl font-extrabold text-violet-700">
                  {data.metrics.averageRecoveryMinutes} دقائق
                </div>
                <p className="text-[11px] text-gray-400 mt-1">مقارنة بـ 45+ دقيقة بالطرق اليدوية التقليدية</p>
              </div>

              <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-xs">
                <div className="flex items-center justify-between text-gray-500 mb-2">
                  <span className="text-xs font-bold">رضا الأفواج السياحية</span>
                  <ShieldCheck className="h-4 w-4 text-emerald-600" />
                </div>
                <div className="text-2xl font-extrabold text-emerald-600">
                  {data.metrics.overallSatisfactionRate}
                </div>
                <p className="text-[11px] text-gray-400 mt-1">
                  {data.metrics.totalActiveSuppliers} مزود معتمد في الشبكة
                </p>
              </div>
            </div>

            <div className="bg-gradient-to-br from-slate-900 via-gray-900 to-emerald-950 rounded-2xl p-6 text-white shadow-md space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold">
                  <Sparkles className="h-4 w-4" />
                  <span>التقرير التنفيذي الشامل بعد الرحلات (Executive AI Post-Mortem)</span>
                </div>
                <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-mono">
                  {modelUsed}
                </span>
              </div>
              <p className="text-sm sm:text-base font-medium leading-relaxed text-slate-100">
                {data.executiveSummary}
              </p>
            </div>

            <div className="flex items-center gap-2 border-b border-gray-200">
              <button
                type="button"
                onClick={() => setActiveTab('scorecards')}
                className={`pb-3 px-3 text-xs font-bold transition-all border-b-2 cursor-pointer ${
                  activeTab === 'scorecards'
                    ? 'border-emerald-600 text-emerald-700'
                    : 'border-transparent text-gray-500 hover:text-gray-900'
                }`}
              >
                بطاقات موثوقية الموردين ({data.supplierScorecards.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('issues')}
                className={`pb-3 px-3 text-xs font-bold transition-all border-b-2 cursor-pointer ${
                  activeTab === 'issues'
                    ? 'border-emerald-600 text-emerald-700'
                    : 'border-transparent text-gray-500 hover:text-gray-900'
                }`}
              >
                المشكلات التشغيلية المتكررة ({data.recurringIssues.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('recommendations')}
                className={`pb-3 px-3 text-xs font-bold transition-all border-b-2 cursor-pointer ${
                  activeTab === 'recommendations'
                    ? 'border-emerald-600 text-emerald-700'
                    : 'border-transparent text-gray-500 hover:text-gray-900'
                }`}
              >
                توجيهات إدارة الـ DMC الاستراتيجية
              </button>
            </div>

            {activeTab === 'scorecards' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {data.supplierScorecards.map((scorecard, idx) => (
                    <div
                      key={idx}
                      className="bg-white rounded-2xl p-5 border border-gray-100 shadow-xs hover:border-gray-200 hover:shadow-md transition-all space-y-3 flex flex-col justify-between"
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div>
                            <h3 className="text-sm font-bold text-gray-900">{scorecard.providerName}</h3>
                            <div className="text-[11px] text-gray-400 flex items-center gap-1.5 mt-0.5">
                              <span>{scorecard.city}</span>
                              <span>•</span>
                              <span>{scorecard.experienceType}</span>
                            </div>
                          </div>
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${getTierBadgeColor(
                              scorecard.tier
                            )}`}
                          >
                            {scorecard.tier}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-2 my-3 p-2.5 rounded-xl bg-gray-50 border border-gray-100">
                          <div>
                            <span className="text-[10px] text-gray-400 block">درجة الموثوقية:</span>
                            <span className="text-base font-extrabold text-emerald-600">
                              {scorecard.reliabilityScore} / 100
                            </span>
                          </div>
                          <div>
                            <span className="text-[10px] text-gray-400 block">نسبة الالتزام بالوقت:</span>
                            <span className="text-base font-extrabold text-gray-800">
                              {scorecard.onTimeRate}
                            </span>
                          </div>
                        </div>

                        <div className="space-y-1">
                          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1">
                            <Sparkles className="h-3 w-3 text-emerald-600" />
                            تقييم الذكاء الاصطناعي:
                          </span>
                          <p className="text-xs text-gray-600 leading-relaxed font-medium">
                            {scorecard.aiEvaluation}
                          </p>
                        </div>
                      </div>

                      <div className="pt-3 border-t border-gray-100">
                        <span className="text-[10px] font-bold text-gray-700 block mb-0.5">
                          الإجراء المقترح لفرق الـ DMC:
                        </span>
                        <p className="text-[11px] text-emerald-800 bg-emerald-50/70 p-2 rounded-lg font-medium border border-emerald-200/60">
                          {scorecard.recommendedAction}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'issues' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {data.recurringIssues.map((issue, idx) => (
                    <div
                      key={idx}
                      className="bg-white rounded-2xl p-5 border border-gray-100 shadow-xs space-y-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2.5">
                          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                          <div>
                            <h3 className="text-sm font-bold text-gray-900">{issue.title}</h3>
                            <span className="text-[10px] text-gray-400">{issue.category}</span>
                          </div>
                        </div>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
                          {issue.severity}
                        </span>
                      </div>

                      <div className="p-3 rounded-xl bg-gray-50 border border-gray-100 text-xs space-y-1.5">
                        <div>
                          <span className="font-bold text-gray-700">معدل الحدوث: </span>
                          <span className="text-gray-600">{issue.frequency}</span>
                        </div>
                        <div>
                          <span className="font-bold text-gray-700">تحليل الأثر التشغيلي: </span>
                          <span className="text-gray-600">{issue.impactAnalysis}</span>
                        </div>
                      </div>

                      <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-100 text-xs">
                        <span className="font-bold text-emerald-900 flex items-center gap-1 mb-1">
                          <Zap className="h-3.5 w-3.5 text-emerald-600" />
                          خطة الاحتواء التلقائية المعتمدة:
                        </span>
                        <p className="text-emerald-800 font-medium leading-relaxed">
                          {issue.mitigationStrategy}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'recommendations' && (
              <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-xs space-y-4">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-emerald-600" />
                  <h3 className="text-base font-bold text-gray-900">
                    توجيهات الذكاء الاصطناعي الاستراتيجية لإدارة التعاقدات والعمليات
                  </h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
                  {data.dmcRecommendations.map((rec, idx) => (
                    <div
                      key={idx}
                      className="p-4 rounded-xl bg-gray-50 border border-gray-100 space-y-2 flex flex-col justify-between"
                    >
                      <div className="flex items-start gap-2 text-xs font-bold text-gray-900">
                        <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                        <span>توصية استراتيجية #{idx + 1}</span>
                      </div>
                      <p className="text-xs text-gray-600 leading-relaxed font-medium">
                        {rec}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
