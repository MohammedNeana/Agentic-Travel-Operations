import { describe, it, expect } from 'vitest';
import { getPrompt, getDefaultPrompt, listAvailablePrompts } from '@/lib/prompts/registry';

describe('Structured Prompt Versioning & Registry', () => {
  it('registers and retrieves prompts by explicit ID and version', () => {
    const v1 = getPrompt('intent-classifier', '1.0.0');
    expect(v1).toBeDefined();
    expect(v1?.metadata.version).toBe('1.0.0');
    expect(v1?.metadata.recommendedModel).toBe('llama-3.3-70b-versatile');

    const v2 = getPrompt('intent-classifier', '2.0.0');
    expect(v2).toBeDefined();
    expect(v2?.metadata.version).toBe('2.0.0');
    expect(v2?.metadata.description).toContain('timing disambiguation');
  });

  it('retrieves default production version for registered prompt families', () => {
    const defaultIntent = getDefaultPrompt('intent-classifier');
    expect(defaultIntent?.metadata.version).toBe('2.0.0');

    const defaultOrchestrator = getDefaultPrompt('operations-orchestrator');
    expect(defaultOrchestrator?.metadata.version).toBe('1.0.0');
  });

  it('correctly formats prompt system and user content with input parameters', () => {
    const prompt = getPrompt<any>('operations-orchestrator', '1.0.0');
    expect(prompt).toBeDefined();

    const systemPrompt = prompt!.getSystemPrompt({
      travelerNationality: 'French',
      groupSize: 5,
    });
    expect(systemPrompt).toContain('French');
    expect(systemPrompt).toContain('5');

    const userPrompt = prompt!.formatUserPrompt({
      vendorMessage: 'تأخير الطريق',
      targetEventTitle: 'Desert Safari',
      targetStartTime: '09:00',
      targetEndTime: '12:00',
      scheduleDescription: 'Full Day Itinerary',
    });
    expect(userPrompt).toContain('Desert Safari');
    expect(userPrompt).toContain('تأخير الطريق');
  });

  it('lists all available prompts and their registered versions', () => {
    const available = listAvailablePrompts();
    expect(available.length).toBeGreaterThanOrEqual(2);

    const intentPrompt = available.find((p) => p.id === 'intent-classifier');
    expect(intentPrompt).toBeDefined();
    expect(intentPrompt?.versions).toContain('1.0.0');
    expect(intentPrompt?.versions).toContain('2.0.0');
  });
});
