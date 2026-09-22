export interface OutboxNoticePayload {
  eventId: string;
  providerName?: string;
  providerPhone: string;
  message: string;
}

export interface OutboxRecord {
  id: string;
  tenantId?: string;
  eventId: string;
  providerName?: string;
  providerPhone: string;
  message: string;
  status: 'pending' | 'dispatched' | 'failed';
  attempts?: number;
  createdAt?: string;
  dispatchedAt?: string;
  error?: string;
}

export interface NotificationSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface NotificationGateway {
  sendTextMessage(toPhone: string, message: string): Promise<NotificationSendResult>;
  stageOutbox(notices: OutboxNoticePayload[], tenantId: string): Promise<OutboxRecord[]>;
  dispatchOutbox(notices: OutboxRecord[]): Promise<{ dispatchedCount: number; updatedNotices: OutboxRecord[] }>;
  fetchPendingOutbox(tenantId?: string): Promise<OutboxRecord[]>;
}
