/**
 * Unit-test stub for `@cloudflare/sandbox`. The real package depends on
 * `@cloudflare/containers` whose 0.3.x ESM exports use extension-less
 * relative paths that fail Node ESM resolution outside the Workers
 * runtime. Vitest tries to import it during module evaluation of any
 * file that pulls in src/index.ts, so we redirect to this stub.
 *
 * Tests don't need the real Sandbox — none of them exercise /shell/ws
 * or `session.terminal()`. We just need names + minimal shapes so the
 * `import { getSandbox } from "@cloudflare/sandbox"` and
 * `export { Sandbox } from "@cloudflare/sandbox"` calls in src/ resolve
 * cleanly.
 */

export class Sandbox {
  // Vitest never instantiates this; the real class is what wrangler ships
  // to the Worker runtime.
}

interface FakeExecResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  duration: number;
}

interface FakeSession {
  exec(cmd: string, options?: { cwd?: string; timeout?: number }): Promise<FakeExecResult>;
  terminal(request: Request): Promise<Response>;
}

interface FakeSandbox {
  getSession(id: string): Promise<FakeSession>;
}

/**
 * Return a fake sandbox whose methods throw synchronously when called.
 * Tests that exercise sandbox-backed code paths should mock `execInSandbox`
 * (in src/sandbox.ts) directly. This stub exists so non-shell tests can
 * import the module without crashing at evaluation time.
 */
export function getSandbox(_namespace: unknown, _id: string): FakeSandbox {
  return {
    async getSession(_sessionId: string): Promise<FakeSession> {
      return {
        async exec(_cmd: string): Promise<FakeExecResult> {
          throw new Error("@cloudflare/sandbox stub: exec() not implemented in tests");
        },
        async terminal(_request: Request): Promise<Response> {
          throw new Error("@cloudflare/sandbox stub: terminal() not implemented in tests");
        }
      };
    }
  };
}
