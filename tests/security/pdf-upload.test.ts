import test from "node:test";
import assert from "node:assert/strict";
import { validatePdf } from "../../packages/security/pdf.ts";
import { validateContractUpload } from "../../packages/security/upload.ts";
import { minimalPdf } from "../helpers.ts";

test("validates PDF magic bytes EOF size pages and SHA-256",()=>{
 const result=validatePdf(minimalPdf(),1_000_000,10);
 assert.equal(result.pageCount,1);
 assert.match(result.sha256,/^[a-f0-9]{64}$/);
});

test("rejects non-PDF and truncated data",()=>{
 assert.throws(()=>validatePdf(new TextEncoder().encode("hello %%EOF"),1000,10),/magic bytes/);
 assert.throws(()=>validatePdf(new TextEncoder().encode("%PDF-1.7 no eof"),1000,10),/truncated/);
});

test("production uploads fail closed without a malware scanner",async()=>{
 await assert.rejects(()=>validateContractUpload(minimalPdf(),{maxBytes:1_000_000,maxPages:10,malwareScanMode:"disabled",clamavHost:"127.0.0.1",clamavPort:3310,nodeEnv:"production"}),/require MALWARE_SCAN_MODE=clamav/);
});
