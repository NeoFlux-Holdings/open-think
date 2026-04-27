import type { AgentPlugin } from "../core/plugin";
import { AdminPlugin } from "./admin";
import { AnthropicPlugin } from "./anthropic";
import { ArtifactsPlugin } from "./artifacts";
import { BrowserPlugin } from "./browser";
import { CalendarPlugin } from "./calendar";
import { CfAiGatewayPlugin } from "./cfAiGateway";
import { CloudflareApiMcpPlugin } from "./cloudflareApiMcp";
import { CodexPlugin } from "./codex";
import { EmailPlugin } from "./email";
import { McpClientPlugin } from "./mcpClient";
import { MemoryPlugin } from "./memory";
import { MppPlugin } from "./mpp";
import { NotifierPlugin } from "./notifier";
import { OpenAICompatiblePlugin } from "./openaiCompatible";
import { SandboxPlugin } from "./sandbox";
import { WorkersAiPlugin } from "./workersAi";

export function getPlugins(): AgentPlugin[] {
  return [
    new AdminPlugin(),
    new CloudflareApiMcpPlugin(),
    new CfAiGatewayPlugin(),
    new WorkersAiPlugin(),
    new AnthropicPlugin(),
    new OpenAICompatiblePlugin(),
    new CodexPlugin(),
    new McpClientPlugin(),
    new BrowserPlugin(),
    new SandboxPlugin(),
    new ArtifactsPlugin(),
    new MppPlugin(),
    /* --- PA stack --- */
    new MemoryPlugin(),
    new EmailPlugin(),
    new NotifierPlugin(),
    new CalendarPlugin()
  ];
}
