'use client';

import { useState, useEffect } from 'react';
import {
  TrendingUp,
  MapPin,
  Calendar,
  Users,
  Sparkles,
  AlertTriangle,
  Lightbulb,
  ShieldCheck,
  Compass,
  ArrowUpRight,
  Loader2,
  RefreshCw,
  Send,
  Plus,
} from 'lucide-react';
import type { DemandForecastResult } from '@/app/api/ai/forecasting/route';

const SAUDI_CITIES = [
  { id: 'العلا', name: 'العُلا', tag: 'تراث وفخامة صحراوية' },
  { id: 'عسير', name: 'عسير وأبها', tag: 'طبيعة جبلية وأجواء صيفية' },
  { id: 'الرياض', name: 'الرياض', tag: 'عاصمة الثقافة والفعاليات' },
  { id: 'تبوك', name: 'تبوك ونيوم', tag: 'بحر أحمر ومغامرات بيئية' },
  { id: 'جدة', name: 'جدة التاريخية', tag: 'بوابة الحجاز وسياحة ساحلية' },
  { id: 'حائل', name: 'حائل', tag: 'فنون صخرية وضيافة كرم' },
];

const SEASONS = [
  { id: 'شتاء طنطورة وموسم الشتاء', label: 'شتاء طنطورة وموسم الشتاء (نوفمبر - مارس)' },
  { id: 'صيف عسير والسودة المعتدل', label: 'صيف عسير والسودة المعتدل (يونيو - سبتمبر)' },
  { id: 'موسم الرياض وسياحة الفعاليات الكبرى', label: 'موسم الرياض وسياحة الفعاليات الكبرى (أكتوبر - مارس)' },
  { id: 'الربيع والخريف التراثي والمغامرات', label: 'الربيع والخريف التراثي والمغامرات (أبريل - مايو)' },
];

const TRAVELER_SEGMENTS = [
  { id: 'سياحة ثقافية وتراث فاخر (أوروبا، اليابان، أمريكا)', label: 'سياحة ثقافية وتراث فاخر (أوروبا، اليابان، أمريكا)' },
  { id: 'سياحة مغامرات وبيئة وهايكنج (الشباب، دول الخليج)', label: 'سياحة مغامرات وبيئة وهايكنج (الشباب، دول الخليج)' },
  { id: 'عائلات وترفيه واستجمام (محلي، إقليمي)', label: 'عائلات وترفيه واستجمام (محلي، إقليمي)' },
  { id: 'سياحة تاريخ إسلامي وثقافة حجازية', label: 'سياحة تاريخ إسلامي وثقافة حجازية' },
];

