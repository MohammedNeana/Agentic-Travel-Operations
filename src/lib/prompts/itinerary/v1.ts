import { PromptDefinition } from '../types';

export interface ItineraryGenerationPromptInput {
  destination: string;
  durationDays: number;
  travelerPreferences: string[];
  budgetTier?: string;
  groupSize?: number;
}

export const itineraryPromptV1: PromptDefinition<ItineraryGenerationPromptInput> = {
  metadata: {
    id: 'itinerary-planner',
    version: '1.0.0',
    name: 'Smart Itinerary Generator',
    description: 'Generates day-by-day itineraries tailored to Saudi destinations with realistic buffer times',
    author: 'Mohammed Neanaa',
    createdAt: '2026-09-25',
    recommendedModel: 'llama-3.3-70b-versatile',
    recommendedTemperature: 0.2,
  },
  getSystemPrompt: () =>
    `You are the Senior DMC Destination Planner in Saudi Arabia. Design authentic, minute-level itineraries adhering strictly to minimum transit buffers (at least 30-60 minutes between remote sites). Output pure JSON.`,
  formatUserPrompt: (input) =>
    `Destination: ${input.destination}
Duration: ${input.durationDays} days
Group Size: ${input.groupSize || 2}
Budget: ${input.budgetTier || 'luxury'}
Preferences: ${(input.travelerPreferences || []).join(', ')}`,
};
