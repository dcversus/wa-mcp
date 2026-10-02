import { expect, test, vi } from "vite-plus/test";
import type { WASocket } from "baileys";
import { formatPairingCode, requestPairingCode } from "../src/pairing-code.ts";

function fakeSocket(code = "ABCD1234") {
  const requestPairingCodeMock = vi.fn(async (_phone: string) => code);
  return {
    sock: { requestPairingCode: requestPairingCodeMock } as unknown as WASocket,
    requestPairingCodeMock,
  };
}

test("requestPairingCode strips the phone to digits and forwards it", async () => {
  const { sock, requestPairingCodeMock } = fakeSocket();
  await requestPairingCode(sock, "+358 497 773 518");
  expect(requestPairingCodeMock).toHaveBeenCalledTimes(1);
  expect(requestPairingCodeMock.mock.calls[0]?.[0]).toBe("358497773518");
});

test("requestPairingCode formats the 8-char code as XXXX-XXXX", async () => {
  const { sock } = fakeSocket("ABCD1234");
  const code = await requestPairingCode(sock, "358497773518");
  expect(formatPairingCode("ABCD1234")).toBe("ABCD-1234");
  expect(code).toBe("ABCD-1234");
});

test("requestPairingCode rejects phones outside 8-15 digits", async () => {
  const { sock } = fakeSocket();
  await expect(requestPairingCode(sock, "1234567")).rejects.toMatchObject({
    code: "VALIDATION_ERROR",
  });
  await expect(requestPairingCode(sock, "1234567890123456")).rejects.toMatchObject({
    code: "VALIDATION_ERROR",
  });
  await expect(requestPairingCode(sock, "no-digits")).rejects.toMatchObject({
    code: "VALIDATION_ERROR",
  });
  expect(sock.requestPairingCode as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
});
