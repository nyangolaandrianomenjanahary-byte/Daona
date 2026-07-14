# Daona

Application de jeux online

## MCP Configuration

This repository includes `.mcp.json` for GitHub Copilot's Model Context Protocol (MCP) integration.

```json
{
  "servers": {
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/"
    }
  }
}
```

This enables GitHub tools (issues, PRs, repositories, etc.) inside Copilot Chat / Agent mode in supported editors (VS Code, etc.).

**Note:** You will be prompted to authenticate with GitHub the first time you use MCP tools.
