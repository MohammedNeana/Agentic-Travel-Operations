import { AlertTriangle, Clock, Info, type LucideIcon } from 'lucide-react';
import type { WarningSeverity } from '@/types/itinerary';

interface WarningBannerProps {
  severity: WarningSeverity;
  title: string;
  message: string;
}

const severityConfig: Record<
  WarningSeverity,
  { icon: LucideIcon; bg: string; border: string; text: string; iconColor: string }
> = {
  error: {
    icon: AlertTriangle,
    bg: 'bg-red-50',
    border: 'border-red-200',
    text: 'text-red-800',
    iconColor: 'text-red-500',
  },
  warning: {
    icon: Clock,
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    text: 'text-amber-800',
    iconColor: 'text-amber-500',
  },
  info: {
    icon: Info,
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    text: 'text-blue-800',
    iconColor: 'text-blue-500',
  },
};

export function WarningBanner({ severity, title, message }: WarningBannerProps) {
  const config = severityConfig[severity];
  const Icon = config.icon;

  return (
    <div
      className={`flex items-start gap-3 rounded-xl border px-4 py-3.5 ${config.bg} ${config.border}`}
      role="alert"
    >
      <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${config.iconColor}`} />
      <div className="min-w-0">
        <p className={`text-sm font-semibold ${config.text}`}>{title}</p>
        <p className={`mt-0.5 text-sm leading-relaxed ${config.text} opacity-80`}>
          {message}
        </p>
      </div>
    </div>
  );
}
