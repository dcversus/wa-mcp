/** Cloud API credentials come from env/config ONLY — never the store (GOAL §18).
 * Missing or empty values are reported as clear, named errors. */

export interface CloudChannelConfig {
  accessToken: string;
  phoneNumberId: string;
  verifyToken: string;
  appSecret: string;
  apiVersion: string;
}

export interface CloudConfigResult {
  ok: boolean;
  config: CloudChannelConfig | null;
  errors: string[];
}

const REQUIRED: Array<{ key: string; label: string }> = [
  { key: "WA_CLOUD_ACCESS_TOKEN", label: "access token" },
  { key: "WA_CLOUD_PHONE_NUMBER_ID", label: "phone number ID" },
  { key: "WA_CLOUD_VERIFY_TOKEN", label: "webhook verify token" },
  { key: "WA_CLOUD_APP_SECRET", label: "app secret (webhook signature)" },
];

export function readCloudConfig(env: Record<string, string | undefined>): CloudConfigResult {
  const errors: string[] = [];
  for (const { key, label } of REQUIRED) {
    const value = env[key];
    if (value === undefined || value.trim().length === 0) {
      errors.push(`${key} is required (the Cloud API ${label})`);
    }
  }
  if (errors.length > 0) {
    return { ok: false, config: null, errors };
  }
  return {
    ok: true,
    config: {
      accessToken: env.WA_CLOUD_ACCESS_TOKEN!.trim(),
      phoneNumberId: env.WA_CLOUD_PHONE_NUMBER_ID!.trim(),
      verifyToken: env.WA_CLOUD_VERIFY_TOKEN!.trim(),
      appSecret: env.WA_CLOUD_APP_SECRET!.trim(),
      apiVersion: env.WA_CLOUD_API_VERSION?.trim() || "v22.0",
    },
    errors: [],
  };
}
