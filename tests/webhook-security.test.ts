import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import {
  validateVerificationChallenge,
  verifyWebhookSignature,
} from '@/lib/whatsapp/parser';

describe('Webhook Security Verification', () => {
  const testSecret = 'super_secure_meta_app_secret_12345';
  const testToken = 'my_test_verification_token_abc';

  it('rejects challenge verification if configured token is missing or empty', () => {
    const params = new URLSearchParams({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'any_token',
      'hub.challenge': 'challenge_code_999',
    });

    const result = validateVerificationChallenge(params, '');
    expect(result.isValid).toBe(false);
    expect(result.challenge).toBeNull();
  });

  it('rejects challenge verification on token mismatch', () => {
    const params = new URLSearchParams({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'wrong_token',
      'hub.challenge': 'challenge_code_999',
    });

    const result = validateVerificationChallenge(params, testToken);
    expect(result.isValid).toBe(false);
    expect(result.challenge).toBeNull();
  });

  it('accepts challenge verification when mode, token, and challenge match', () => {
    const params = new URLSearchParams({
      'hub.mode': 'subscribe',
      'hub.verify_token': testToken,
      'hub.challenge': 'valid_challenge_123',
    });

    const result = validateVerificationChallenge(params, testToken);
    expect(result.isValid).toBe(true);
    expect(result.challenge).toBe('valid_challenge_123');
  });

  it('fails closed when appSecret is empty or unset in verifyWebhookSignature', () => {
    const payload = JSON.stringify({ entry: [] });
    const signature = 'sha256=abcdef123456';

    expect(verifyWebhookSignature(payload, signature, '')).toBe(false);
    expect(verifyWebhookSignature(payload, signature, 'your_whatsapp_app_secret_here')).toBe(false);
    expect(verifyWebhookSignature(payload, null, testSecret)).toBe(false);
  });

  it('verifies genuine HMAC sha256 signatures correctly', () => {
    const rawBody = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ id: '123' }],
    });

    const validHash = crypto
      .createHmac('sha256', testSecret)
      .update(rawBody, 'utf8')
      .digest('hex');

    const validHeader = `sha256=${validHash}`;
    expect(verifyWebhookSignature(rawBody, validHeader, testSecret)).toBe(true);

    const tamperedBody = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ id: '999' }],
    });
    expect(verifyWebhookSignature(tamperedBody, validHeader, testSecret)).toBe(false);

    const forgedHeader = 'sha256=deadbeefcafebabe';
    expect(verifyWebhookSignature(rawBody, forgedHeader, testSecret)).toBe(false);
  });
});
