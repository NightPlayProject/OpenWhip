# OpenWhip — NightPlay fork

![Whip divider](assets/divider.png)

A desktop whip that sends **Ctrl+C → a message → Enter** to the app with keyboard focus. Forked from [GitFrog1111/OpenWhip](https://github.com/GitFrog1111/OpenWhip).

## Install and run globally

Requires Node.js 22.12 or newer.

```sh
npm uninstall -g openwhip
npm install -g github:NightPlayProject/OpenWhip
openwhip
```

The fork installs as `@nightplayproject/openwhip`; its command is still `openwhip`. You can run it from any directory. It stays in the tray when the launching terminal closes. Launching it again keeps the existing instance.

To install your local checkout instead:

```sh
npm ci
npm pack
npm install -g ./nightplayproject-openwhip-1.2.0.tgz
```

## Controls

Focus the text field or terminal you want to send to, then:

- **Ctrl+Alt+W** or click the tray icon: pick up or drop the whip.
- Move the mouse sharply to crack the whip and send the macro.
- **Ctrl+Alt+Enter**: send the macro directly, even while the whip is hidden.
- **Escape** or click while holding the whip: drop it.
- Right-click the tray for controls and Quit.

The overlay covers all connected displays without taking keyboard focus. Each trigger captures the active app. Windows waits for shortcut modifiers to be released, sends Ctrl+C, waits 500 ms, types the message, waits another 150 ms, and presses an unmodified Enter. Input is checked before every character and before Enter. Changing foreground windows cancels the remaining sequence. Rapid cracks are dropped while a macro is running; they are never queued for later delivery.

Use a custom message or longer delays for an app that takes more time to respond to Ctrl+C:

```sh
openwhip --quit
openwhip --message "Keep working until complete" --interrupt-delay 1000 --enter-delay 250
```

Options apply to that running instance. Messages must be a single line of up to 500 characters.

```sh
openwhip --status
openwhip --quit
openwhip --help
```

## Platforms and troubleshooting

Windows uses `SendInput` with Unicode text, preserves the keyboard layout, and checks the foreground window. Tray activation restores the last actual app instead of sending Alt+Tab. If another program owns a global shortcut, its registration is shown as `false` in `openwhip --status`; tray controls still work.

Windows can inject input only into apps at the same or a lower privilege level. For an app running as Administrator, start OpenWhip from an Administrator terminal too. Keep an editable field focused: Ctrl+C and Enter retain the meaning assigned by the target app. [Windows input restrictions](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput).

The inherited macOS and Linux support is retained, with active-app checks added. macOS requires Accessibility permission; Linux requires X11 and `xdotool`. Those platforms have not been tested in this fork. Use the global overlay shortcut to preserve focus when opening the whip there.

Logs and runtime status are stored in `%APPDATA%/openwhip-nightplay` on Windows. The log records failures and startup information, without logging the message text.

## Development and validation

```sh
npm ci
npm test
npm run test:windows
npm start
```

The Windows smoke test opens two temporary native text windows, sends actual Windows input to the focused test receiver, verifies exact text and a single Enter, changes focus to verify cancellation, and exercises the real Electron global shortcuts and overlay. It closes the receivers and tray app when finished. Quit OpenWhip before running it. To check the globally installed build, run `node scripts/smoke-windows.js --installed`.

Validation artifacts are written under `out/validation`. See [VALIDATION.md](VALIDATION.md) for the checked scope.

## Attribution

The original whip visuals, physics, icons, and sounds come from [GitFrog1111/OpenWhip](https://github.com/GitFrog1111/OpenWhip). This fork changes input handling, focus behavior, global controls, launch diagnostics, and dependency versions. The upstream package declares the MIT license.