export default function ForecastingPage() {
  const [selectedCity, setSelectedCity] = useState('العلا');
  const [customCity, setCustomCity] = useState('');
  const [isCustomCity, setIsCustomCity] = useState(false);
  const [selectedSeason, setSelectedSeason] = useState(SEASONS[0].id);
  const [selectedSegment, setSelectedSegment] = useState(TRAVELER_SEGMENTS[0].id);
  const [customScenario, setCustomScenario] = useState('');

  const [isLoading, setIsLoading] = useState(false);
  const [forecast, setForecast] = useState<DemandForecastResult | null>(null);
  const [modelUsed, setModelUsed] = useState<string>('');
  const [providerUsed, setProviderUsed] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const activeCityName = isCustomCity ? customCity.trim() || 'الوجهة المخصصة' : selectedCity;

  const fetchForecast = async (
    cityToUse = activeCityName,
    seasonToUse = selectedSeason,
    segmentToUse = selectedSegment,
    scenario = customScenario
  ) => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const res = await fetch('/api/ai/forecasting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          city: cityToUse,
          season: seasonToUse,
          travelerSegment: segmentToUse,
          customPrompt: scenario.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (data.success && data.forecast) {
        setForecast(data.forecast);
        setModelUsed(data.model || 'llama-3.3-70b-versatile');
        setProviderUsed(data.source || 'groq');
      } else {
        setErrorMessage(data.error || 'فشل توليد التنبؤ عبر نموذج الذكاء الاصطناعي.');
      }
    } catch (err) {
      console.error('Failed to fetch demand forecast:', err);
      setErrorMessage(err instanceof Error ? err.message : 'خطأ في الاتصال بالشبكة.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchForecast();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCustomScenarioSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchForecast(activeCityName, selectedSeason, selectedSegment, customScenario);
  };

  return (
    <div className="min-h-screen bg-gray-50/50 pb-16">
      {/* Top Header */}
      <div className="border-b border-gray-100 bg-white/90 backdrop-blur-md sticky top-[57px] z-20">
        <div className="mx-auto flex max-w-screen-2xl items-center justify-between px-6 py-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-600 text-white shadow-xs">
                <TrendingUp className="h-4 w-4" />
              </div>
              <h1 className="text-xl font-bold tracking-tight text-gray-900">
                منظومة التنبؤ الحي بالطلب السياحي (Live AI Tourism Forecasting)
              </h1>
              {modelUsed && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-50 px-2.5 py-0.5 text-xs font-bold text-violet-700 border border-violet-200">
                  <Sparkles className="h-3 w-3 text-violet-600" />
                  <span>توليد حي عبر {modelUsed} ({providerUsed.toUpperCase()})</span>
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-1">
              محاكاة استباقية ديناميكية 100% بالذكاء الاصطناعي — بدون أي قوالب ثابتة — لتقدير الضغوط التشغيلية والعجز في الموردين
            </p>
          </div>

          <button
            type="button"
            onClick={() => fetchForecast()}
            disabled={isLoading}
            className="inline-flex items-center gap-2 rounded-xl bg-violet-700 hover:bg-violet-800 text-white px-4 py-2 text-xs font-bold transition-all shadow-xs cursor-pointer disabled:opacity-60"
          >
            {isLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            <span>إعادة توليد التنبؤ المباشر بالـ AI</span>
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-screen-2xl px-6 pt-6 space-y-6">
        {/* Controls Card */}
        <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-xs space-y-5">
          {/* City Selection */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold text-gray-700">
                الوجهة / المدينة السعودية المستهدفة:
              </label>
              <button
                type="button"
                onClick={() => setIsCustomCity(!isCustomCity)}
                className="text-xs font-bold text-violet-600 hover:text-violet-800 transition-colors flex items-center gap-1 cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>{isCustomCity ? 'اختيار من المدن الرئيسية' : 'كتابة وجهة سعودية مخصصة'}</span>
              </button>
            </div>

            {!isCustomCity ? (
              <div className="flex flex-wrap gap-2.5">
                {SAUDI_CITIES.map((c) => {
                  const isSelected = selectedCity === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setSelectedCity(c.id);
                        fetchForecast(c.id, selectedSeason, selectedSegment, customScenario);
                      }}
                      className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                        isSelected
                          ? 'bg-violet-600 text-white border-violet-600 shadow-sm shadow-violet-200'
                          : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'
                      }`}
                    >
                      <MapPin className={`h-3.5 w-3.5 ${isSelected ? 'text-white' : 'text-gray-400'}`} />
                      <span>{c.name}</span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded-md ${
                          isSelected ? 'bg-violet-700 text-violet-100' : 'bg-gray-200/70 text-gray-500'
                        }`}
                      >
                        {c.tag}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={customCity}
                  onChange={(e) => setCustomCity(e.target.value)}
                  placeholder="اكتب أي وجهة سياحية (مثال: نجران، دومة الجندل، أملج، الطائف، ينبع)..."
                  className="flex-1 rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-xs font-medium text-gray-800 focus:bg-white focus:border-violet-600 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => fetchForecast(customCity, selectedSeason, selectedSegment, customScenario)}
                  className="rounded-xl bg-violet-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-violet-700 transition-colors cursor-pointer"
                >
                  تحليل الوجهة
                </button>
              </div>
            )}
          </div>

          {/* Season & Traveler Segment */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-gray-100">
            <div>
              <label className="text-xs font-bold text-gray-700 flex items-center gap-1.5 mb-1.5">
                <Calendar className="h-3.5 w-3.5 text-violet-600" />
                <span>الموسم السياحي:</span>
              </label>
              <select
                value={selectedSeason}
                onChange={(e) => {
                  setSelectedSeason(e.target.value);
                  fetchForecast(activeCityName, e.target.value, selectedSegment, customScenario);
                }}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-800 focus:bg-white focus:border-violet-600 focus:outline-none"
              >
                {SEASONS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-bold text-gray-700 flex items-center gap-1.5 mb-1.5">
                <Users className="h-3.5 w-3.5 text-violet-600" />
                <span>شريحة المسافرين والوفود:</span>
              </label>
              <select
                value={selectedSegment}
                onChange={(e) => {
                  setSelectedSegment(e.target.value);
                  fetchForecast(activeCityName, selectedSeason, e.target.value, customScenario);
                }}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-800 focus:bg-white focus:border-violet-600 focus:outline-none"
              >
                {TRAVELER_SEGMENTS.map((seg) => (
                  <option key={seg.id} value={seg.id}>
                    {seg.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Interactive Custom Scenario Simulation Bar */}
          <form onSubmit={handleCustomScenarioSubmit} className="pt-2 border-t border-gray-100">
            <label className="text-xs font-bold text-gray-700 flex items-center gap-1.5 mb-1.5">
              <Sparkles className="h-3.5 w-3.5 text-violet-600" />
              <span>محاكاة سيناريو خاص بالذكاء الاصطناعي (Custom AI Simulation):</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={customScenario}
                onChange={(e) => setCustomScenario(e.target.value)}
                placeholder="أدخل أي سيناريو خاص (مثال: وصول وفد ياباني من 40 شخص بطائرات خاصة يبحث عن مخيمات حصرية)..."
                className="flex-1 rounded-xl border border-gray-200 bg-gray-50 px-4 py-2 text-xs font-medium text-gray-800 focus:bg-white focus:border-violet-600 focus:outline-none"
              />
              <button
                type="submit"
                disabled={isLoading}
                className="flex items-center gap-1.5 rounded-xl bg-gray-900 px-4 py-2 text-xs font-bold text-white hover:bg-gray-800 transition-colors cursor-pointer disabled:opacity-60"
              >
                <Send className="h-3.5 w-3.5" />
                <span>تشغيل المحاكاة</span>
              </button>
            </div>
          </form>
        </div>

        {/* Error Alert */}
        {errorMessage && (
          <div className="flex items-start gap-3 rounded-2xl bg-red-50 p-4 border border-red-200">
            <AlertTriangle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
            <div className="flex-1 text-xs">
              <span className="font-bold text-red-900 block mb-1">تعذر التوليد عبر الذكاء الاصطناعي:</span>
              <p className="text-red-700">{errorMessage}</p>
              <button
                type="button"
                onClick={() => fetchForecast()}
                className="mt-2 text-xs font-bold text-red-800 underline hover:no-underline"
              >
                إعادة المحاولة
              </button>
            </div>
          </div>
        )}

        {/* Loading State */}
        {isLoading && (
          <div className="flex flex-col items-center justify-center p-16 bg-white rounded-2xl border border-gray-100 shadow-xs">
            <Loader2 className="h-8 w-8 animate-spin text-violet-600 mb-3" />
            <p className="text-sm font-bold text-gray-800">
              جارٍ استدعاء نموذج {modelUsed || 'Llama 3.3 70B'} لتحليل وضغوط الطاقة الاستيعابية في {activeCityName}...
            </p>
            <p className="text-xs text-gray-400 mt-1">يتم التنبؤ بنسب الزيادة، ارتفاع الأسعار، ونقاط الاختناق التشغيلي مباشرة</p>
          </div>
        )}

        {/* Forecast Content */}
        {!isLoading && forecast && (
          <div className="space-y-6">
            {/* 4 Metric Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-xs">
                <div className="flex items-center justify-between text-gray-500 mb-2">
                  <span className="text-xs font-bold">تزايد التدفق المتوقع</span>
                  <ArrowUpRight className="h-4 w-4 text-emerald-600" />
                </div>
                <div className="text-2xl font-extrabold text-emerald-600">
                  +{forecast.visitorSurgePercent}%
                </div>
                <p className="text-[11px] text-gray-400 mt-1">فوق المعدل الموسمي الطبيعي</p>
              </div>

              <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-xs">
                <div className="flex items-center justify-between text-gray-500 mb-2">
                  <span className="text-xs font-bold">مؤشر ضغط السعة</span>
                  <span
                    className={`text-xs font-bold ${
                      forecast.capacityPressureScore >= 80
                        ? 'text-red-600'
                        : forecast.capacityPressureScore >= 60
                        ? 'text-amber-600'
                        : 'text-emerald-600'
                    }`}
                  >
                    {forecast.capacityPressureScore >= 80 ? 'حرج جداً' : forecast.capacityPressureScore >= 60 ? 'ضغط مرتفع' : 'معتدل'}
                  </span>
                </div>
                <div className="text-2xl font-extrabold text-gray-900">
                  {forecast.capacityPressureScore} / 100
                </div>
                <div className="w-full bg-gray-100 h-1.5 rounded-full mt-2 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      forecast.capacityPressureScore >= 80
                        ? 'bg-red-500'
                        : forecast.capacityPressureScore >= 60
                        ? 'bg-amber-500'
                        : 'bg-emerald-500'
                    }`}
                    style={{ width: `${Math.min(forecast.capacityPressureScore, 100)}%` }}
                  />
                </div>
              </div>

              <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-xs">
                <div className="flex items-center justify-between text-gray-500 mb-2">
                  <span className="text-xs font-bold">تقدير ارتفاع الأسعار</span>
                  <TrendingUp className="h-4 w-4 text-violet-600" />
                </div>
                <div className="text-2xl font-extrabold text-violet-700">
                  {forecast.priceSurgeEstimate}
                </div>
                <p className="text-[11px] text-gray-400 mt-1">نسبة التضخم في رسوم وتذاكر التجارب</p>
              </div>

              <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-xs">
                <div className="flex items-center justify-between text-gray-500 mb-2">
                  <span className="text-xs font-bold">ذروة الإشغال القادمة</span>
                  <Compass className="h-4 w-4 text-gray-400" />
                </div>
                <div className="text-lg font-extrabold text-gray-800">
                  {forecast.quarterlyForecast[0]?.period || 'الربع القادم'}
                </div>
                <p className="text-[11px] text-emerald-600 font-bold mt-1">
                  إشغال متوقع: {forecast.quarterlyForecast[0]?.occupancyRate || '85%'}
                </p>
              </div>
            </div>

            {/* Executive Summary by AI */}
            <div className="bg-gradient-to-br from-violet-950 via-slate-900 to-gray-900 rounded-2xl p-6 text-white shadow-md space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-violet-300 text-xs font-bold">
                  <Sparkles className="h-4 w-4 text-violet-400" />
                  <span>التقرير التنفيذي الاستراتيجي المولد حياً بالـ AI ({forecast.city})</span>
                </div>
                <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-violet-800/60 text-violet-200 border border-violet-700/60 font-mono">
                  {modelUsed}
                </span>
              </div>
              <p className="text-sm sm:text-base font-medium leading-relaxed text-slate-100">
                {forecast.executiveSummary}
              </p>
            </div>

            {/* Two-Column Detail Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
              {/* Critical Supplier Shortages */}
              <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-xs space-y-4">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-red-600" />
                  <h3 className="text-sm font-bold text-gray-900">
                    مخاطر العجز في الطاقة الاستيعابية للتجارب ({forecast.city})
                  </h3>
                </div>

                <div className="space-y-3">
                  {forecast.criticalShortageCategories.map((item, idx) => (
                    <div
                      key={idx}
                      className="p-3.5 rounded-xl border border-red-100 bg-red-50/50 space-y-1.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-gray-900">{item.category}</span>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-200">
                          {item.riskLevel}
                        </span>
                      </div>
                      <p className="text-xs text-gray-600 font-medium">
                        <span className="font-bold text-gray-800">توجيه الـ AI: </span>
                        {item.recommendation}
                      </p>
                    </div>
                  ))}
                </div>

                {/* Key Demand Drivers */}
                <div className="pt-3 border-t border-gray-100 space-y-2">
                  <h4 className="text-xs font-bold text-gray-700">محرّكات التدفق الرئيسية المرصودة:</h4>
                  <ul className="space-y-1.5">
                    {forecast.keyDrivers.map((driver, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-xs text-gray-600">
                        <span className="h-1.5 w-1.5 rounded-full bg-violet-600 mt-1.5 shrink-0" />
                        <span>{driver}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Strategy Recommendations & Quarterly Forecast */}
              <div className="space-y-6">
                {/* Recommendations */}
                <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-xs space-y-3.5">
                  <div className="flex items-center gap-2">
                    <Lightbulb className="h-4 w-4 text-amber-500" />
                    <h3 className="text-sm font-bold text-gray-900">
                      توصيات تشغيلية استباقية لفرق الـ DMC
                    </h3>
                  </div>

                  <div className="space-y-2.5">
                    {forecast.dmcStrategyRecommendations.map((rec, idx) => (
                      <div
                        key={idx}
                        className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-50/60 border border-amber-200/60 text-xs font-medium text-amber-950"
                      >
                        <ShieldCheck className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                        <span>{rec}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Quarterly Forecast */}
                <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-xs space-y-3.5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-gray-900">
                      مسار الإشغال والطلب للأرباع القادمة (Quarterly Trajectory)
                    </h3>
                    <span className="text-[11px] text-gray-400 font-medium">توقعات استشرافية</span>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    {forecast.quarterlyForecast.map((q, idx) => (
                      <div
                        key={idx}
                        className="text-center p-3 rounded-xl bg-gray-50 border border-gray-100"
                      >
                        <div className="text-xs font-bold text-gray-800">{q.period}</div>
                        <div className="text-[11px] font-semibold text-violet-600 mt-1">
                          {q.demandLevel}
                        </div>
                        <div className="text-[10px] text-gray-400 mt-0.5">إشغال {q.occupancyRate}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
