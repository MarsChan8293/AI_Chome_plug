# AI Multi-Chat Aggregator Copilot Instructions

## Project Overview
This is a Chrome extension that aggregates multiple AI chat interfaces (Doubao, DeepSeek, Kimi, etc.) into a single dashboard using iframes. It synchronizes a unified input field to all embedded AI chats.

## Architecture & Data Flow
- **Dashboard (`dashboard.html`, `dashboard.js`)**: The main UI. It manages the grid of iframes and sends messages to them using `chrome.tabs.sendMessage`.
- **Content Script (`content.js`)**: Injected into every AI iframe. It listens for `SEND_AI_MESSAGE`, finds the local input field, fills it, and triggers the send button.
- **Network Rules (`rules.json`)**: Uses `declarativeNetRequest` to strip `X-Frame-Options` and `Content-Security-Policy` headers, allowing AI sites to be embedded in iframes.
- **Manifest (`manifest.json`)**: Defines permissions, host access, and content script injection rules.

## Key Patterns & Conventions

### DOM Automation in `content.js`
When adding support for a new AI or fixing an existing one:
- **Input Selection**: Use `inputSelectors` array in `content.js`. Prefer specific IDs or placeholders.
- **React/Vue State Triggering**: Use the `nativeInputValueSetter` hack for `TEXTAREA` to ensure the site's framework detects the change.
- **ContentEditable**: For sites like Kimi, use `document.execCommand('insertText', ...)` or fallback to `innerText`.
- **Event Dispatching**: Always dispatch `input`, `change`, `blur`, and `compositionend` events after filling text.

### Bypassing Iframe Restrictions
- **Header Removal**: Update `rules.json` if a new site has strict framing policies.
- **Window Top Spoofing**: `content.js` redefines `window.top` to `window.self` to bypass frame-detection scripts.

### Adding a New AI
1. Update `manifest.json`: Add the domain to `host_permissions` and `content_scripts.matches`.
2. Update `dashboard.html`: Add a new `<label>` with `class="ai-toggle"` and appropriate `data-id` and `data-url`.
3. Update `content.js`: Add specific selectors to `inputSelectors` or `buttonSelectors` if the defaults don't work.

## Developer Workflow
- **Loading**: Load the `chrome` directory as an "Unpacked Extension" in `chrome://extensions/`.
- **Debugging**: 
    - Right-click the dashboard and "Inspect" for dashboard logic.
    - Use the "Inspect" tool on individual iframes to debug `content.js` behavior within that specific AI's context.
- **Storage**: Preferences are stored in `chrome.storage.local` under the key `selectedAIs`.

## Important Files
- [manifest.json](manifest.json): Extension configuration and permissions.
- [content.js](content.js): Core automation logic for AI interfaces.
- [dashboard.js](dashboard.js): Dashboard UI management and message broadcasting.
- [rules.json](rules.json): Declarative rules for bypassing iframe restrictions.
