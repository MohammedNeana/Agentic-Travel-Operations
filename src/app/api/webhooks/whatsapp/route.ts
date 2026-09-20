import { NextRequest, NextResponse } from 'next/server';
import type { WhatsAppWebhookPayload, WebhookProcessingResult } from '@/lib/whatsapp/types';
import {
  validateVerificationChallenge,
  verifyWebhookSignature,
  extractWhatsAppMessages,
} from '@/lib/whatsapp/parser';
import { fetchAndDownloadWhatsAppAudio } from '@/lib/whatsapp/media';
import { transcribeArabicAudio } from '@/lib/whatsapp/transcription';
import { classifyWhatsAppMessageIntent } from '@/lib/whatsapp/intent';
import {
  confirmItineraryEvent,
  rejectItineraryEvent,
  escalateItineraryEvent,
  findEventForProvider,
} from '@/lib/whatsapp/events';

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
 * 1. Interactive Button Replies:
 *    - accept_booking_{id} -> confirms booking in Supabase.
 *    - reject_booking_{id} -> cancels/rejects booking in Supabase.
 * 2. Voice Notes (audio):
 *    - Transcribes via Groq Whisper (`whisper-large-v3`).
 *    - Classifies intent via Groq LLM (Acceptance, Rejection, Delay, Emergency).
 *    - Updates itinerary event status in Supabase.
 * 3. Text Messages (text):
 *    - Classifies text directly via Groq LLM.
 *    - Updates itinerary event status in Supabase based on Acceptance, Rejection, or Delay.
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
      // ──────────────────────────────────────────────────────────
      // Case A: Interactive Button Reply
      // ──────────────────────────────────────────────────────────
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

      if (msg.action?.type === 'reject_booking') {
        const updateResult = await rejectItineraryEvent(
          msg.action.eventId,
          `اعتذار عبر زر واتساب (${msg.action.buttonTitle})`
        );

        processingResults.push({
          success: updateResult.success,
          messageId: msg.messageId,
          actionTaken: 'booking_rejected',
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

      // ──────────────────────────────────────────────────────────
      // Case B: Audio Voice Message Processing (Whisper + Groq LLM)
      // ──────────────────────────────────────────────────────────
      if (msg.audio) {
        try {
          // 1. Download voice note audio binary
          const audioMedia = await fetchAndDownloadWhatsAppAudio(msg.audio.mediaId);

          // 2. Transcribe voice note using Groq Whisper API
          const transcription = await transcribeArabicAudio(
            audioMedia.buffer,
            audioMedia.fileName,
            audioMedia.mimeType
          );

          console.log(`[WhatsApp Webhook] 🎙️ Transcribed audio from ${msg.fromPhoneNumber}: "${transcription.text}"`);

          // 3. Classify voice intent via Groq LLM (Acceptance, Rejection, Delay, Emergency)
          const classification = await classifyWhatsAppMessageIntent(transcription.text);

          // 4. Resolve the relevant event for this provider
          const targetEventId = await findEventForProvider({
            senderPhone: msg.fromPhoneNumber,
            messageText: transcription.text,
          });

          if (classification.category === 'Acceptance' && targetEventId) {
            const confirmResult = await confirmItineraryEvent(targetEventId);
            processingResults.push({
              success: confirmResult.success,
              messageId: msg.messageId,
              actionTaken: 'booking_confirmed',
              details: {
                eventId: targetEventId,
                title: confirmResult.title,
                transcriptionText: transcription.text,
                reason: classification.reason,
              },
            });
          } else if (classification.category === 'Rejection' && targetEventId) {
            const rejectResult = await rejectItineraryEvent(targetEventId, classification.reason);
            processingResults.push({
              success: rejectResult.success,
              messageId: msg.messageId,
              actionTaken: 'booking_rejected',
              details: {
                eventId: targetEventId,
                title: rejectResult.title,
                transcriptionText: transcription.text,
                reason: classification.reason,
              },
            });
          } else if (classification.isEscalationRequired) {
            const escalationResult = await escalateItineraryEvent({
              eventId: targetEventId,
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

      // ──────────────────────────────────────────────────────────
      // Case C: Freeform Text Message (Direct Groq LLM Analysis)
      // ──────────────────────────────────────────────────────────
      if (msg.textBody && msg.textBody.trim().length > 0) {
        try {
          console.log(`[WhatsApp Webhook] 💬 Analyzing text message from ${msg.fromPhoneNumber}: "${msg.textBody}"`);

          // 1. Classify intent via Groq LLM
          const classification = await classifyWhatsAppMessageIntent(msg.textBody);

          // 2. Resolve the relevant event for this provider
          const targetEventId = await findEventForProvider({
            senderPhone: msg.fromPhoneNumber,
            messageText: msg.textBody,
          });

          if (classification.category === 'Acceptance' && targetEventId) {
            const confirmResult = await confirmItineraryEvent(targetEventId);
            processingResults.push({
              success: confirmResult.success,
              messageId: msg.messageId,
              actionTaken: 'booking_confirmed',
              details: {
                eventId: targetEventId,
                title: confirmResult.title,
                textBody: msg.textBody,
                reason: classification.reason,
              },
            });
          } else if (classification.category === 'Rejection' && targetEventId) {
            const rejectResult = await rejectItineraryEvent(targetEventId, classification.reason);
            processingResults.push({
              success: rejectResult.success,
              messageId: msg.messageId,
              actionTaken: 'booking_rejected',
              details: {
                eventId: targetEventId,
                title: rejectResult.title,
                textBody: msg.textBody,
                reason: classification.reason,
              },
            });
          } else if (classification.isEscalationRequired) {
            const escalationResult = await escalateItineraryEvent({
              eventId: targetEventId,
              transcriptionText: msg.textBody,
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
                textBody: msg.textBody,
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
              actionTaken: 'no_action_needed',
              details: {
                from: msg.fromPhoneNumber,
                textBody: msg.textBody,
                category: classification.category,
                reason: classification.reason,
              },
            });
          }
        } catch (textErr) {
          console.error('Error analyzing text message:', textErr);
          processingResults.push({
            success: false,
            messageId: msg.messageId,
            actionTaken: 'unhandled_action',
            error: textErr instanceof Error ? textErr.message : 'Unknown text error',
          });
        }
        continue;
      }

      // Default: Non-actionable message (stickers, locations without text, etc.)
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
