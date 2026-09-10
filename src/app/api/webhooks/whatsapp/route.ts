import { NextRequest, NextResponse } from 'next/server';
import type { WhatsAppWebhookPayload, WebhookProcessingResult } from '@/lib/whatsapp/types';
import {
  validateVerificationChallenge,
  verifyWebhookSignature,
  extractWhatsAppMessages,
} from '@/lib/whatsapp/parser';
import { fetchAndDownloadWhatsAppAudio } from '@/lib/whatsapp/media';
import { transcribeArabicAudio } from '@/lib/whatsapp/transcription';
import { classifyVoiceIntent } from '@/lib/whatsapp/intent';
import { confirmItineraryEvent, escalateItineraryEvent } from '@/lib/whatsapp/events';

export const dynamic = 'force-dynamic';

/**
 * GET: Handles WhatsApp Cloud API Webhook Subscription Verification.
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const { isValid, challenge } = validateVerificationChallenge(searchParams);

  if (isValid && challenge) {
    return new Response(challenge, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  return NextResponse.json(
    { error: 'Forbidden: Webhook verification token mismatch' },
    { status: 403 }
  );
}

/**
 * POST: Processes incoming WhatsApp Cloud API events:
 * 1. Interactive Button Replies (e.g., accept_booking_{id}) -> confirms booking in Supabase.
 * 2. Audio Voice Notes -> downloads audio, transcribes via Whisper, classifies intent via LLM,
 *    and escalates in Supabase if Delay or Emergency detected.
 */
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get('x-hub-signature-256');

    // 1. Verify payload signature
    const isSignatureValid = verifyWebhookSignature(rawBody, signature);
    if (!isSignatureValid) {
      console.error('Invalid WhatsApp X-Hub-Signature-256 header.');
      return NextResponse.json({ error: 'Unauthorized: Invalid signature' }, { status: 401 });
    }

    // 2. Parse JSON payload
    let payload: WhatsAppWebhookPayload;
    try {
      payload = JSON.parse(rawBody) as WhatsAppWebhookPayload;
    } catch {
      return NextResponse.json({ error: 'Bad Request: Malformed JSON' }, { status: 400 });
    }

    // 3. Extract normalized message contexts
    const messages = extractWhatsAppMessages(payload);

    if (messages.length === 0) {
      return NextResponse.json({
        success: true,
        actionTaken: 'no_action_needed',
        message: 'No user messages found in webhook payload.',
      });
    }

    const processingResults: WebhookProcessingResult[] = [];

    for (const msg of messages) {
      // Case A: Interactive Button Reply
      if (msg.action?.type === 'accept_booking') {
        const updateResult = await confirmItineraryEvent(msg.action.eventId);

        processingResults.push({
          success: updateResult.success,
          messageId: msg.messageId,
          actionTaken: 'booking_confirmed',
          details: {
            eventId: msg.action.eventId,
            buttonTitle: msg.action.buttonTitle,
            title: updateResult.title,
            newStatus: updateResult.newStatus,
          },
          error: updateResult.error,
        });
        continue;
      }

      // Case B: Audio Voice Message Processing
      if (msg.audio) {
        try {
          // 1. Download voice note audio binary
          const audioMedia = await fetchAndDownloadWhatsAppAudio(msg.audio.mediaId);

          // 2. Transcribe voice note using OpenAI Whisper API
          const transcription = await transcribeArabicAudio(
            audioMedia.buffer,
            audioMedia.fileName,
            audioMedia.mimeType
          );

          // 3. Classify voice intent via LLM
          const classification = await classifyVoiceIntent(transcription.text);

          // 4. If Emergency or Delay, escalate event in Supabase
          if (classification.isEscalationRequired) {
            const escalationResult = await escalateItineraryEvent({
              transcriptionText: transcription.text,
              reason: classification.reason,
              senderPhone: msg.fromPhoneNumber,
            });

            processingResults.push({
              success: escalationResult.success,
              messageId: msg.messageId,
              actionTaken: 'event_escalated',
              details: {
                from: msg.fromPhoneNumber,
                senderName: msg.contactName,
                transcriptionText: transcription.text,
                category: classification.category,
                reason: classification.reason,
                suggestedAction: classification.suggestedAction,
                escalatedEventId: escalationResult.eventId,
                eventTitle: escalationResult.title,
              },
              error: escalationResult.error,
            });
          } else {
            processingResults.push({
              success: true,
              messageId: msg.messageId,
              actionTaken: 'voice_general_logged',
              details: {
                from: msg.fromPhoneNumber,
                transcriptionText: transcription.text,
                category: classification.category,
                reason: classification.reason,
              },
            });
          }
        } catch (audioErr) {
          console.error('Error in audio message processing pipeline:', audioErr);
          processingResults.push({
            success: false,
            messageId: msg.messageId,
            actionTaken: 'unhandled_action',
            error: audioErr instanceof Error ? audioErr.message : 'Unknown audio error',
          });
        }
        continue;
      }

      // Default: Non-actionable message (standard text, etc.)
      processingResults.push({
        success: true,
        messageId: msg.messageId,
        actionTaken: 'no_action_needed',
        details: { type: msg.rawType, from: msg.fromPhoneNumber },
      });
    }

    return NextResponse.json({
      success: true,
      processedCount: processingResults.length,
      results: processingResults,
    });
  } catch (error) {
    console.error('Unexpected error in WhatsApp webhook route:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal Server Error',
      },
      { status: 500 }
    );
  }
}
