"use client";

import { useState, useEffect, useRef } from "react";

type FlowState = "idle" | "loading" | "pending" | "complete" | "error" | "expired";

interface InitResponse {
  deviceCode: string;
  verificationUrl: string;
  expiresIn: number;
  error?: string;
}

interface PollResponse {
  status: "pending" | "complete" | "expired" | "error";
  error?: string;
}

export function AddPlatformFlow() {
  const [state, setState] = useState<FlowState>("idle");
  const [deviceCode, setDeviceCode] = useState<string | null>(null);
  const [verificationUrl, setVerificationUrl] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPoll = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  useEffect(() => () => stopPoll(), []);

  const startFlow = async () => {
    setState("loading");
    setErrorMsg(null);
    setQrDataUrl(null);
    stopPoll();

    try {
      const res = await fetch("/api/auth-qr", { method: "POST" });
      const data: InitResponse = await res.json();
      if (!res.ok || data.error) {
        setState("error");
        setErrorMsg(data.error ?? "Failed to start device flow");
        return;
      }

      setDeviceCode(data.deviceCode);
      setVerificationUrl(data.verificationUrl);

      // Generate QR code client-side using qrcode library
      try {
        const QRCode = (await import("qrcode")).default;
        const url = await QRCode.toDataURL(data.verificationUrl, { width: 240, margin: 2 });
        setQrDataUrl(url);
      } catch {
        // QR generation failed — URL is still shown as text fallback
      }

      setState("pending");

      // Poll for completion every 3s
      pollRef.current = setInterval(async () => {
        try {
          const pollRes = await fetch(`/api/auth-qr?deviceCode=${encodeURIComponent(data.deviceCode)}`);
          const pollData: PollResponse = await pollRes.json();
          if (pollData.status === "complete") {
            stopPoll();
            setState("complete");
          } else if (pollData.status === "expired") {
            stopPoll();
            setState("expired");
          } else if (pollData.status === "error") {
            stopPoll();
            setState("error");
            setErrorMsg(pollData.error ?? "Authorization error");
          }
          // "pending" → keep polling
        } catch {
          // network blip — keep polling
        }
      }, 3000);

    } catch (err) {
      setState("error");
      setErrorMsg(err instanceof Error ? err.message : "Unknown error");
    }
  };

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm space-y-5">
      {state === "idle" && (
        <button
          onClick={startFlow}
          className="rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-700"
        >
          Start device-flow login
        </button>
      )}

      {state === "loading" && (
        <p className="text-sm text-zinc-500">Contacting lark-cli…</p>
      )}

      {(state === "pending") && verificationUrl && (
        <div className="space-y-4">
          <p className="text-sm text-zinc-700 font-medium">
            Scan the QR code or visit the URL to authorize in Lark:
          </p>
          {qrDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qrDataUrl} alt="QR code for Lark authorization" className="rounded border border-zinc-100" />
          ) : (
            <div className="rounded bg-zinc-100 p-4">
              <p className="text-xs text-zinc-500 mb-1">Verification URL:</p>
              <a
                href={verificationUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all font-mono text-xs text-blue-600 underline"
              >
                {verificationUrl}
              </a>
            </div>
          )}
          {deviceCode && (
            <div className="rounded bg-zinc-50 border border-zinc-100 px-4 py-2">
              <p className="text-xs text-zinc-400 mb-0.5">Device code</p>
              <code className="font-mono text-sm text-zinc-800">{deviceCode}</code>
            </div>
          )}
          <p className="text-xs text-zinc-400 animate-pulse">Waiting for authorization…</p>
          <button
            onClick={() => { stopPoll(); setState("idle"); }}
            className="text-xs text-zinc-400 underline hover:text-zinc-600"
          >
            Cancel
          </button>
        </div>
      )}

      {state === "complete" && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-green-700">
            Authorization complete! The platform is now linked.
          </p>
          <button
            onClick={() => setState("idle")}
            className="rounded border border-zinc-200 px-4 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50"
          >
            Add another
          </button>
        </div>
      )}

      {state === "expired" && (
        <div className="space-y-3">
          <p className="text-sm text-amber-600">The device code expired. Please try again.</p>
          <button
            onClick={startFlow}
            className="rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-700"
          >
            Retry
          </button>
        </div>
      )}

      {state === "error" && (
        <div className="space-y-3">
          <p className="text-sm text-red-600">{errorMsg ?? "An error occurred."}</p>
          <button
            onClick={startFlow}
            className="rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-700"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
