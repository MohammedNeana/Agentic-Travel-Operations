import type {
  TravelerProfile,
  ExperienceProvider,
  ItineraryEvent,
  ScheduleWarning,
  SmartMatchRecommendation,
} from '@/types/itinerary';

// ─── Traveler Profile ────────────────────────────────────────

export const mockTravelerProfile: TravelerProfile = {
  id: 'tp-001',
  name: 'Tanaka Yuki',
  nationality: 'Japanese',
  groupSize: 6,
  budgetTier: 'premium',
  interests: ['Heritage & Culture', 'Desert Safari', 'Culinary Experiences', 'Photography'],
  dietaryRestrictions: ['Halal', 'No shellfish'],
  mobilityNotes: 'One elderly guest — wheelchair-accessible venues preferred',
  arrivalDate: '2026-10-15',
  departureDate: '2026-10-20',
};

// ─── Experience Providers ────────────────────────────────────

export const mockProviders: ExperienceProvider[] = [
  {
    id: 'ep-001',
    tenantId: 'tenant-001',
    name: 'AlUla Heritage Tours',
    city: 'AlUla',
    experienceType: 'Heritage & Culture',
    capacity: 20,
    verificationStatus: 'verified',
    description: 'Guided tours through Hegra and the ancient Nabataean tombs with expert archaeologists.',
    priceRange: '$$$',
    rating: 4.9,
    imageUrl: '/globe.svg',
  },
  {
    id: 'ep-002',
    tenantId: 'tenant-001',
    name: 'Rub\' al Khali Expeditions',
    city: 'Riyadh',
    experienceType: 'Desert Safari',
    capacity: 12,
    verificationStatus: 'verified',
    description: 'Luxury desert camping with stargazing, dune bashing, and traditional Bedouin dining.',
    priceRange: '$$$$',
    rating: 4.8,
    imageUrl: '/globe.svg',
  },
  {
    id: 'ep-003',
    tenantId: 'tenant-001',
    name: 'Jeddah Culinary Collective',
    city: 'Jeddah',
    experienceType: 'Culinary Experiences',
    capacity: 15,
    verificationStatus: 'verified',
    description: 'Farm-to-table Saudi cuisine workshops in the historic Al-Balad district.',
    priceRange: '$$',
    rating: 4.7,
    imageUrl: '/globe.svg',
  },
  {
    id: 'ep-004',
    tenantId: 'tenant-001',
    name: 'Red Sea Diving Co.',
    city: 'NEOM',
    experienceType: 'Adventure',
    capacity: 8,
    verificationStatus: 'pending',
    description: 'Premium diving experiences along the Red Sea coral reefs near NEOM.',
    priceRange: '$$$',
    rating: 4.5,
    imageUrl: '/globe.svg',
  },
  {
    id: 'ep-005',
    tenantId: 'tenant-001',
    name: 'Diriyah Gate Photography Walks',
    city: 'Riyadh',
    experienceType: 'Photography',
    capacity: 10,
    verificationStatus: 'verified',
    description: 'Golden hour photography walks through the restored Diriyah heritage quarter.',
    priceRange: '$$',
    rating: 4.6,
    imageUrl: '/globe.svg',
  },
];

// ─── Itinerary Events ────────────────────────────────────────

export const mockEvents: ItineraryEvent[] = [
  {
    id: 'ev-001',
    tenantId: 'tenant-001',
    itineraryId: 'it-001',
    experienceProviderId: 'ep-001',
    title: 'Hegra Tomb Exploration',
    description: 'Guided tour of the UNESCO World Heritage Nabataean tombs at sunrise.',
    eventDate: '2026-10-16',
    startTime: '06:00',
    endTime: '10:00',
    sortOrder: 1,
    status: 'confirmed',
    provider: mockProviders[0],
  },
  {
    id: 'ev-002',
    tenantId: 'tenant-001',
    itineraryId: 'it-001',
    experienceProviderId: 'ep-003',
    title: 'Al-Balad Culinary Workshop',
    description: 'Hands-on Saudi cooking class featuring regional dishes from Hejaz.',
    eventDate: '2026-10-17',
    startTime: '11:00',
    endTime: '14:00',
    sortOrder: 2,
    status: 'confirmed',
    provider: mockProviders[2],
  },
  {
    id: 'ev-003',
    tenantId: 'tenant-001',
    itineraryId: 'it-001',
    experienceProviderId: 'ep-002',
    title: 'Desert Overnight Safari',
    description: 'Luxury Bedouin camp experience with stargazing and traditional entertainment.',
    eventDate: '2026-10-18',
    startTime: '15:00',
    endTime: '23:59',
    sortOrder: 3,
    status: 'planned',
    provider: mockProviders[1],
  },
  {
    id: 'ev-004',
    tenantId: 'tenant-001',
    itineraryId: 'it-001',
    experienceProviderId: 'ep-005',
    title: 'Diriyah Golden Hour Shoot',
    description: 'Photography walk through the beautifully lit heritage quarter at sunset.',
    eventDate: '2026-10-18',
    startTime: '16:00',
    endTime: '19:00',
    sortOrder: 4,
    status: 'planned',
    provider: mockProviders[4],
  },
  {
    id: 'ev-005',
    tenantId: 'tenant-001',
    itineraryId: 'it-001',
    title: 'Farewell Dinner at Globe Restaurant',
    description: 'Panoramic dining experience at the iconic Riyadh Globe.',
    eventDate: '2026-10-19',
    startTime: '19:00',
    endTime: '22:00',
    sortOrder: 5,
    status: 'planned',
  },
];

// ─── Schedule Warnings ───────────────────────────────────────

export const mockWarnings: ScheduleWarning[] = [
  {
    id: 'w-001',
    severity: 'error',
    title: 'Scheduling Conflict Detected',
    message: 'Desert Overnight Safari (15:00–23:59) overlaps with Diriyah Golden Hour Shoot (16:00–19:00) on Oct 18.',
    relatedEventIds: ['ev-003', 'ev-004'],
  },
  {
    id: 'w-002',
    severity: 'warning',
    title: 'Capacity Concern',
    message: 'Red Sea Diving Co. max capacity is 8 guests — your group of 6 leaves minimal buffer for guides.',
  },
  {
    id: 'w-003',
    severity: 'info',
    title: 'Accessibility Note',
    message: 'Confirm wheelchair accessibility at Hegra Tomb Exploration — terrain may be uneven.',
    relatedEventIds: ['ev-001'],
  },
];

// ─── Smart Match Recommendations ─────────────────────────────

export const mockRecommendations: SmartMatchRecommendation[] = [
  {
    provider: mockProviders[0],
    matchScore: 97,
    reasons: ['Matches "Heritage & Culture" interest', 'Verified provider', 'High rating (4.9★)'],
  },
  {
    provider: mockProviders[1],
    matchScore: 94,
    reasons: ['Matches "Desert Safari" interest', 'Luxury tier aligns with budget', 'Verified provider'],
  },
  {
    provider: mockProviders[2],
    matchScore: 91,
    reasons: ['Matches "Culinary Experiences" interest', 'Capacity fits group (15 > 6)', 'Halal compliant'],
  },
  {
    provider: mockProviders[4],
    matchScore: 88,
    reasons: ['Matches "Photography" interest', 'Verified provider', 'Wheelchair-friendly venue'],
  },
  {
    provider: mockProviders[3],
    matchScore: 72,
    reasons: ['Adventure experience type', 'Near capacity limit — may be tight'],
  },
];
