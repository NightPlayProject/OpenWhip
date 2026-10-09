const { setTimeout: delay } = require('node:timers/promises');

function createWindowsInput() {
  const koffi = require('koffi');
  const user32 = koffi.load('user32.dll');
  const kernel32 = koffi.load('kernel32.dll');
  const mouse = koffi.struct({
    dx: 'int32_t', dy: 'int32_t', mouseData: 'uint32_t', dwFlags: 'uint32_t',
    time: 'uint32_t', dwExtraInfo: 'uintptr_t',
  });
  const keyboard = koffi.struct({
    wVk: 'uint16_t', wScan: 'uint16_t', dwFlags: 'uint32_t',
    time: 'uint32_t', dwExtraInfo: 'uintptr_t',
  });
  const hardware = koffi.struct({ uMsg: 'uint32_t', wParamL: 'uint16_t', wParamH: 'uint16_t' });
  const input = koffi.struct({ type: 'uint32_t', u: koffi.union({ mi: mouse, ki: keyboard, hi: hardware }) });
  const SendInput = user32.func('__stdcall', 'SendInput', 'uint32_t', ['uint32_t', koffi.pointer(input), 'int']);
  const GetForegroundWindow = user32.func('uintptr_t __stdcall GetForegroundWindow()');
  const GetWindowThreadProcessId = user32.func('uint32_t __stdcall GetWindowThreadProcessId(uintptr_t hwnd, _Out_ uint32_t *pid)');
  const GetClassNameW = user32.func('int __stdcall GetClassNameW(uintptr_t hwnd, _Out_ char16_t *name, int count)');
  const IsWindow = user32.func('int __stdcall IsWindow(uintptr_t hwnd)');
  const SetForegroundWindow = user32.func('int __stdcall SetForegroundWindow(uintptr_t hwnd)');
  const GetAsyncKeyState = user32.func('int16_t __stdcall GetAsyncKeyState(int key)');
  const GetLastError = kernel32.func('uint32_t __stdcall GetLastError()');
  const excludedClasses = new Set(['Shell_TrayWnd', 'Shell_SecondaryTrayWnd', 'NotifyIconOverflowWindow', 'TopLevelWindowForOverflowXamlIsland', 'Progman', 'WorkerW', '#32768']);
  const releaseKeys = [0x10, 0x11, 0x12, 0x5b, 0x5c, 0x0d];

  function captureTarget() {
    const handle = GetForegroundWindow();
    if (!handle || !IsWindow(handle)) return null;
    const pid = [0];
    GetWindowThreadProcessId(handle, pid);
    const name = Buffer.alloc(512);
    const length = GetClassNameW(handle, name, 256);
    const className = name.subarray(0, length * 2).toString('utf16le');
    if (!pid[0] || pid[0] === process.pid || excludedClasses.has(className)) return null;
    return { handle, pid: pid[0] };
  }

  function isValid(target) {
    if (!target || !IsWindow(target.handle)) return false;
    const pid = [0];
    GetWindowThreadProcessId(target.handle, pid);
    return pid[0] === target.pid && pid[0] !== process.pid;
  }

  function isActive(target) {
    return isValid(target) && GetForegroundWindow() === target.handle;
  }

  function assertActive(target) {
    if (!isActive(target)) throw new Error('Active app changed; remaining keys cancelled.');
  }

  function event(vk, scan = 0, flags = 0) {
    return { type: 1, u: { ki: { wVk: vk, wScan: scan, dwFlags: flags, time: 0, dwExtraInfo: 0 } } };
  }

  function send(target, events) {
    assertActive(target);
    const sent = SendInput(events.length, events, koffi.sizeof(input));
    if (sent !== events.length) {
      // Release any modifiers this sequence injected, even when delivery was partial.
      const held = new Set();
      for (const item of events.slice(0, sent)) {
        const key = item.u.ki;
        if (key.wVk) {
          if (key.dwFlags & 2) held.delete(key.wVk);
          else held.add(key.wVk);
        }
      }
      const error = GetLastError();
      if (held.size) {
        const releases = [...held].map(vk => event(vk, 0, 2));
        SendInput(releases.length, releases, koffi.sizeof(input));
      }
      throw new Error(`Windows rejected keyboard input (${sent}/${events.length}, error ${error}). An elevated app needs OpenWhip running at the same privilege level.`);
    }
  }

  async function waitForRelease(target) {
    const deadline = Date.now() + 2000;
    while (true) {
      assertActive(target);
      if (!releaseKeys.some(key => GetAsyncKeyState(key) & 0x8000)) return;
      if (Date.now() >= deadline) throw new Error('Release Ctrl, Alt, Shift, Win and Enter, then whip again.');
      await delay(20);
    }
  }

  return {
    captureTarget, isActive, waitForRelease,
    mouseButtonsDown: () => [0x01, 0x02, 0x04, 0x05, 0x06].some(key => GetAsyncKeyState(key) & 0x8000),
    async restoreTarget(target) {
      if (!isValid(target)) return false;
      if (isActive(target)) return true;
      SetForegroundWindow(target.handle);
      await delay(100);
      return isActive(target);
    },
    interrupt(target) {
      send(target, [event(0x11), event(0x43), event(0x43, 0, 2), event(0x11, 0, 2)]);
    },
    async type(target, text, assertContinuing = () => {}) {
      // KEYEVENTF_UNICODE preserves case and works independently of the keyboard layout.
      for (const character of text) {
        assertContinuing();
        if (releaseKeys.some(key => GetAsyncKeyState(key) & 0x8000)) {
          throw new Error('Modifier key pressed during typing; remaining keys cancelled.');
        }
        const events = [];
        for (let i = 0; i < character.length; i++) {
          const unit = character.charCodeAt(i);
          events.push(event(0, unit, 4), event(0, unit, 6));
        }
        send(target, events);
        await delay(8);
      }
    },
    enter(target) {
      send(target, [event(0x0d), event(0x0d, 0, 2)]);
    },
    inputSize: koffi.sizeof(input),
  };
}

module.exports = { createWindowsInput };
