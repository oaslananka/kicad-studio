# AI Providers

## Supported Providers

KiCad Studio supports four AI provider paths:

- Claude
- OpenAI
- GitHub Copilot
- Gemini

## Claude

- Set `kicadstudio.ai.provider` to `claude`.
- Store the API key with `KiCad: Set AI API Key`.
- Default model: `claude-sonnet-4-6`.

## OpenAI

- Set `kicadstudio.ai.provider` to `openai`.
- Store the API key with `KiCad: Set AI API Key`.
- Default model: `gpt-5.4`.
- API mode can be `responses` or `chat-completions`.

## GitHub Copilot

- Set `kicadstudio.ai.provider` to `copilot`.
- Requires a VS Code environment where the Language Model API exposes Copilot models.
- No separate API key is stored by KiCad Studio.

## Gemini

- Set `kicadstudio.ai.provider` to `gemini`.
- Requires Gemini availability through the VS Code Language Model API in the user environment.
- No separate API key is stored by KiCad Studio.

## Response Language

Use `kicadstudio.ai.language` to control the response language independently from the VS Code UI locale.

## Security Model

- KiCad Studio stores external API keys in VS Code SecretStorage.
- Webviews do not call AI providers directly.
- Network calls stay in the extension host.

## MCP-Assisted Suggestions

When MCP is connected, assistant replies may include executable `mcp` tool suggestions that the user can preview and apply from the chat UI.
