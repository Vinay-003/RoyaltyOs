import { scanWithClamAv } from "./clamav.ts";
import { validatePdf } from "./pdf.ts";

export async function validateContractUpload(
  bytes: Uint8Array,
  options: {
    maxBytes: number;
    maxPages: number;
    malwareScanMode: string;
    clamavHost: string;
    clamavPort: number;
    nodeEnv: string;
  },
) {
  const pdf = validatePdf(bytes, options.maxBytes, options.maxPages);
  if (options.malwareScanMode === "clamav") {
    const scan = await scanWithClamAv(bytes, options.clamavHost, options.clamavPort);
    if (!scan.clean) throw new Error(`Malware scan rejected upload: ${scan.result}`);
    return { ...pdf, malwareScan: "CLEAN" as const, malwareScanDetail: scan.result };
  }
  if (options.nodeEnv === "production") {
    throw new Error("Production contract uploads require MALWARE_SCAN_MODE=clamav");
  }
  return { ...pdf, malwareScan: "NOT_CONFIGURED" as const, malwareScanDetail: "Development-only bypass" };
}
