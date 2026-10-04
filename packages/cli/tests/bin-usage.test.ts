import { expect, test, vi } from "vite-plus/test";
import { main } from "../src/bin.ts";

test("usage string lists the pair subcommand", async () => {
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    await main([]);
    const usage = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(usage).toContain("pair");
    expect(usage).toContain("install");
    // T98: the four parity subcommands are listed
    expect(usage).toContain("restart");
    expect(usage).toContain("logs");
    expect(usage).toContain("uninstall");
    expect(usage).toContain("update");
  } finally {
    logSpy.mockRestore();
  }
});
