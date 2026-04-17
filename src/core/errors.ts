export class AppError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 500) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
  }
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof Error) {
    return new AppError("E_INTERNAL", error.message, 500);
  }

  return new AppError("E_INTERNAL", "Unknown error", 500);
}
