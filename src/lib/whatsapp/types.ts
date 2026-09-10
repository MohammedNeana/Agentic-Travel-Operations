/**
 * Strictly typed definitions for WhatsApp Cloud API Webhook payloads,
 * message structures, media metadata, and voice intent classification.
 */

export interface WhatsAppProfile {
  name: string;
}

export interface WhatsAppContact {
  profile?: WhatsAppProfile;
  wa_id: string;
}

export interface WhatsAppMetadata {
  display_phone_number: string;
  phone_number_id: string;
}

export interface WhatsAppButtonReply {
  id: string;
  title: string;
}

export interface WhatsAppListReply {
  id: string;
  title: string;
  description?: string;
}

export interface WhatsAppInteractiveReply {
  type: 'button_reply' | 'list_reply' | string;
  button_reply?: WhatsAppButtonReply;
  list_reply?: WhatsAppListReply;
}

export interface WhatsAppAudio {
  id: string;
  mime_type: string;
  sha256?: string;
  voice?: boolean;
}

export interface WhatsAppText {
  body: string;
}

export type WhatsAppMessageType =
  | 'text'
  | 'interactive'
  | 'audio'
  | 'image'
  | 'video'
  | 'document'
  | 'location'
  | 'button'
  | string;

export interface WhatsAppIncomingMessage {
  from: string;
  id: string;
  timestamp: string;
  type: WhatsAppMessageType;
  text?: WhatsAppText;
  interactive?: WhatsAppInteractiveReply;
  audio?: WhatsAppAudio;
}

export interface WhatsAppChangeValue {
  messaging_product: 'whatsapp' | string;
  metadata: WhatsAppMetadata;
  contacts?: WhatsAppContact[];
  messages?: WhatsAppIncomingMessage[];
  statuses?: Array<{
    id: string;
    status: 'sent' | 'delivered' | 'read' | 'failed';
    timestamp: string;
    recipient_id: string;
  }>;
}

export interface WhatsAppChange {
  field: string;
  value: WhatsAppChangeValue;
}

export interface WhatsAppEntry {
  id: string;
  changes: WhatsAppChange[];
}

export interface WhatsAppWebhookPayload {
  object: 'whatsapp_business_account' | string;
  entry: WhatsAppEntry[];
}

// ─── Domain Processing Types ─────────────────────────────────

export interface ParsedButtonAction {
  type: 'accept_booking';
  eventId: string;
  rawButtonId: string;
  buttonTitle: string;
}

export interface ParsedAudioMessage {
  type: 'audio';
  mediaId: string;
  mimeType: string;
  isVoiceNote: boolean;
}

export interface ParsedMessageContext {
  messageId: string;
  fromPhoneNumber: string;
  contactName?: string;
  timestamp: string;
  action?: ParsedButtonAction;
  audio?: ParsedAudioMessage;
  rawType: string;
}

export type IntentCategory = 'Delay' | 'Emergency' | 'General';

export interface IntentClassificationResult {
  category: IntentCategory;
  confidence: number;
  reason: string;
  suggestedAction: string;
  isEscalationRequired: boolean;
}

export interface WebhookProcessingResult {
  success: boolean;
  messageId?: string;
  actionTaken:
    | 'booking_confirmed'
    | 'event_escalated'
    | 'voice_general_logged'
    | 'unhandled_action'
    | 'no_action_needed';
  details?: Record<string, unknown>;
  error?: string;
}

// ─── Outbound Notification Types ──────────────────────────────

export interface ProviderNotificationDetails {
  id?: string;
  title: string;
  date: string;
  time?: string;
  providerName?: string;
  groupSize?: number;
  notes?: string;
}

export interface OutboundNotificationResult {
  success: boolean;
  messageId?: string;
  recipientPhone?: string;
  error?: string;
  mode?: 'interactive' | 'text' | 'template';
}

