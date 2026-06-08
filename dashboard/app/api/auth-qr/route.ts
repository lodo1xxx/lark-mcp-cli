// API route: POST /api/auth-qr — initiate lark-cli device-flow login.
// Returns { deviceCode, verificationUrl } — app_secret never touches the client.
// GET /api/auth-qr?deviceCode=<code> — poll completion status.

import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { z } from "zod";

export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);
const LARK_CLI = process.env["LARK_CLI_BINARY"] ?? "lark-cli";

interface DeviceFlowInit {
  device_code: string;
  verification_url: string;
  expires_in?: number;
}

interface DeviceFlowPoll {
  status: "pending" | "complete" | "expired" | "error";
  token?: string;
  error?: string;
}

// POST — initiate device flow
export async function POST() {
  try {
    const { stdout } = await execFileAsync(
      LARK_CLI,
      ["auth", "login", "--no-wait", "--json"],
      { timeout: 15_000 },
    );
    const parsed = JSON.parse(stdout.trim()) as DeviceFlowInit;
    return NextResponse.json({
      deviceCode: parsed.device_code,
      verificationUrl: parsed.verification_url,
      expiresIn: parsed.expires_in ?? 300,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `lark-cli failed: ${msg}` }, { status: 500 });
  }
}

// GET — poll with device code
const PollSchema = z.object({ deviceCode: z.string().min(1) });

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = PollSchema.safeParse({ deviceCode: url.searchParams.get("deviceCode") });
  if (!parsed.success) {
    return NextResponse.json({ error: "deviceCode required" }, { status: 400 });
  }

  try {
    const { stdout } = await execFileAsync(
      LARK_CLI,
      ["auth", "login", "--device-code", parsed.data.deviceCode, "--json"],
      { timeout: 10_000 },
    );
    const result = JSON.parse(stdout.trim()) as DeviceFlowPoll;
    // Never forward any token/secret to client — only forward status
    return NextResponse.json({ status: result.status ?? "pending" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Timeout / pending is normal during polling
    if (msg.includes("timeout") || msg.includes("pending")) {
      return NextResponse.json({ status: "pending" });
    }
    return NextResponse.json({ status: "error", error: msg }, { status: 500 });
  }
}
