'use client';

import { User, Globe, Wallet, Users, Utensils, Calendar, Accessibility } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Skeleton, SkeletonText } from '@/components/ui/Skeleton';
import type { TravelerProfile } from '@/types/itinerary';

interface TravelerProfileSidebarProps {
  profile: TravelerProfile | null;
  isLoading: boolean;
}

const budgetColors: Record<string, 'neutral' | 'default' | 'warning' | 'success'> = {
  economy: 'neutral',
  standard: 'default',
  premium: 'warning',
  luxury: 'success',
};

export function TravelerProfileSidebar({ profile, isLoading }: TravelerProfileSidebarProps) {
  if (isLoading) {
    return <SidebarSkeleton />;
  }

  if (!profile) {
    return (
      <aside className="w-72 shrink-0 rounded-2xl border border-gray-100 bg-white p-6">
        <p className="text-sm text-gray-400">No traveler profile loaded.</p>
      </aside>
    );
  }

  return (
    <aside className="w-72 shrink-0 space-y-6 rounded-2xl border border-gray-100 bg-white p-6">
      {/* Header */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400">
          Traveler Profile
        </p>
        <div className="mt-3 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-900 text-white">
            <User className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">{profile.name}</p>
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <Globe className="h-3 w-3" />
              {profile.nationality}
            </div>
          </div>
        </div>
      </div>

      <hr className="border-gray-100" />

      {/* Details */}
      <div className="space-y-4">
        <DetailRow
          icon={<Users className="h-4 w-4" />}
          label="Group Size"
          value={`${profile.groupSize} guests`}
        />
        <DetailRow
          icon={<Wallet className="h-4 w-4" />}
          label="Budget Tier"
        >
          <Badge
            label={profile.budgetTier}
            variant={budgetColors[profile.budgetTier]}
            size="sm"
          />
        </DetailRow>
        <DetailRow
          icon={<Calendar className="h-4 w-4" />}
          label="Dates"
          value={`${formatDate(profile.arrivalDate)} → ${formatDate(profile.departureDate)}`}
        />
      </div>

      <hr className="border-gray-100" />

      {/* Interests */}
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-gray-400">
          Interests
        </p>
        <div className="flex flex-wrap gap-1.5">
          {profile.interests.map((interest) => (
            <Badge key={interest} label={interest} variant="default" size="sm" />
          ))}
        </div>
      </div>

      {/* Dietary */}
      {profile.dietaryRestrictions.length > 0 && (
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-gray-400">
            <Utensils className="h-3 w-3" /> Dietary
          </p>
          <div className="flex flex-wrap gap-1.5">
            {profile.dietaryRestrictions.map((r) => (
              <Badge key={r} label={r} variant="warning" size="sm" />
            ))}
          </div>
        </div>
      )}

      {/* Mobility */}
      {profile.mobilityNotes && (
        <div className="rounded-lg bg-blue-50 p-3">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-blue-600">
            <Accessibility className="h-3 w-3" /> Mobility Note
          </p>
          <p className="mt-1 text-xs leading-relaxed text-blue-700">
            {profile.mobilityNotes}
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
      {children ?? <span className="text-xs font-medium text-gray-900">{value}</span>}
    </div>
  );
}

function SidebarSkeleton() {
  return (
    <aside className="w-72 shrink-0 space-y-6 rounded-2xl border border-gray-100 bg-white p-6">
      <div>
        <Skeleton className="h-3 w-24" />
        <div className="mt-3 flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-full" />
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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
