import { SupabaseClient } from '@supabase/supabase-js';
import {
  NotificationGateway,
  NotificationSendResult,
  OutboxNoticePayload,
  OutboxRecord,
} from '../ports/notification.port';
import { sendWhatsAppTextMessage } from '../whatsapp/sender';
import {
  stageOutboxNotices,
  dispatchPendingOutboxNotices,
  fetchPendingOutboxNotices,
} from '../whatsapp/outbox';
import { OutboxNoticeRecord } from '../whatsapp/types';

export class WhatsAppNotificationAdapter implements NotificationGateway {
  constructor(private readonly supabase: SupabaseClient) {}

  async sendTextMessage(toPhone: string, message: string): Promise<NotificationSendResult> {
    const res = await sendWhatsAppTextMessage(toPhone, message);
    return {
      success: res.success,
      messageId: res.messageId,
      error: res.error,
    };
  }

  async stageOutbox(notices: OutboxNoticePayload[], tenantId: string): Promise<OutboxRecord[]> {
    const staged = await stageOutboxNotices(this.supabase, notices, tenantId);
    return staged.map((item) => ({
      id: item.id,
      tenantId: item.tenantId,
      eventId: item.eventId,
      providerName: item.providerName,
      providerPhone: item.providerPhone,
      message: item.message,
      status: item.status,
      attempts: item.attempts,
      createdAt: item.createdAt,
      dispatchedAt: item.dispatchedAt,
      error: item.error,
    }));
  }

  async dispatchOutbox(
    notices: OutboxRecord[]
  ): Promise<{ dispatchedCount: number; updatedNotices: OutboxRecord[] }> {
    const castedNotices: OutboxNoticeRecord[] = notices.map((n) => ({
      id: n.id,
      tenantId: n.tenantId,
      eventId: n.eventId,
      providerName: n.providerName,
      providerPhone: n.providerPhone,
      message: n.message,
      status: n.status,
      attempts: n.attempts,
      createdAt: n.createdAt,
      dispatchedAt: n.dispatchedAt,
      error: n.error,
    }));

    const result = await dispatchPendingOutboxNotices(this.supabase, castedNotices);

    return {
      dispatchedCount: result.dispatchedCount,
      updatedNotices: result.updatedNotices.map((u) => ({
        id: u.id,
        tenantId: u.tenantId,
        eventId: u.eventId,
        providerName: u.providerName,
        providerPhone: u.providerPhone,
        message: u.message,
        status: u.status,
        attempts: u.attempts,
        createdAt: u.createdAt,
        dispatchedAt: u.dispatchedAt,
        error: u.error,
      })),
    };
  }

  async fetchPendingOutbox(tenantId?: string): Promise<OutboxRecord[]> {
    const fetched = await fetchPendingOutboxNotices(this.supabase, tenantId);
    return fetched.map((item) => ({
      id: item.id,
      tenantId: item.tenantId,
      eventId: item.eventId,
      providerName: item.providerName,
      providerPhone: item.providerPhone,
      message: item.message,
      status: item.status,
      attempts: item.attempts,
      createdAt: item.createdAt,
      dispatchedAt: item.dispatchedAt,
      error: item.error,
    }));
  }
}
