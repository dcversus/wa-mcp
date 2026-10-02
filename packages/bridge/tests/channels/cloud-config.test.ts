import { expect, test } from "vite-plus/test";
import { readCloudConfig, resolveChannel } from "../../src/channels/cloud/config.ts";

const FULL = {
  WA_CLOUD_ACCESS_TOKEN: "tok",
  WA_CLOUD_PHONE_NUMBER_ID: "109876543210987",
  WA_CLOUD_VERIFY_TOKEN: "verify-me",
  WA_CLOUD_APP_SECRET: "secret",
};

test("readCloudConfig reports each missing variable by name", () => {
  const result = readCloudConfig({});
  expect(result.ok).toBe(false);
  expect(result.errors).toEqual([
    "WA_CLOUD_ACCESS_TOKEN is required (the Cloud API access token)",
    "WA_CLOUD_PHONE_NUMBER_ID is required (the Cloud API phone number ID)",
    "WA_CLOUD_VERIFY_TOKEN is required (the Cloud API webhook verify token)",
    "WA_CLOUD_APP_SECRET is required (the Cloud API app secret)",
  ]);
});

test("readCloudConfig defaults the api version and trims values", () => {
  const result = readCloudConfig({ ...FULL, WA_CLOUD_ACCESS_TOKEN: "  tok  " });
  expect(result.config).toMatchObject({ accessToken: "tok", apiVersion: "v22.0" });
});

test("resolveChannel defaults to baileys", () => {
  expect(resolveChannel({})).toEqual({ channel: "baileys" });
});

test("resolveChannel rejects an unknown channel by name", () => {
  const result = resolveChannel({ WA_CHANNEL: "smoke-signals" });
  expect(result).toEqual({
    channel: "cloud",
    errors: ["WA_CHANNEL must be 'baileys' or 'cloud' (got 'smoke-signals')"],
  });
});

test("resolveChannel resolves cloud only with a complete config", () => {
  expect(resolveChannel({ WA_CHANNEL: "cloud" })).toMatchObject({ errors: expect.any(Array) });
  const ok = resolveChannel({ WA_CHANNEL: "cloud", ...FULL });
  expect(ok).toMatchObject({ channel: "cloud", config: { phoneNumberId: "109876543210987" } });
});
