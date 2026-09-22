export abstract class AppError extends Error {
  public abstract readonly code: string;
  public abstract readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly details?: Record<string, unknown>;

  constructor(message: string, isOperational = true, details?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
    this.isOperational = isOperational;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export abstract class DomainError extends AppError {
  public override readonly statusCode: number = 422;
}

export class ScheduleConflictError extends DomainError {
  public readonly code = 'SCHEDULE_CONFLICT';
}

export class TransitBufferViolationError extends DomainError {
  public readonly code = 'TRANSIT_BUFFER_VIOLATION';
}

export class ImmutableBookingError extends DomainError {
  public readonly code = 'IMMUTABLE_BOOKING_MODIFICATION';
}

export class SupplierNotFoundError extends DomainError {
  public readonly code = 'SUPPLIER_NOT_FOUND';
  public override readonly statusCode: number = 404;
}

export class OperationalWindowViolationError extends DomainError {
  public readonly code = 'OPERATIONAL_WINDOW_VIOLATION';
}

export abstract class SecurityError extends AppError {
  public override readonly statusCode: number = 403;
}

export class InvalidWebhookSignatureError extends SecurityError {
  public readonly code = 'INVALID_WEBHOOK_SIGNATURE';
  public override readonly statusCode: number = 401;
}

export class TenantAuthorizationError extends SecurityError {
  public readonly code = 'TENANT_AUTHORIZATION_FAILED';
  public override readonly statusCode: number = 401;
}

export class UnauthorizedSupplierActionError extends SecurityError {
  public readonly code = 'UNAUTHORIZED_SUPPLIER_ACTION';
  public override readonly statusCode: number = 403;
}

export class SSRFBlockedHostError extends SecurityError {
  public readonly code = 'SSRF_BLOCKED_HOST';
  public override readonly statusCode: number = 400;
}

export abstract class InfrastructureError extends AppError {
  public override readonly statusCode: number = 502;
}

export class LLMProviderError extends InfrastructureError {
  public readonly code = 'LLM_PROVIDER_ERROR';
}

export class IdempotencyLockConflictError extends InfrastructureError {
  public readonly code = 'IDEMPOTENCY_LOCK_CONFLICT';
  public override readonly statusCode: number = 409;
}

export class DatabaseTransactionError extends InfrastructureError {
  public readonly code = 'DATABASE_TRANSACTION_ERROR';
  public override readonly statusCode: number = 500;
}

export class MessagingGatewayError extends InfrastructureError {
  public readonly code = 'MESSAGING_GATEWAY_ERROR';
}

export function formatErrorResponse(error: unknown): {
  statusCode: number;
  payload: {
    error: string;
    code: string;
    details?: Record<string, unknown>;
  };
} {
  if (error instanceof AppError) {
    return {
      statusCode: error.statusCode,
      payload: {
        error: error.message,
        code: error.code,
        details: error.details,
      },
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    statusCode: 500,
    payload: {
      error: message,
      code: 'INTERNAL_SERVER_ERROR',
    },
  };
}
