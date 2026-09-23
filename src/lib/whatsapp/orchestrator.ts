import { createServerSupabaseClient } from '@/lib/supabase/server';
import { SupabaseClient } from '@supabase/supabase-js';
import {
  OrchestrationExecutionResult,
} from './types';
import { LLMProvider } from '@/lib/ports/llm.port';
import {
  ItineraryRepository,
  SupplierRepository,
} from '@/lib/ports/repository.port';
import { NotificationGateway } from '@/lib/ports/notification.port';
import { GroqLLMAdapter } from '@/lib/adapters/groq-llm.adapter';
import {
  SupabaseItineraryRepository,
  SupabaseSupplierRepository,
} from '@/lib/adapters/supabase-repository.adapter';
import { WhatsAppNotificationAdapter } from '@/lib/adapters/whatsapp-notification.adapter';
import {
  TravelOperationsOrchestrator,
  TravelOperationsOrchestratorDependencies,
  OrchestrationRequest,
} from '@/lib/application/travel-operations.orchestrator';

export type { TravelOperationsOrchestratorDependencies };
export { TravelOperationsOrchestrator };

export interface OrchestrationDependencies {
  llmProvider?: LLMProvider;
  itineraryRepo?: ItineraryRepository;
  supplierRepo?: SupplierRepository;
  notificationGateway?: NotificationGateway;
}

export function createDefaultOrchestrationDependencies(client?: SupabaseClient): TravelOperationsOrchestratorDependencies {
  const supabase = client || createServerSupabaseClient();
  return {
    itineraryRepo: new SupabaseItineraryRepository(supabase),
    supplierRepo: new SupabaseSupplierRepository(supabase),
    notificationGateway: new WhatsAppNotificationAdapter(supabase),
    llmProvider: new GroqLLMAdapter(),
  };
}

export function createDefaultTravelOperationsOrchestrator(client?: SupabaseClient): TravelOperationsOrchestrator {
  const deps = createDefaultOrchestrationDependencies(client);
  return new TravelOperationsOrchestrator(deps);
}

export async function orchestrateItineraryCascade(
  options: OrchestrationRequest,
  dependencies?: OrchestrationDependencies
): Promise<OrchestrationExecutionResult> {
  let resolvedDeps: TravelOperationsOrchestratorDependencies;

  if (
    dependencies?.itineraryRepo &&
    dependencies?.supplierRepo &&
    dependencies?.notificationGateway &&
    dependencies?.llmProvider
  ) {
    resolvedDeps = {
      itineraryRepo: dependencies.itineraryRepo,
      supplierRepo: dependencies.supplierRepo,
      notificationGateway: dependencies.notificationGateway,
      llmProvider: dependencies.llmProvider,
    };
  } else if (dependencies) {
    const supabase = createServerSupabaseClient();
    resolvedDeps = {
      itineraryRepo: dependencies.itineraryRepo || new SupabaseItineraryRepository(supabase),
      supplierRepo: dependencies.supplierRepo || new SupabaseSupplierRepository(supabase),
      notificationGateway:
        dependencies.notificationGateway || new WhatsAppNotificationAdapter(supabase),
      llmProvider: dependencies.llmProvider || new GroqLLMAdapter(),
    };
  } else {
    resolvedDeps = createDefaultOrchestrationDependencies();
  }

  const orchestrator = new TravelOperationsOrchestrator(resolvedDeps);
  return orchestrator.orchestrateCascade(options);
}
