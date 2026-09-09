'use client';

import { User, Globe, Wallet, Users, Utensils, Calendar, Accessibility } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Skeleton, SkeletonText } from '@/components/ui/Skeleton';
import ar from '@/lib/i18n/ar';
import type { TravelerProfile } from '@/types/itinerary';

export const defaultArabicTravelerProfile: TravelerProfile = {
  id: 'tp-001',
  name: 'تاناكا يوكي',
  nationality: 'ياباني',
  groupSize: 6,
  budgetTier: 'premium',
  interests: ['تراث وثقافة', 'سفاري صحراوي', 'تجارب طهي', 'تصوير'],
  dietaryRestrictions: ['حلال', 'خالٍ من المحار والقشريات'],
  mobilityNotes: 'يوجد ضيف مسن — يفضل الأماكن المهيأة للكراسي المتحركة',
  arrivalDate: '2026-10-15',
  departureDate: '2026-10-20',
};

interface TravelerProfileSidebarProps {
  profile?: TravelerProfile | null;
  isLoading?: boolean;
}

const budgetColors: Record<string, 'neutral' | 'default' | 'warning' | 'success'> = {
  economy: 'neutral',
  standard: 'default',
  premium: 'warning',
  luxury: 'success',
};

export function TravelerProfileSidebar({
  profile = defaultArabicTravelerProfile,
  isLoading = false,
}: TravelerProfileSidebarProps) {
  if (isLoading) {
    return <SidebarSkeleton />;
  }

  const activeProfile = profile ?? defaultArabicTravelerProfile;

  return (
    <aside className="w-80 shrink-0 space-y-6 rounded-2xl border border-gray-100 bg-white p-6 shadow-xs">
      {/* Header */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
          {ar.sidebar.title}
        </p>
        <div className="mt-3 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-gray-900 text-white shadow-xs">
            <User className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-bold text-gray-900">{activeProfile.name}</p>
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <Globe className="h-3 w-3" />
              <span>{activeProfile.nationality}</span>
            </div>
          </div>
        </div>
      </div>

      <hr className="border-gray-100" />

      {/* Details */}
      <div className="space-y-4">
        <DetailRow
          icon={<Users className="h-4 w-4 text-gray-400" />}
          label={ar.sidebar.groupSize}
          value={`${activeProfile.groupSize} ${ar.sidebar.guests}`}
        />
        <DetailRow
          icon={<Wallet className="h-4 w-4 text-gray-400" />}
          label={ar.sidebar.budgetTier}
        >
          <Badge
            label={ar.budget[activeProfile.budgetTier] ?? activeProfile.budgetTier}
            variant={budgetColors[activeProfile.budgetTier]}
            size="sm"
          />
        </DetailRow>
        <DetailRow
          icon={<Calendar className="h-4 w-4 text-gray-400" />}
          label={ar.sidebar.dates}
          value={`${formatDateAr(activeProfile.arrivalDate)} ← ${formatDateAr(activeProfile.departureDate)}`}
        />
      </div>

      <hr className="border-gray-100" />

      {/* Interests */}
      <div>
        <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
          {ar.sidebar.interests}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {activeProfile.interests.map((interest) => (
            <Badge key={interest} label={interest} variant="default" size="sm" />
          ))}
        </div>
      </div>

      {/* Dietary */}
      {activeProfile.dietaryRestrictions.length > 0 && (
        <div>
          <p className="mb-2.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
            <Utensils className="h-3.5 w-3.5" />
            <span>{ar.sidebar.dietary}</span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {activeProfile.dietaryRestrictions.map((r) => (
              <Badge key={r} label={r} variant="warning" size="sm" />
            ))}
          </div>
        </div>
      )}

      {/* Mobility */}
      {activeProfile.mobilityNotes && (
        <div className="rounded-xl bg-blue-50/70 p-3.5 border border-blue-100">
          <p className="flex items-center gap-1.5 text-[11px] font-bold tracking-wider text-blue-700">
            <Accessibility className="h-3.5 w-3.5" />
            <span>{ar.sidebar.mobilityNote}</span>
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-blue-800">
            {activeProfile.mobilityNotes}
          </p>
        </div>
      )}
    </aside>
  );
}

// ─── Sub-components ──────────────────────────────────────────

function DetailRow({
  icon,
  label,
  value,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2 text-gray-500">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      {children ?? <span className="text-xs font-semibold text-gray-900">{value}</span>}
    </div>
  );
}

function SidebarSkeleton() {
  return (
    <aside className="w-80 shrink-0 space-y-6 rounded-2xl border border-gray-100 bg-white p-6 shadow-xs">
      <div>
        <Skeleton className="h-3 w-24" />
        <div className="mt-3 flex items-center gap-3">
          <Skeleton className="h-11 w-11 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
      </div>
      <hr className="border-gray-100" />
      <SkeletonText lines={4} />
      <hr className="border-gray-100" />
      <div className="flex flex-wrap gap-1.5">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-5 w-20 rounded-full" />
        ))}
      </div>
    </aside>
  );
}

// ─── Helpers ─────────────────────────────────────────────────

function formatDateAr(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('ar-SA', { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}
