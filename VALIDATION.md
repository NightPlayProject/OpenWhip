# Validation

Checked on Windows on October 8, 2026, using Node.js 24.15.0, Electron 44.7.0, and Koffi 3.3.2.

Version 1.4.0: `npm test` passes twenty checks covering the macro sequence and delays, cancellation on focus changes and dropping the whip, shortcut release, overlapping triggers, failed input, missing targets, CLI validation, and message persistence without overwriting unrelated settings. Motion checks replay natural strokes at 30, 60, 144, and 240 Hz, with 4–25 ms cursor sample intervals. They verify direction-independent cracks, immediate grip position, bounded rope length, no cracks from idle/slow/jitter motion, quiet rearming, monitor-coordinate rebasing, and recovery from delayed frames or pointer jumps. `npm audit --omit=dev` reports zero vulnerabilities for this dependency lockfile.

The old version's detector required 340 pixels of tip travel per frame. A 140-pixel mouse stroke over 90 ms failed to crack in replays at all four refresh rates. The replacement recognizes that same stroke exactly once at each rate, using timestamped mouse samples and fixed 120 Hz rope simulation.

`npm run test:motion` exercises the actual renderer without sending keyboard input. It verifies exact grip position, tail inertia, one crack per natural flick, and no settling cracks. Its contact sheet was inspected; the rope now keeps its length, bends through the stroke, and settles without the previous small knots.

`npm run test:ui` passes using the real tray menu callback and message editor in an isolated profile. Saving preserves exact Unicode text, cancelling preserves the old message, invalid input is rejected, returning to random messages works, and restarting restores the saved custom message. The editor screenshot was inspected for layout and legibility.

`npm run test:windows` passes using actual Windows keyboard input and two external native text windows:

- Ctrl+C, exact message text, and exactly one unmodified Enter arrive in the foreground receiver.
- The other receiver remains untouched.
- Unicode text, including an accented character and an emoji, arrives exactly.
- Switching foreground windows during the interruption delay cancels all subsequent text and Enter.
- The overlay-toggle shortcut registers; Ctrl+Alt+Enter is absent and sends no macro.
- The real transparent overlay loads and leaves the external receiver focused.
- The underlying app continues processing its UI timer and receives an actual mouse click through the visible overlay; that click also drops the whip.
- Idle and slow OS cursor movement generate no macro. A continuous 140-pixel / 90 ms mouse flick cracks the real animated whip and submits exactly once through renderer IPC. The tail settling produces no further macro, and a return flick after rest submits once.
- Escape drops the whip; repeated launches keep one instance; `--quit` shuts down cleanly.

The same desktop smoke test supports `--installed` to exercise the globally installed tray app, shortcuts, and whip. Machine-readable source and installation results are saved under `out/validation`, which is excluded from Git and npm packages.

These checks verify Windows input, the actual whip and its click-through overlay, and the tray message editor. The previous overlay intercepted desktop mouse input; the new window ignores mouse events, polls the cursor independently while visible, draws only on the pointer's display, and stops animating when hidden. They do not verify every third-party application, elevated targets, macOS, Linux, or mixed-DPI monitor combinations. The native receiver handles the test messages without executing commands or sending messages to another person.
