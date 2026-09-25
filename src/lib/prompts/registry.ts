import { PromptDefinition } from './types';
import { intentClassifierPromptV1 } from './intent-classifier/v1';
import { intentClassifierPromptV2 } from './intent-classifier/v2';
import { orchestratorPromptV1 } from './orchestrator/v1';
import { itineraryPromptV1 } from './itinerary/v1';

const promptRegistry = new Map<string, Map<string, PromptDefinition<any>>>();

function registerPrompt(prompt: PromptDefinition<any>): void {
  const { id, version } = prompt.metadata;
  if (!promptRegistry.has(id)) {
    promptRegistry.set(id, new Map());
  }
  promptRegistry.get(id)!.set(version, prompt);
}

registerPrompt(intentClassifierPromptV1);
registerPrompt(intentClassifierPromptV2);
registerPrompt(orchestratorPromptV1);
registerPrompt(itineraryPromptV1);

export function getPrompt<TInput = Record<string, unknown>>(
  id: string,
  version: string
): PromptDefinition<TInput> | undefined {
  return promptRegistry.get(id)?.get(version) as PromptDefinition<TInput> | undefined;
}

export function getDefaultPrompt<TInput = Record<string, unknown>>(
  id: string
): PromptDefinition<TInput> | undefined {
  if (id === 'intent-classifier') {
    return intentClassifierPromptV2 as PromptDefinition<TInput>;
  }
  if (id === 'operations-orchestrator') {
    return orchestratorPromptV1 as PromptDefinition<TInput>;
  }
  const versions = promptRegistry.get(id);
  if (!versions || versions.size === 0) return undefined;
  const latestKey = Array.from(versions.keys()).sort().reverse()[0];
  return versions.get(latestKey) as PromptDefinition<TInput> | undefined;
}

export function listAvailablePrompts(): Array<{ id: string; versions: string[] }> {
  const list: Array<{ id: string; versions: string[] }> = [];
  promptRegistry.forEach((versionMap, id) => {
    list.push({
      id,
      versions: Array.from(versionMap.keys()),
    });
  });
  return list;
}
