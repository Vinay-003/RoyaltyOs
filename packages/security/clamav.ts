import { createConnection } from "node:net";

export async function scanWithClamAv(
  bytes: Uint8Array,
  host: string,
  port: number,
  timeoutMs = 10_000,
): Promise<{ clean: boolean; result: string }> {
  return await new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("ClamAV scan timed out"));
    }, timeoutMs);
    const chunks: string[] = [];
    socket.on("error", (error: Error) => { clearTimeout(timer); reject(error); });
    socket.on("data", (chunk: Uint8Array) => chunks.push(Buffer.from(chunk).toString("utf8")));
    socket.on("close", () => {
      clearTimeout(timer);
      const result = chunks.join("").trim();
      if (result.endsWith("OK")) resolve({ clean: true, result });
      else if (result.includes("FOUND")) resolve({ clean: false, result });
      else reject(new Error(`Unexpected ClamAV response: ${result || "empty"}`));
    });
    socket.on("connect", () => {
      socket.write("zINSTREAM\0");
      const view = Buffer.from(bytes);
      const chunkSize = 64 * 1024;
      for (let offset = 0; offset < view.length; offset += chunkSize) {
        const chunk = view.subarray(offset, Math.min(view.length, offset + chunkSize));
        const length = Buffer.alloc(4);
        length.writeUInt32BE(chunk.length, 0);
        socket.write(length);
        socket.write(chunk);
      }
      const zero = Buffer.alloc(4);
      zero.writeUInt32BE(0, 0);
      socket.end(zero);
    });
  });
}
