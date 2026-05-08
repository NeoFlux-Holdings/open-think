/**
 * HTTP handlers for the chat-sessions + chat-projects index.
 *
 * Mounted under `/api/chat-sessions/*` and `/api/chat-projects/*` from
 * the main router. Every handler:
 *   - Requires `auth.email` (inherits the Access JWT gate from index.ts)
 *   - Scopes all reads/writes by `userEmail` so two tenants on the same
 *     deployment can't see each other's chats
 *   - Returns the same `{ ok, data?, error? }` envelope the rest of the
 *     API uses
 *
 * Schema lives in chatSessions.ts. This module is pure routing +
 * input validation + error mapping.
 */

import { ChatSessionStore, newId } from "./chatSessions";
import type { Env } from "./types";

interface AuthCtx {
  email: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function badRequest(message: string): Response {
  return json({ ok: false, error: message }, 400);
}

function notFound(): Response {
  return json({ ok: false, error: "not found" }, 404);
}

function noDb(): Response {
  return json(
    {
      ok: false,
      error:
        "DB binding missing — chat sessions index requires the [d1_databases] WORKSPACE binding. Run helm-setup-deploy or paste the [[d1_databases]] block into wrangler.toml."
    },
    503
  );
}

/**
 * Entry point — returns null when the request doesn't match any
 * chat-sessions/projects route, so the caller can keep dispatching.
 */
export async function handleChatSessionsApi(
  request: Request,
  url: URL,
  env: Env,
  auth: AuthCtx
): Promise<Response | null> {
  const path = url.pathname;
  if (!path.startsWith("/api/chat-sessions") && !path.startsWith("/api/chat-projects")) {
    return null;
  }
  if (!env.DB) return noDb();

  const store = new ChatSessionStore(env.DB);
  const method = request.method.toUpperCase();

  // ─── Sessions ──────────────────────────────────────────────────────

  // GET /api/chat-sessions             → list
  // POST /api/chat-sessions            → create (auto-id) — body: { title?, projectId? }
  // GET /api/chat-sessions/:id         → fetch one
  // PATCH /api/chat-sessions/:id       → update title/projectId/archived
  // DELETE /api/chat-sessions/:id      → hard delete (row only — DO history untouched)

  if (path === "/api/chat-sessions" || path === "/api/chat-sessions/") {
    if (method === "GET") {
      const includeArchived = url.searchParams.get("archived") === "1";
      const limit = Number(url.searchParams.get("limit") ?? "200") || 200;
      const sessions = await store.listSessions(auth.email, { includeArchived, limit });
      return json({ ok: true, data: { sessions } });
    }
    if (method === "POST") {
      const body = (await safeJson(request)) as
        | { id?: string; title?: string | null; projectId?: string | null }
        | null;
      const id = body?.id?.trim() || newId("s");
      const session = await store.createSession({
        id,
        userEmail: auth.email,
        title: body?.title ?? null,
        projectId: body?.projectId ?? null
      });
      return json({ ok: true, data: { session } });
    }
    return badRequest(`unsupported method ${method}`);
  }

  // POST /api/chat-sessions/:id/touch — recency bump + auto-title.
  // Called by the SPA's chat loop after each `loop-done` so the left
  // rail's "Today" bucket always reflects the latest activity. The
  // body can include `firstUserMessage` to seed a title when the
  // session doesn't have one yet — currently first-60-chars; LLM
  // titling is a follow-up.
  const touchMatch = /^\/api\/chat-sessions\/([^/]+)\/touch$/.exec(path);
  if (touchMatch) {
    if (method !== "POST") return badRequest(`unsupported method ${method}`);
    const id = decodeURIComponent(touchMatch[1]);
    const body = (await safeJson(request)) as
      | { firstUserMessage?: string }
      | null;
    // Idempotent ensure — first message in a brand-new session also
    // creates the row, so the SPA doesn't have to call POST first.
    const existing = await store.ensureSession({ id, userEmail: auth.email });
    await store.touchSession(id, auth.email);
    // Auto-title: only when missing. Slice the first user message to
    // a reasonable length, strip newlines, and trim to a word boundary.
    let title: string | null = existing.title;
    if (!title && body?.firstUserMessage) {
      title = autoTitleFromMessage(body.firstUserMessage);
      if (title) {
        await store.updateSession(id, auth.email, { title });
      }
    }
    const session = await store.getSession(id, auth.email);
    return json({ ok: true, data: { session } });
  }

  const sessionMatch = /^\/api\/chat-sessions\/([^/]+)$/.exec(path);
  if (sessionMatch) {
    const id = decodeURIComponent(sessionMatch[1]);
    if (method === "GET") {
      const session = await store.getSession(id, auth.email);
      if (!session) return notFound();
      return json({ ok: true, data: { session } });
    }
    if (method === "PATCH") {
      const body = (await safeJson(request)) as
        | { title?: string | null; projectId?: string | null; archived?: boolean }
        | null;
      if (!body) return badRequest("body required");
      // Validate projectId belongs to the user (prevents fishing for
      // someone else's project ids — defense-in-depth, the join would
      // already filter).
      if (body.projectId) {
        const proj = await store.getProject(body.projectId, auth.email);
        if (!proj) return badRequest(`project '${body.projectId}' not found`);
      }
      const session = await store.updateSession(id, auth.email, {
        title: body.title,
        projectId: body.projectId,
        archived: body.archived
      });
      if (!session) return notFound();
      return json({ ok: true, data: { session } });
    }
    if (method === "DELETE") {
      const ok = await store.deleteSession(id, auth.email);
      return json({ ok, data: { deleted: ok } });
    }
    return badRequest(`unsupported method ${method}`);
  }

  // ─── Projects ──────────────────────────────────────────────────────

  // GET /api/chat-projects             → list with sessionCount per project
  // POST /api/chat-projects            → create — body: { name }
  // PATCH /api/chat-projects/:id       → rename / archive
  // DELETE /api/chat-projects/:id      → delete project, set sessions.project_id=NULL

  if (path === "/api/chat-projects" || path === "/api/chat-projects/") {
    if (method === "GET") {
      const includeArchived = url.searchParams.get("archived") === "1";
      const projects = await store.listProjects(auth.email, { includeArchived });
      return json({ ok: true, data: { projects } });
    }
    if (method === "POST") {
      const body = (await safeJson(request)) as { name?: string } | null;
      const name = body?.name?.trim();
      if (!name) return badRequest("body.name required");
      if (name.length > 80) return badRequest("name too long (max 80 chars)");
      const project = await store.createProject({
        id: newId("p"),
        userEmail: auth.email,
        name
      });
      return json({ ok: true, data: { project } });
    }
    return badRequest(`unsupported method ${method}`);
  }

  const projectMatch = /^\/api\/chat-projects\/([^/]+)$/.exec(path);
  if (projectMatch) {
    const id = decodeURIComponent(projectMatch[1]);
    if (method === "GET") {
      const project = await store.getProject(id, auth.email);
      if (!project) return notFound();
      return json({ ok: true, data: { project } });
    }
    if (method === "PATCH") {
      const body = (await safeJson(request)) as { name?: string; archived?: boolean } | null;
      if (!body) return badRequest("body required");
      if (body.name !== undefined && (body.name.length === 0 || body.name.length > 80)) {
        return badRequest("name must be 1–80 chars");
      }
      const project = await store.updateProject(id, auth.email, body);
      if (!project) return notFound();
      return json({ ok: true, data: { project } });
    }
    if (method === "DELETE") {
      const ok = await store.deleteProject(id, auth.email);
      return json({ ok, data: { deleted: ok } });
    }
    return badRequest(`unsupported method ${method}`);
  }

  return null;
}

async function safeJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/**
 * Generate a left-rail title from the user's first message. Trims to
 * ~60 chars at a word boundary, strips newlines + leading punctuation,
 * and falls back to "Untitled chat" for empty input.
 *
 * Future: replace this with an async LLM call (~150 tokens) that runs
 * after the first turn, generating a "4-6 word summary" title. Worth
 * upgrading once we see real chat patterns; this naive fallback keeps
 * the left rail readable for v0.14.0.
 */
function autoTitleFromMessage(content: string): string {
  const cleaned = content.replace(/\s+/g, " ").trim();
  if (!cleaned) return "Untitled chat";
  if (cleaned.length <= 60) return cleaned;
  const truncated = cleaned.slice(0, 60);
  const lastSpace = truncated.lastIndexOf(" ");
  return (lastSpace > 30 ? truncated.slice(0, lastSpace) : truncated) + "…";
}
