// Add-platform page — QR device-flow login via lark-cli.
// Server shell; AddPlatformFlow is a client island that drives the device-code UX.

import { AddPlatformFlow } from "@/components/add-platform-flow";

export default function AddPlatformPage() {
  return (
    <div className="space-y-6 max-w-lg">
      <h1 className="text-2xl font-semibold">Add Platform</h1>
      <p className="text-sm text-zinc-500">
        Authorize a new Lark workspace using the device-code flow. Scan the QR code (or
        visit the verification URL) in your browser, then approve access in Lark.
      </p>
      <AddPlatformFlow />
    </div>
  );
}
