import type { AgentPlugin } from "../core/plugin";
import { AdminPlugin } from "./admin";
import { AnthropicPlugin } from "./anthropic";
import { HelmArtifactsPlugin } from "./artifacts";
import { BrowserPlugin } from "./browser";
import { CalendarPlugin } from "./calendar";
import { CfAiGatewayPlugin } from "./cfAiGateway";
import { CloudflareAdminPlugin } from "./cloudflareAdmin";
import { CloudflareApiMcpPlugin } from "./cloudflareApiMcp";
import { HelmGithubPlugin } from "./helmGithub";
import { HelmSetupPlugin } from "./helmSetup";
import { HelmTomlPlugin } from "./helmToml";
import { CodexPlugin } from "./codex";
import { EmailPlugin } from "./email";
import { McpClientPlugin } from "./mcpClient";
import { MemoryPlugin } from "./memory";
import { MppPlugin } from "./mpp";
import { NotifierPlugin } from "./notifier";
import { OpenAICompatiblePlugin } from "./openaiCompatible";
import { OpenRouterPlugin } from "./openrouter";
import { SandboxPlugin } from "./sandbox";
import { WorkersAiPlugin } from "./workersAi";

export function getPlugins(): AgentPlugin[] {
  return [
    new AdminPlugin(),
    new HelmSetupPlugin(),
    new HelmTomlPlugin(),
    new HelmGithubPlugin(),
    new CloudflareAdminPlugin(),
    new CloudflareApiMcpPlugin(),
    new CfAiGatewayPlugin(),
    new WorkersAiPlugin(),
    new AnthropicPlugin(),
    new OpenRouterPlugin(),
    new OpenAICompatiblePlugin(),
    new CodexPlugin(),
    new McpClientPlugin(),
    new BrowserPlugin(),
    new SandboxPlugin(),
    new HelmArtifactsPlugin(),
    new MppPlugin(),
    /* --- PA stack --- */
    new MemoryPlugin(),
    new EmailPlugin(),
    new NotifierPlugin(),
    new CalendarPlugin()
  ];
}
