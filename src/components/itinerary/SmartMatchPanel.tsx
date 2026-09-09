'use client';

import { Sparkles, Star, CheckCircle2, Users, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { SkeletonCard } from '@/components/ui/Skeleton';
import type { SmartMatchRecommendation } from '@/types/itinerary';

interface SmartMatchPanelProps {
  recommendations: SmartMatchRecommendation[];
  isLoading: boolean;
}

export function SmartMatchPanel({ recommendations, isLoading }: SmartMatchPanelProps) {
  return (
    <div className="w-80 shrink-0 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-violet-500" />
        <h2 className="text-sm font-semibold text-gray-900">Smart Match</h2>
        <span className="ml-auto text-[11px] text-gray-400">AI-ranked</span>
      </div>

      {/* Cards */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {recommendations.map((rec, index) => (
            <RecommendationCard key={rec.provider.id} recommendation={rec} rank={index + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Recommendation Card ─────────────────────────────────────

function RecommendationCard({
  recommendation,
  rank,
}: {
  recommendation: SmartMatchRecommendation;
  rank: number;
}) {
  const { provider, matchScore, reasons } = recommendation;

  const verificationBadge =
    provider.verificationStatus === 'verified'
      ? 'success'
      : provider.verificationStatus === 'pending'
        ? 'warning'
        : 'danger';

  return (
    <button
      type="button"
      className="group w-full rounded-xl border border-gray-100 bg-white p-4 text-left transition-all hover:border-violet-200 hover:shadow-md"
    >
      {/* Top row: rank + score */}
      <div className="flex items-center justify-between">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-100 text-[10px] font-bold text-gray-500">
          {rank}
        </span>
        <ScoreBadge score={matchScore} />
      </div>

      {/* Provider info */}
      <div className="mt-3">
        <div className="flex items-center gap-1.5">
          <h3 className="text-sm font-semibold text-gray-900 truncate">{provider.name}</h3>
          {provider.verificationStatus === 'verified' && (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
          )}
        </div>

        <div className="mt-1 flex items-center gap-3 text-xs text-gray-400">
          <span>{provider.city}</span>
          <span className="flex items-center gap-0.5">
            <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
            {provider.rating}
          </span>
          <span className="flex items-center gap-0.5">
            <Users className="h-3 w-3" />
            {provider.capacity}
          </span>
        </div>
      </div>

      {/* Tags */}
      <div className="mt-2.5 flex items-center gap-1.5">
        <Badge label={provider.experienceType} variant="default" size="sm" />
        <Badge label={provider.verificationStatus} variant={verificationBadge} size="sm" />
        {provider.priceRange && (
          <span className="text-[11px] text-gray-400">{provider.priceRange}</span>
        )}
      </div>

      {/* Reasons */}
      <div className="mt-3 space-y-1">
        {reasons.slice(0, 3).map((reason) => (
          <p key={reason} className="text-[11px] leading-snug text-gray-500">
            • {reason}
          </p>
        ))}
      </div>

      {/* CTA */}
      <div className="mt-3 flex items-center justify-end text-xs font-medium text-violet-500 opacity-0 transition-opacity group-hover:opacity-100">
        Add to itinerary
        <ChevronRight className="ml-0.5 h-3 w-3" />
      </div>
    </button>
  );
}

// ─── Score Badge ─────────────────────────────────────────────

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 90
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
      : score >= 75
        ? 'bg-amber-50 text-amber-700 ring-amber-200'
        : 'bg-gray-50 text-gray-600 ring-gray-200';

  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${color}`}>
      {score}% match
    </span>
  );
}
