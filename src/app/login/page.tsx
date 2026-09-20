'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Compass, Lock, Mail, Building2, User, ArrowLeft, CheckCircle2, AlertCircle } from 'lucide-react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [companyName, setCompanyName] = useState('There DMC');

  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        router.replace('/');
      }
    });
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    setIsLoading(true);

    const supabase = createBrowserSupabaseClient();

    try {
      if (isRegister) {
        // Auto-generate tenant_id securely behind the scenes
        const isDefaultOrg = !companyName.trim() || companyName.trim().toLowerCase() === 'there dmc';
        const autoTenantId = isDefaultOrg
          ? 'a1b2c3d4-0001-4000-8000-000000000001'
          : (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'a1b2c3d4-0001-4000-8000-000000000001');

        // Sign Up with user metadata containing the auto-generated tenant_id
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: {
              full_name: fullName.trim() || 'مدير الوجهة',
              company_name: companyName.trim() || 'There DMC',
              tenant_id: autoTenantId,
            },
          },
        });

        if (error) {
          throw error;
        }

        if (data.session) {
          setSuccessMsg('تم إنشاء الحساب وتسجيل الدخول بنجاح!');
          router.replace('/');
          router.refresh();
        } else {
          setSuccessMsg('تم إنشاء الحساب بنجاح! يمكنك الآن تسجيل الدخول.');
          setIsRegister(false);
        }
      } else {
        // Sign In
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

        if (error) {
          throw error;
        }

        if (data.session) {
          setSuccessMsg('تم تسجيل الدخول بنجاح!');
          router.replace('/');
          router.refresh();
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'حدث خطأ غير متوقع';
      if (message.includes('Invalid login credentials')) {
        setErrorMsg('البريد الإلكتروني أو كلمة المرور غير صحيحة.');
      } else if (message.includes('User already registered')) {
        setErrorMsg('هذا البريد الإلكتروني مسجل مسبقاً. يرجى تسجيل الدخول.');
      } else if (message.includes('Password should be at least')) {
        setErrorMsg('يجب أن تتكون كلمة المرور من 6 أحرف على الأقل.');
      } else {
        setErrorMsg(message);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        {/* Brand Header */}
        <div className="flex justify-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-900 text-white shadow-md">
            <Compass className="h-6 w-6 text-violet-400" />
          </div>
        </div>
        <h2 className="mt-4 text-center text-2xl font-extrabold tracking-tight text-gray-900">
          منصة إدارة الوجهات السياحية (DMC)
        </h2>
        <p className="mt-1 text-center text-xs text-gray-500">
          بوابة الشركات السياحية السعودية المعتمدة لإدارة وتخصيص الرحلات
        </p>

        {/* Tab Switcher */}
        <div className="mt-6 flex bg-gray-200/70 p-1 rounded-xl">
          <button
            type="button"
            onClick={() => {
              setIsRegister(false);
              setErrorMsg(null);
            }}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${!isRegister
              ? 'bg-white text-gray-900 shadow-xs'
              : 'text-gray-500 hover:text-gray-800'
              }`}
          >
            تسجيل الدخول
          </button>
          <button
            type="button"
            onClick={() => {
              setIsRegister(true);
              setErrorMsg(null);
            }}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${isRegister
              ? 'bg-white text-gray-900 shadow-xs'
              : 'text-gray-500 hover:text-gray-800'
              }`}
          >
            إنشاء حساب جديد
          </button>
        </div>
      </div>

      <div className="mt-4 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-6 shadow-sm rounded-2xl border border-gray-100 sm:px-10">
          {errorMsg && (
            <div className="mb-5 flex items-center gap-2 rounded-xl bg-red-50 p-3 text-xs font-semibold text-red-700 border border-red-200">
              <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="mb-5 flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-xs font-semibold text-emerald-700 border border-emerald-200">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
              <span>{successMsg}</span>
            </div>
          )}

          <form className="space-y-4" onSubmit={handleSubmit}>
            {isRegister && (
              <>
                <div>
                  <label className="block text-xs font-bold text-gray-700">
                    الاسم الكامل
                  </label>
                  <div className="mt-1 relative rounded-xl shadow-xs">
                    <div className="absolute inset-y-0 start-0 ps-3 flex items-center pointer-events-none text-gray-400">
                      <User className="h-4 w-4" />
                    </div>
                    <input
                      type="text"
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="الاسم الكامل"
                      className="block w-full rounded-xl border border-gray-200 ps-9 pe-3 py-2 text-xs font-medium focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700">
                    اسم شركة السياحة (DMC)
                  </label>
                  <div className="mt-1 relative rounded-xl shadow-xs">
                    <div className="absolute inset-y-0 start-0 ps-3 flex items-center pointer-events-none text-gray-400">
                      <Building2 className="h-4 w-4" />
                    </div>
                    <input
                      type="text"
                      required
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      placeholder="There DMC"
                      className="block w-full rounded-xl border border-gray-200 ps-9 pe-3 py-2 text-xs font-medium focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
                    />
                  </div>
                </div>
              </>
            )}

            <div>
              <label className="block text-xs font-bold text-gray-700">
                البريد الإلكتروني
              </label>
              <div className="mt-1 relative rounded-xl shadow-xs">
                <div className="absolute inset-y-0 start-0 ps-3 flex items-center pointer-events-none text-gray-400">
                  <Mail className="h-4 w-4" />
                </div>
                <input
                  type="email"
                  required
                  dir="ltr"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@theredmc.sa"
                  className="block w-full rounded-xl border border-gray-200 ps-9 pe-3 py-2 text-xs font-medium text-left focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700">
                كلمة المرور
              </label>
              <div className="mt-1 relative rounded-xl shadow-xs">
                <div className="absolute inset-y-0 start-0 ps-3 flex items-center pointer-events-none text-gray-400">
                  <Lock className="h-4 w-4" />
                </div>
                <input
                  type="password"
                  required
                  dir="ltr"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="block w-full rounded-xl border border-gray-200 ps-9 pe-3 py-2 text-xs font-medium text-left focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
                />
              </div>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={isLoading}
                className="w-full flex justify-center items-center gap-2 py-2.5 px-4 border border-transparent rounded-xl shadow-sm text-xs font-bold text-white bg-gray-900 hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-violet-500 transition-all cursor-pointer disabled:opacity-50"
              >
                {isLoading ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                ) : (
                  <>
                    <span>{isRegister ? 'تسجيل حساب جديد والانضمام' : 'تسجيل الدخول'}</span>
                    <ArrowLeft className="h-3.5 w-3.5" />
                  </>
                )}
              </button>
            </div>
          </form>

          {/* Quick Demo Credentials */}
          <div className="mt-6 pt-4 border-t border-gray-100">
            <p className="text-[11px] font-bold text-gray-700 mb-1">
              ملاحظة تجريبية سريعة:
            </p>
            <p className="text-[10px] text-gray-500 leading-relaxed">
              إذا لم يكن لديك حساب بعد، انقر على &quot;إنشاء حساب جديد&quot;، واكتب بريدك الإلكتروني مع أي كلمة مرور (6 أحرف فأكثر)، وسيقوم النظام بتسجيلك وتوجيهك فوراً للوحة التحكم مع تطبيق سياسات العزل (RLS) تلقائياً.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
