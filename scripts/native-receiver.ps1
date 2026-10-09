param([Parameter(Mandatory=$true)][string]$Report, [Parameter(Mandatory=$true)][string]$Command)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Windows.Forms,System.Drawing -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Windows.Forms;
using System.Drawing;
using System.Runtime.InteropServices;

public class OpenWhipReceiver : Form {
  public TextBox Input = new TextBox();
  public List<string> Submitted = new List<string>();
  public int Interrupts;
  public int Clicks;
  public int Ticks;
  public Button ClickTarget = new Button { Text = "Click-through test", Dock = DockStyle.Bottom, Height = 32 };
  public OpenWhipReceiver(string title, int left) {
    Text = title;
    Size = new Size(520, 180);
    StartPosition = FormStartPosition.Manual;
    Location = new Point(left, 100);
    var label = new Label { Text = "Temporary OpenWhip keyboard validation", Dock = DockStyle.Top, Height = 36 };
    Input.Dock = DockStyle.Top;
    Input.KeyDown += (sender, e) => {
      if (e.Control && e.KeyCode == Keys.C) { Interrupts++; e.SuppressKeyPress = true; }
      if (e.KeyCode == Keys.Enter && e.Modifiers == Keys.None) {
        Submitted.Add(Input.Text);
        e.SuppressKeyPress = true;
      }
    };
    Controls.Add(Input);
    Controls.Add(label);
    ClickTarget.Click += (sender, e) => { Clicks++; Input.Focus(); };
    Controls.Add(ClickTarget);
    Shown += (sender, e) => Input.Focus();
  }
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr handle);
  public Point ClickPoint() { return ClickTarget.PointToScreen(new Point(ClickTarget.Width / 2, ClickTarget.Height / 2)); }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr handle, IntPtr pid);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint first, uint second, bool attach);
  public void FocusInput() {
    var current = GetCurrentThreadId();
    var foreground = GetWindowThreadProcessId(GetForegroundWindow(), IntPtr.Zero);
    bool attached = current != foreground && AttachThreadInput(current, foreground, true);
    try { Show(); Activate(); SetForegroundWindow(Handle); Input.Focus(); }
    finally { if (attached) AttachThreadInput(current, foreground, false); }
  }
}
'@
[System.Windows.Forms.Application]::EnableVisualStyles()
$receiverA = [OpenWhipReceiver]::new('OpenWhip test receiver A', 100)
$receiverB = [OpenWhipReceiver]::new('OpenWhip test receiver B', 660)
$testTimer = [System.Windows.Forms.Timer]::new()
$testTimer.Interval = 40
$receiverStarted = [DateTime]::UtcNow
$writeReceiverReport = {
  $receiverReport = [ordered]@{
    pid = $PID
    foreground = [OpenWhipReceiver]::GetForegroundWindow().ToInt64()
    a = [ordered]@{ handle = $receiverA.Handle.ToInt64(); text = $receiverA.Input.Text; interrupts = $receiverA.Interrupts; submitted = @($receiverA.Submitted.ToArray()); clicks = $receiverA.Clicks; ticks = $receiverA.Ticks; clickPoint = [ordered]@{ x = $receiverA.ClickPoint().X; y = $receiverA.ClickPoint().Y } }
    b = [ordered]@{ handle = $receiverB.Handle.ToInt64(); text = $receiverB.Input.Text; interrupts = $receiverB.Interrupts; submitted = @($receiverB.Submitted.ToArray()) }
  }
  $receiverReport | ConvertTo-Json -Depth 5 -Compress | Set-Content -LiteralPath ($Report + '.tmp') -Encoding UTF8
  Move-Item -LiteralPath ($Report + '.tmp') -Destination $Report -Force
}
$testTimer.Add_Tick({
  $receiverA.Ticks += 1
  if ([IO.File]::Exists($Command)) {
    $receiverCommand = [IO.File]::ReadAllText($Command).Trim()
    [IO.File]::Delete($Command)
    switch ($receiverCommand) {
      'focus-a' { $receiverA.FocusInput() }
      'focus-b' { $receiverB.FocusInput() }
      'reset-a' { $receiverA.Input.Clear(); $receiverA.Submitted.Clear(); $receiverA.Interrupts = 0; $receiverA.FocusInput() }
      'quit' { $receiverA.Close() }
    }
  }
  & $writeReceiverReport
  if (([DateTime]::UtcNow - $receiverStarted).TotalSeconds -gt 90) { $receiverA.Close() }
})
$receiverA.Add_Shown({ $receiverB.Show(); $receiverA.FocusInput(); $testTimer.Start() })
try { [System.Windows.Forms.Application]::Run($receiverA) }
finally { $testTimer.Stop(); $testTimer.Dispose(); $receiverB.Close(); $receiverA.Dispose(); $receiverB.Dispose() }
