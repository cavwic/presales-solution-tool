import { expect, type Page } from "@playwright/test";

export async function selectProjectDirectory(page: Page, name = "测试项目路径") {
  await page.evaluate((folderName) => {
    class MemoryFileHandle {
      kind = "file" as const;
      private content: Blob = new Blob();

      constructor(public name: string) {}

      async getFile() {
        return new File([this.content], this.name);
      }

      async createWritable() {
        return {
          write: async (content: Blob | string | ArrayBuffer) => {
            this.content = content instanceof Blob ? content : new Blob([content]);
          },
          close: async () => undefined,
        };
      }
    }

    class MemoryDirectoryHandle {
      kind = "directory" as const;
      directories = new Map<string, MemoryDirectoryHandle>();
      files = new Map<string, MemoryFileHandle>();

      constructor(public name: string) {}

      async queryPermission() { return "granted" as PermissionState; }
      async requestPermission() { return "granted" as PermissionState; }

      async getDirectoryHandle(childName: string) {
        if (!this.directories.has(childName)) this.directories.set(childName, new MemoryDirectoryHandle(childName));
        return this.directories.get(childName)!;
      }

      async getFileHandle(fileName: string) {
        if (!this.files.has(fileName)) this.files.set(fileName, new MemoryFileHandle(fileName));
        return this.files.get(fileName)!;
      }

      async *entries() {
        for (const entry of this.directories.entries()) yield entry;
        for (const entry of this.files.entries()) yield entry;
      }

      async removeEntry(entryName: string) {
        this.files.delete(entryName);
        this.directories.delete(entryName);
      }
    }

    const root = new MemoryDirectoryHandle(folderName);
    const testWindow = window as typeof window & {
      __workspaceRoot?: MemoryDirectoryHandle;
      __outputRoot?: MemoryDirectoryHandle;
      __directoryPickerQueue?: MemoryDirectoryHandle[];
      __MemoryDirectoryHandle?: typeof MemoryDirectoryHandle;
    };
    testWindow.__workspaceRoot = root;
    testWindow.__directoryPickerQueue = [];
    testWindow.__MemoryDirectoryHandle = MemoryDirectoryHandle;
    window.showDirectoryPicker = async () => (testWindow.__directoryPickerQueue?.shift() || root) as never;
  }, name);

  const settingsHeading = page.getByRole("heading", { name: "项目设置", exact: true });
  if (!await settingsHeading.isVisible()) await page.getByRole("button", { name: "项目设置", exact: true }).click();
  await page.getByRole("button", { name: "选择", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "是，继续" }).click();
  await expect(page.getByLabel("项目路径")).toHaveValue(name);
  await page.getByRole("button", { name: "关闭项目设置" }).click();
}

export async function selectOutputDirectory(page: Page, name = "测试输出路径") {
  await page.evaluate((folderName) => {
    const testWindow = window as typeof window & {
      __outputRoot?: { name: string };
      __directoryPickerQueue?: Array<{ name: string }>;
      __MemoryDirectoryHandle?: new (name: string) => { name: string };
    };
    if (!testWindow.__MemoryDirectoryHandle || !testWindow.__directoryPickerQueue) throw new Error("Project directory test harness is not initialized.");
    const output = new testWindow.__MemoryDirectoryHandle(folderName);
    testWindow.__outputRoot = output;
    testWindow.__directoryPickerQueue.push(output);
  }, name);
  await page.getByRole("button", { name: "选择路径", exact: true }).click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
}
