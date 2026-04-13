import { z } from "zod";

// ---------------------------------------------------------------------------
// Environment validation — fails fast at boot if required vars are missing
// ---------------------------------------------------------------------------

const serverSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url("DATABASE_URL must be a valid URL"),
  ADMIN_PASSWORD: z.string().min(4, "ADMIN_PASSWORD must be at least 4 chars"),
  AUTH_SECRET: z
    .string()
    .min(32, "AUTH_SECRET must be at least 32 chars (use a random string)"),
  // QuickBooks Payments (optional — payment can be disabled in settings)
  QB_ACCESS_TOKEN: z.string().optional(),
  QB_REFRESH_TOKEN: z.string().optional(),
  QB_REALM_ID: z.string().optional(),
  QB_CLIENT_ID: z.string().optional(),
  QB_CLIENT_SECRET: z.string().optional(),
});

const clientSchema = z.object({
  NEXT_PUBLIC_BASE_URL: z.string().url("NEXT_PUBLIC_BASE_URL must be a valid URL"),
});

// ---------------------------------------------------------------------------
// Parse + format errors
// ---------------------------------------------------------------------------
function formatError(error: z.ZodError, scope: string): string {
  const issues = error.issues
    .map((i) => `  - ${i.path.join(".") || "<root>"}: ${i.message}`)
    .join("\n");
  return `Invalid ${scope} environment variables:\n${issues}`;
}

const serverResult = serverSchema.safeParse(process.env);
if (!serverResult.success) {
  console.error(formatError(serverResult.error, "server"));
  throw new Error("Server env validation failed");
}

const clientResult = clientSchema.safeParse({
  NEXT_PUBLIC_BASE_URL: process.env.NEXT_PUBLIC_BASE_URL,
});
if (!clientResult.success) {
  console.error(formatError(clientResult.error, "client"));
  throw new Error("Client env validation failed");
}

export const env = {
  ...serverResult.data,
  ...clientResult.data,
} as const;

export const isProd = env.NODE_ENV === "production";
export const isDev = env.NODE_ENV === "development";
