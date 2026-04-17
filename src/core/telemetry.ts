export type AuditEventType =
  | "plugin.invoke"
  | "skill.invoke"
  | "request.error"
  | "request.info";

export interface AuditEvent {
  type: AuditEventType;
  requestId: string;
  method: string;
  path: string;
  ok: boolean;
  durationMs: number;
  pluginId?: string;
  skillId?: string;
  action?: string;
  code?: string;
}

export function emitAuditEvent(event: AuditEvent): void {
  const payload = {
    ts: new Date().toISOString(),
    ...event
  };

  console.log(JSON.stringify(payload));
}
