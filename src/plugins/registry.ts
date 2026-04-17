import type { AgentPlugin } from "../core/plugin";
import { ArtifactsPlugin } from "./artifacts";
import { CloudflareApiMcpPlugin } from "./cloudflareApiMcp";
import { MppPlugin } from "./mpp";

export function getPlugins(): AgentPlugin[] {
  return [new CloudflareApiMcpPlugin(), new MppPlugin(), new ArtifactsPlugin()];
}
