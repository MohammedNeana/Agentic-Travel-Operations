'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { Compass, Sparkles, LogOut, Building2, User as UserIcon, TrendingUp, BarChart3 } from 'lucide-react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import type { User } from '@supabase/supabase-js';

export function AppNavbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [tenantName, setTenantName] = useState<string>('There DMC');
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();

    // Check active session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user?.user_metadata?.company_name) {
        setTenantName(session.user.user_metadata.company_name);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user?.user_metadata?.company_name) {
        setTenantName(session.user.user_metadata.company_name);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Hide navbar on login page
  if (pathname === '/login') {
    return null;
  }

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      const supabase = createBrowserSupabaseClient();
      await supabase.auth.signOut();
      router.push('/login');
      router.refresh();
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      setIsLoggingOut(false);
    }
  };

  const navLinks = [
    {
      href: '/',
      label: 'الرحلات والمسارات',
      icon: Compass,
      isActive: pathname === '/',
    },
    {
      href: '/providers',
      label: 'استكشاف المزودين',
      icon: Sparkles,
      isActive: pathname.startsWith('/providers'),
    },
    {
      href: '/forecasting',
      label: 'التنبؤ بالطلب',
      icon: TrendingUp,
      isActive: pathname.startsWith('/forecasting'),
    },
    {
      href: '/analytics',
      label: 'تحليلات الموثوقية',
      icon: BarChart3,
      isActive: pathname.startsWith('/analytics'),
    },
  ];

  return (
    <header className="sticky top-0 z-30 border-b border-gray-100 bg-white/95 backdrop-blur-md shadow-xs">
      <div className="mx-auto flex max-w-screen-2xl items-center justify-between px-6 py-3">
        {/* Brand & Nav */}
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-900 text-white shadow-xs group-hover:bg-violet-700 transition-colors">
              <Compass className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base font-extrabold tracking-tight text-gray-900">
                  There DMC
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200/60">
                  <Building2 className="h-3 w-3" />
                  {tenantName}
                </span>
              </div>
              <p className="text-[10px] font-medium text-gray-400 -mt-0.5">
                منصة إدارة الوجهات السياحية السعودية
              </p>
            </div>
          </Link>

          {/* Navigation Links */}
          <nav className="flex items-center gap-1.5 bg-gray-50/80 p-1 rounded-xl border border-gray-100">
            {navLinks.map((link) => {
              const Icon = link.icon;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    link.isActive
                      ? 'bg-white text-gray-900 shadow-xs border border-gray-200/60'
                      : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100/70'
                  }`}
                >
                  <Icon
                    className={`h-4 w-4 ${
                      link.isActive ? 'text-violet-600' : 'text-gray-400'
                    }`}
                  />
                  <span>{link.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        {/* User Info & Actions */}
        <div className="flex items-center gap-3">
          {user ? (
            <div className="flex items-center gap-3">
              <div className="hidden sm:flex flex-col items-end text-start">
                <span className="text-xs font-bold text-gray-800">
                  {user.user_metadata?.full_name || user.email?.split('@')[0]}
                </span>
                <span className="text-[10px] font-mono text-gray-400">
                  {user.email}
                </span>
              </div>

              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-100 text-violet-700 font-bold text-xs border border-violet-200">
                <UserIcon className="h-4 w-4" />
              </div>

              <button
                type="button"
                onClick={handleLogout}
                disabled={isLoggingOut}
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-gray-600 hover:bg-red-50 hover:text-red-600 transition-colors cursor-pointer border border-transparent hover:border-red-100"
                title="تسجيل الخروج"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">
                  {isLoggingOut ? 'جارٍ الخروج...' : 'خروج'}
                </span>
              </button>
            </div>
          ) : (
            <Link
              href="/login"
              className="rounded-xl bg-gray-900 px-4 py-2 text-xs font-bold text-white hover:bg-gray-800 transition-colors cursor-pointer"
            >
              تسجيل الدخول
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
