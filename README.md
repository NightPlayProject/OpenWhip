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
npm install -g ./nightplayproject-openwhip-1.5.3.tgz
```

## Controls

Focus the text field or terminal you want to send to, then:

- **Ctrl+Alt+W** or click the tray icon: pick up or drop the whip.
- Make a short, brisk mouse flick to crack the whip and send the macro. Pause before your next crack.
- **Escape** or click while holding the whip: drop it.
- Right-click the tray and choose **Custom message…** to enter and save your own text. Cancel leaves the current message unchanged. Choose **Use random messages** to return to the defaults.
- Right-click the tray for Quit.

## Custom whip sound

Right-click the tray → **Whip sound** → **Choose custom sound…** and select an MP3, WAV, OGG, Opus, FLAC, M4A or AAC file. Files must be playable and no larger than 20 MB. The app checks that it can decode the sound before saving it.

Use **Preview sound** to listen without sending a message, or **Use default sounds** to restore the original random whip effects. The selected audio is copied into your settings folder and stays available if you move the original file or the app updates. Unsupported audio leaves your current selection unchanged.

## Automatic updates

Automatic updates are enabled by default for npm installations, starting with version 1.5.2. Users on an older version need to run the install command once to get the working updater.

The app checks your fork's `main` branch shortly after launch, at most every six hours. It downloads a newer version to a separate folder while the current copy keeps running. It restarts when the whip is put away, the message editor and sound picker are closed, and no message is being sent. Messages, sound files, and preferences stay in the user profile. If the new copy fails to start, the updater restores and launches the previous copy.

Right-click the tray → **Updates** to turn automatic updates off, check immediately, or install a prepared update manually. You can also request a check from the terminal:

```sh
openwhip --check-updates
openwhip --status
```

Downloads use a pinned GitHub commit. Every release must increase the stable version in `package.json`; pushes with the same or a lower version do not replace the running app. Development checkouts do not update themselves.

The global npm command acts as a launcher for the newest installed copy. `openwhip --version` reports the version it launches; `npm list -g` may continue to show the original bootstrap version. Updates live in the user profile and do not require writing to the global npm directory. Node.js, npm, and Git must remain available for downloads.

Messages are sent only by cracking the whip. The overlay follows the pointer's monitor and lets clicks pass through to the apps underneath. It does not take keyboard focus. Cursor tracking and animation stop when the whip is hidden; clicking also drops it on Windows. Each crack captures the active app. Windows waits for modifiers to be released, sends Ctrl+C, waits 500 ms, types the message, waits another 150 ms, and presses an unmodified Enter. Input is checked before every character and before Enter. Changing foreground windows or dropping the whip cancels the remaining sequence. Rapid cracks are dropped while a macro is running; they are never queued for later delivery.

The grip follows the pointer immediately while the flexible tail carries momentum. The rope uses fixed time steps, so its behavior stays consistent across display refresh rates. Crack detection uses the mouse stroke's speed and travel, ignores idle motion and small jitter, and emits one crack per stroke. Crossing monitors preserves the rope instead of respawning it.

Use a custom message or longer delays for an app that takes more time to respond to Ctrl+C:

```sh
openwhip --quit
openwhip --message "Keep working until complete" --interrupt-delay 1000 --enter-delay 250
```

Tray messages save between launches. The command-line `--message` option overrides the saved text for that instance; editing through the tray updates both the running message and the saved setting. Timing options apply to the running instance. Messages must be a single line of up to 500 characters.

```sh
openwhip --status
openwhip --quit
openwhip --help
```

## Platforms and troubleshooting

Windows uses `SendInput` with Unicode text, preserves the keyboard layout, and checks the foreground window. Tray activation restores the last actual app instead of sending Alt+Tab. If another program owns a global shortcut, its registration is shown as `false` in `openwhip --status`; tray controls still work.

Windows can inject input only into apps at the same or a lower privilege level. For an app running as Administrator, start OpenWhip from an Administrator terminal too. Keep an editable field focused: Ctrl+C and Enter retain the meaning assigned by the target app. [Windows input restrictions](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput).

The inherited macOS and Linux support is retained, with active-app checks added. macOS requires Accessibility permission; Linux requires X11 and `xdotool`. Those platforms have not been tested in this fork. Use the global overlay shortcut to preserve focus when opening the whip there.

Logs, runtime status, `settings.json`, custom `sounds`, and staged `updates` are stored in `%APPDATA%/openwhip-nightplay` on Windows. The log records failures and startup information, without logging the message text.

## Development and validation

```sh
npm ci
npm test
npm run test:ui
npm run test:motion
npm run test:windows
npm start
```

The UI test opens the tray message editor, checks save, cancel, invalid input, restoring random messages, and persistence after relaunch in an isolated test profile. It also renders a screenshot for inspection.

The motion tests replay strokes at multiple rendering and cursor sampling rates. The renderer test captures the real rope at rest, during a flick, and as it settles for visual inspection.

The Windows smoke test opens two temporary native text windows, sends actual Windows input to the focused test receiver, verifies exact text and a single Enter, and changes focus to verify cancellation. It confirms the removed shortcut sends nothing, clicks pass through the visible overlay, idle and slow mouse motion send nothing, and a natural 140-pixel flick submits the message once. A return flick after a pause verifies rearming. It closes the receivers and tray app when finished. Quit OpenWhip before running it. To check the globally installed build, run `node scripts/smoke-windows.js --installed`.

Validation artifacts are written under `out/validation`. See [VALIDATION.md](VALIDATION.md) for the checked scope.

## Attribution

The original whip design, icons, and sounds come from [GitFrog1111/OpenWhip](https://github.com/GitFrog1111/OpenWhip). This fork replaces the motion and crack detection and changes input handling, focus behavior, global controls, launch diagnostics, and dependency versions. The upstream package declares the MIT license.
