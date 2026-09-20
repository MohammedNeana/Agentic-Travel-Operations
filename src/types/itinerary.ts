export interface TravelerProfile {
  id: string;
  tenantId?: string;
  name: string;
  nationality: string;
  groupSize: number;
  budgetTier: 'economy' | 'standard' | 'premium' | 'luxury' | string;
  interests: string[];
  dietaryRestrictions: string[];
  mobilityNotes: string;
  arrivalDate: string;
  departureDate: string;
}

export interface ExperienceProvider {
  id: string;
  tenantId: string;
  name: string;
  city: string;
  experienceType: string;
  capacity: number;
  verificationStatus: 'pending' | 'verified' | 'rejected';
  phoneNumber?: string;
  matchScore?: number;
  description?: string;
  priceRange?: string;
  rating?: number;
  imageUrl?: string;
}

export interface ItineraryEvent {
  id: string;
  tenantId: string;
  itineraryId: string;
  experienceProviderId?: string;
  title: string;
  description?: string;
  eventDate: string;
  startTime: string;
  endTime: string;
  sortOrder: number;
  status: 'planned' | 'confirmed' | 'cancelled' | 'escalated';
  escalationReason?: string;
  provider?: ExperienceProvider;
}

export interface Itinerary {
  id: string;
  tenantId: string;
  organizationId: string;
  title: string;
  description?: string;
  startDate: string;
  endDate: string;
  status: 'draft' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';
  guestCount: number;
  events: ItineraryEvent[];
}

export type WarningSeverity = 'error' | 'warning' | 'info';

export interface ScheduleWarning {
  id: string;
  severity: WarningSeverity;
  title: string;
  message: string;
  detail?: string;
  relatedEventIds?: string[];
}

export interface SmartMatchRecommendation {
  provider: ExperienceProvider;
  matchScore: number;
  reasons: string[];
}
