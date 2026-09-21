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

export interface ParsedButtonAction {
  type: 'accept_booking' | 'reject_booking';
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
  textBody?: string;
  action?: ParsedButtonAction;
  audio?: ParsedAudioMessage;
  rawType: string;
}

export type IntentCategory = 'Acceptance' | 'Rejection' | 'Delay' | 'Emergency' | 'General';

export interface CandidateGroupEvent {
  eventId: string;
  title: string;
  eventDate: string;
  startTime: string;
  endTime: string;
  timePeriod?: string;
  timeContext?: 'running_now' | 'upcoming_today' | 'past_today' | 'future_date' | 'past_date';
  timeContextDescription?: string;
  status: string;
  nationality?: string;
  groupSize?: number;
  dietaryRestrictions?: string[];
  mobilityNotes?: string;
  description?: string;
}

export interface IntentClassificationResult {
  category: IntentCategory;
  confidence: number;
  reason: string;
  suggestedAction: string;
  isEscalationRequired: boolean;
  matchedEventId?: string | null;
  matchedGroupSummary?: string;
  isAmbiguous?: boolean;
  clarificationMessage?: string;
}

export interface WebhookProcessingResult {
  success: boolean;
  messageId?: string;
  actionTaken:
    | 'booking_confirmed'
    | 'booking_rejected'
    | 'event_escalated'
    | 'schedule_cascade_orchestrated'
    | 'clarification_requested'
    | 'voice_general_logged'
    | 'unhandled_action'
    | 'no_action_needed';
  details?: Record<string, unknown>;
  error?: string;
}

export interface ScheduleAdjustment {
  eventId: string;
  eventTitle: string;
  previousStartTime: string;
  previousEndTime: string;
  newStartTime: string;
  newEndTime: string;
  newStatus?: 'planned' | 'confirmed' | 'escalated' | 'cancelled';
  reason: string;
}

export interface DownstreamVendorNotice {
  eventId: string;
  providerName: string;
  providerPhone?: string;
  newStartTime: string;
  whatsappMessage: string;
}

export interface TravelerLocalizedNotification {
  language: string;
  flag: string;
  title: string;
  message: string;
  translatedSummaryInArabic: string;
}

export interface OrchestrationDecision {
  delayMinutes: number;
  incidentType: 'delay' | 'emergency' | 'reschedule' | 'cancellation' | 'general';
  isCascadeImpact: boolean;
  incidentSummary: string;
  scheduleAdjustments: ScheduleAdjustment[];
  downstreamNotices: DownstreamVendorNotice[];
  travelerNotification?: TravelerLocalizedNotification;
}

export interface OutboxNoticeRecord {
  id: string;
  eventId: string;
  providerName?: string;
  providerPhone: string;
  message: string;
  status: 'pending' | 'dispatched' | 'failed';
  dispatchedAt?: string;
  error?: string;
}

export interface OrchestrationExecutionResult {
  success: boolean;
  decision?: OrchestrationDecision;
  updatedEventsCount: number;
  dispatchedNoticesCount: number;
  incidentSummary?: string;
  travelerNotification?: TravelerLocalizedNotification;
  error?: string;
  validationViolations?: string[];
  outboxNotices?: OutboxNoticeRecord[];
  rollbackOccurred?: boolean;
}

export interface ProviderNotificationDetails {
  id?: string;
  title: string;
  date: string;
  time?: string;
  endTime?: string;
  providerName?: string;
  groupNationality?: string;
  groupSize?: number;
  dietaryRestrictions?: string[];
  mobilityNotes?: string;
  notes?: string;
}

export interface OutboundNotificationResult {
  success: boolean;
  messageId?: string;
  recipientPhone?: string;
  error?: string;
  mode?: 'interactive' | 'text' | 'template';
}
