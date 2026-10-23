using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;
internal static class Launcher {
  [STAThread] private static void Main() {
    var root = AppDomain.CurrentDomain.BaseDirectory;
    var folder = Path.Combine(root, "release", "售前解决方案工具-win-x64");
    var executable = Path.Combine(folder, "售前解决方案工具.exe");
    try {
      if (!File.Exists(executable)) throw new FileNotFoundException("未找到运行文件。请保留完整软件文件夹。", executable);
      Process.Start(new ProcessStartInfo(executable) { WorkingDirectory = folder, UseShellExecute = false });
    } catch (Exception error) {
      MessageBox.Show(error.Message, "售前解决方案工具", MessageBoxButtons.OK, MessageBoxIcon.Error);
    }
  }
}
