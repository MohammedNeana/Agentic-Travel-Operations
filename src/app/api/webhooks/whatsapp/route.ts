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
  getProviderCandidateEvents,
} from '@/lib/whatsapp/events';
import { sendWhatsAppTextMessage } from '@/lib/whatsapp/sender';
import { orchestrateItineraryCascade } from '@/lib/whatsapp/orchestrator';
import { isMessageProcessed, markMessageProcessed } from '@/lib/whatsapp/idempotency';

export const dynamic = 'force-dynamic';

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

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get('x-hub-signature-256');

    const isSignatureValid = verifyWebhookSignature(rawBody, signature);
    if (!isSignatureValid) {
      return NextResponse.json({ error: 'Unauthorized: Invalid signature' }, { status: 401 });
    }

    let payload: WhatsAppWebhookPayload;
    try {
      payload = JSON.parse(rawBody) as WhatsAppWebhookPayload;
    } catch {
      return NextResponse.json({ error: 'Bad Request: Malformed JSON' }, { status: 400 });
    }

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
      if (await isMessageProcessed(msg.messageId)) {
        processingResults.push({
          success: true,
          messageId: msg.messageId,
          actionTaken: 'no_action_needed',
          details: { reason: 'duplicate_delivery_ignored' },
        });
        continue;
      }

      await markMessageProcessed(msg.messageId);

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

      if (msg.audio) {
        try {
          const audioMedia = await fetchAndDownloadWhatsAppAudio(msg.audio.mediaId);

          const transcription = await transcribeArabicAudio(
            audioMedia.buffer,
            audioMedia.fileName,
            audioMedia.mimeType
          );

          const candidateEvents = await getProviderCandidateEvents({
            senderPhone: msg.fromPhoneNumber,
          });

          const classification = await classifyWhatsAppMessageIntent(transcription.text, {
            candidateEvents,
          });

          if (classification.isAmbiguous && classification.clarificationMessage) {
            const replyResult = await sendWhatsAppTextMessage(
              msg.fromPhoneNumber,
              classification.clarificationMessage
            );

            processingResults.push({
              success: replyResult.success,
              messageId: msg.messageId,
              actionTaken: 'clarification_requested',
              details: {
                from: msg.fromPhoneNumber,
                transcriptionText: transcription.text,
                clarificationMessage: classification.clarificationMessage,
                sentMessageId: replyResult.messageId,
                reason: classification.reason,
                suggestedAction: classification.suggestedAction,
              },
              error: replyResult.error,
            });
            continue;
          }

          const targetEventId =
            classification.matchedEventId ||
            (await findEventForProvider({
              senderPhone: msg.fromPhoneNumber,
              messageText: transcription.text,
            }));

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
                matchedGroupSummary: classification.matchedGroupSummary,
                isAmbiguous: classification.isAmbiguous,
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
                matchedGroupSummary: classification.matchedGroupSummary,
                isAmbiguous: classification.isAmbiguous,
                reason: classification.reason,
              },
            });
          } else if (classification.isEscalationRequired) {
            if (targetEventId) {
              const orchestrationResult = await orchestrateItineraryCascade({
                eventId: targetEventId,
                vendorMessage: transcription.text,
                senderPhone: msg.fromPhoneNumber,
              });

              processingResults.push({
                success: orchestrationResult.success,
                messageId: msg.messageId,
                actionTaken: 'schedule_cascade_orchestrated',
                details: {
                  from: msg.fromPhoneNumber,
                  senderName: msg.contactName,
                  transcriptionText: transcription.text,
                  category: classification.category,
                  matchedGroupSummary: classification.matchedGroupSummary,
                  delayMinutes: orchestrationResult.decision?.delayMinutes,
                  isCascadeImpact: orchestrationResult.decision?.isCascadeImpact,
                  updatedEventsCount: orchestrationResult.updatedEventsCount,
                  dispatchedNoticesCount: orchestrationResult.dispatchedNoticesCount,
                  incidentSummary: orchestrationResult.incidentSummary,
                  scheduleAdjustments: orchestrationResult.decision?.scheduleAdjustments,
                  downstreamNotices: orchestrationResult.decision?.downstreamNotices,
                },
                error: orchestrationResult.error,
              });
            } else {
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
                  matchedGroupSummary: classification.matchedGroupSummary,
                  isAmbiguous: classification.isAmbiguous,
                  reason: classification.reason,
                  suggestedAction: classification.suggestedAction,
                  escalatedEventId: escalationResult.eventId,
                  eventTitle: escalationResult.title,
                },
                error: escalationResult.error,
              });
            }
          } else {
            processingResults.push({
              success: true,
              messageId: msg.messageId,
              actionTaken: 'voice_general_logged',
              details: {
                from: msg.fromPhoneNumber,
                transcriptionText: transcription.text,
                category: classification.category,
                matchedGroupSummary: classification.matchedGroupSummary,
                isAmbiguous: classification.isAmbiguous,
                reason: classification.reason,
              },
            });
          }
        } catch (audioErr) {
          processingResults.push({
            success: false,
            messageId: msg.messageId,
            actionTaken: 'unhandled_action',
            error: audioErr instanceof Error ? audioErr.message : 'Unknown audio error',
          });
        }
        continue;
      }

      if (msg.textBody && msg.textBody.trim().length > 0) {
        try {
          const candidateEvents = await getProviderCandidateEvents({
            senderPhone: msg.fromPhoneNumber,
          });

          const classification = await classifyWhatsAppMessageIntent(msg.textBody, {
            candidateEvents,
          });

          if (classification.isAmbiguous && classification.clarificationMessage) {
            const replyResult = await sendWhatsAppTextMessage(
              msg.fromPhoneNumber,
              classification.clarificationMessage
            );

            processingResults.push({
              success: replyResult.success,
              messageId: msg.messageId,
              actionTaken: 'clarification_requested',
              details: {
                from: msg.fromPhoneNumber,
                textBody: msg.textBody,
                clarificationMessage: classification.clarificationMessage,
                sentMessageId: replyResult.messageId,
                reason: classification.reason,
                suggestedAction: classification.suggestedAction,
              },
              error: replyResult.error,
            });
            continue;
          }

          const targetEventId =
            classification.matchedEventId ||
            (await findEventForProvider({
              senderPhone: msg.fromPhoneNumber,
              messageText: msg.textBody,
            }));

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
                matchedGroupSummary: classification.matchedGroupSummary,
                isAmbiguous: classification.isAmbiguous,
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
                matchedGroupSummary: classification.matchedGroupSummary,
                isAmbiguous: classification.isAmbiguous,
                reason: classification.reason,
              },
            });
          } else if (classification.isEscalationRequired) {
            if (targetEventId) {
              const orchestrationResult = await orchestrateItineraryCascade({
                eventId: targetEventId,
                vendorMessage: msg.textBody,
                senderPhone: msg.fromPhoneNumber,
              });

              processingResults.push({
                success: orchestrationResult.success,
                messageId: msg.messageId,
                actionTaken: 'schedule_cascade_orchestrated',
                details: {
                  from: msg.fromPhoneNumber,
                  senderName: msg.contactName,
                  textBody: msg.textBody,
                  category: classification.category,
                  matchedGroupSummary: classification.matchedGroupSummary,
                  delayMinutes: orchestrationResult.decision?.delayMinutes,
                  isCascadeImpact: orchestrationResult.decision?.isCascadeImpact,
                  updatedEventsCount: orchestrationResult.updatedEventsCount,
                  dispatchedNoticesCount: orchestrationResult.dispatchedNoticesCount,
                  incidentSummary: orchestrationResult.incidentSummary,
                  scheduleAdjustments: orchestrationResult.decision?.scheduleAdjustments,
                  downstreamNotices: orchestrationResult.decision?.downstreamNotices,
                },
                error: orchestrationResult.error,
              });
            } else {
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
                  matchedGroupSummary: classification.matchedGroupSummary,
                  isAmbiguous: classification.isAmbiguous,
                  reason: classification.reason,
                  suggestedAction: classification.suggestedAction,
                  escalatedEventId: escalationResult.eventId,
                  eventTitle: escalationResult.title,
                },
                error: escalationResult.error,
              });
            }
          } else {
            processingResults.push({
              success: true,
              messageId: msg.messageId,
              actionTaken: 'no_action_needed',
              details: {
                from: msg.fromPhoneNumber,
                textBody: msg.textBody,
                category: classification.category,
                matchedGroupSummary: classification.matchedGroupSummary,
                isAmbiguous: classification.isAmbiguous,
                reason: classification.reason,
              },
            });
          }
        } catch (textErr) {
          processingResults.push({
            success: false,
            messageId: msg.messageId,
            actionTaken: 'unhandled_action',
            error: textErr instanceof Error ? textErr.message : 'Unknown text error',
          });
        }
        continue;
      }

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
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal Server Error',
      },
      { status: 500 }
    );
  }
}
