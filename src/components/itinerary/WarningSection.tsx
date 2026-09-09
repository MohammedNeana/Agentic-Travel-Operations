import { WarningBanner } from '@/components/ui/WarningBanner';
import { Skeleton } from '@/components/ui/Skeleton';
import type { ScheduleWarning } from '@/types/itinerary';

interface WarningSectionProps {
  warnings: ScheduleWarning[];
  isLoading?: boolean;
}

export function WarningSection({ warnings, isLoading = false }: WarningSectionProps) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (warnings.length === 0) return null;

  return (
    <div className="space-y-2.5">
      {warnings.map((warning) => (
        <WarningBanner
          key={warning.id}
          severity={warning.severity}
          title={warning.title}
          message={warning.message}
        />
      ))}
    </div>
  );
}
