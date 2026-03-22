# Native Host Setup (Windows)

This native host enables per-tab cookie isolation for Session Tabs. It is required for multi-login.

## Requirements
- Node.js 18+ installed and available on PATH (`node -v`).

## Install
1. Load the extension in Chrome and copy its Extension ID from `chrome://extensions`.
2. Open PowerShell in this folder.
3. Run:
   ```
   .\register-host.ps1 -ExtensionId <YOUR_EXTENSION_ID>
   ```

This writes the manifest to:
`%LOCALAPPDATA%\BrowserEnhance\NativeMessagingHosts\com.incredable.browserenhance.sessions.json`
and registers it in the current user registry.

## Uninstall
```
.\unregister-host.ps1
```

## Notes
- The host stores session cookies at `native-host\data\sessions.json`.
- Keep the extension installed; the host only runs when the extension connects.
