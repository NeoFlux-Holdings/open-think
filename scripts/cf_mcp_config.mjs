#!/usr/bin/env node

const token = process.env.CLOUDFLARE_API_TOKEN ?? process.env.CLOUDFLARE_AGENT_TOKEN;

const config = {
  mcpServers: {
    "cloudflare-api": {
      url: "https://mcp.cloudflare.com/mcp"
    }
  }
};

if (token) {
  config.mcpServers["cloudflare-api"].headers = {
    Authorization: `Bearer ${token}`
  };
}

console.log("Paste this into your MCP client config:");
console.log(JSON.stringify(config, null, 2));

if (!token) {
  console.log("\nNo token detected in env. OAuth login will happen in your MCP client.");
  console.log("If you prefer token auth, export CLOUDFLARE_API_TOKEN (or CLOUDFLARE_AGENT_TOKEN) and run again.");
}
