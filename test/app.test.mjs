import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import app from "../pdfgate.app.mjs";

const withAuth = (apiKey) => ({
  ...app.methods,
  $auth: {
    api_key: apiKey,
  },
});

test("sandbox keys target the sandbox API", () => {
  assert.equal(withAuth("test_abc")._baseUrl(), "https://api-sandbox.pdfgate.com");
});

test("live keys target the production API", () => {
  assert.equal(withAuth("live_abc")._baseUrl(), "https://api.pdfgate.com");
});

test("request helpers hit the expected endpoints", async () => {
  const calls = [];
  const ctx = {
    ...withAuth("test_abc"),
    _makeRequest(opts) {
      calls.push(opts);
      return Promise.resolve({});
    },
  };

  await ctx.checkAuth();
  await ctx.generatePdf({ data: { html: "<p>hi</p>" } });
  await ctx.uploadFile({ data: { url: "https://x/y.pdf" } });
  await ctx.getDocument({ documentId: "doc_1", params: { preSignedUrlExpiresIn: 60 } });
  await ctx.deleteDocument({ documentId: "doc_1" });
  await ctx.compressPdf({ data: {} });
  await ctx.flattenPdf({ data: {} });
  await ctx.extractFormData({ data: {} });
  await ctx.protectPdf({ data: {} });
  await ctx.watermarkPdf({ data: {} });
  await ctx.createEnvelope({ data: {} });
  await ctx.sendEnvelope({ envelopeId: "env_1" });
  await ctx.getEnvelope({ envelopeId: "env_1" });
  await ctx.createWebhook({ data: {} });
  await ctx.deleteWebhook({ webhookId: "wh_1" });

  assert.deepEqual(
    calls.map(({ method = "GET", path }) => `${method} ${path}`),
    [
      "GET /auth",
      "POST /v1/generate/pdf",
      "POST /upload",
      "GET /document/doc_1",
      "DELETE /document/doc_1",
      "POST /compress/pdf",
      "POST /forms/flatten",
      "POST /forms/extract-data",
      "POST /protect/pdf",
      "POST /watermark/pdf",
      "POST /envelope",
      "POST /envelope/env_1/send",
      "GET /envelope/env_1",
      "POST /webhook",
      "DELETE /webhook/wh_1",
    ],
  );
  assert.deepEqual(calls[3].params, { preSignedUrlExpiresIn: 60 });
});

const sign = (secret, timestamp, payload) =>
  createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");

test("verifyWebhookSignature accepts a valid signature", () => {
  const secret = "whsec_123";
  const payload = JSON.stringify({ event: "envelope.sent" });
  const now = 1_700_000_000;
  const header = `t=${now},v1=${sign(secret, now, payload)}`;
  assert.equal(app.methods.verifyWebhookSignature({ secret, signatureHeader: header, payload, now }), true);
});

test("verifyWebhookSignature accepts a valid signature among several v1 entries", () => {
  const secret = "whsec_123";
  const payload = "{}";
  const now = 1_700_000_000;
  const header = `t=${now},v1=deadbeef,v1=${sign(secret, now, payload)}`;
  assert.equal(app.methods.verifyWebhookSignature({ secret, signatureHeader: header, payload, now }), true);
});

test("verifyWebhookSignature rejects a tampered payload", () => {
  const secret = "whsec_123";
  const now = 1_700_000_000;
  const header = `t=${now},v1=${sign(secret, now, "{\"a\":1}")}`;
  assert.equal(app.methods.verifyWebhookSignature({ secret, signatureHeader: header, payload: "{\"a\":2}", now }), false);
});

test("verifyWebhookSignature rejects stale timestamps", () => {
  const secret = "whsec_123";
  const payload = "{}";
  const then = 1_700_000_000;
  const header = `t=${then},v1=${sign(secret, then, payload)}`;
  assert.equal(app.methods.verifyWebhookSignature({ secret, signatureHeader: header, payload, now: then + 301 }), false);
  assert.equal(app.methods.verifyWebhookSignature({ secret, signatureHeader: header, payload, now: then + 299 }), true);
});

test("verifyWebhookSignature rejects missing header or secret", () => {
  assert.equal(app.methods.verifyWebhookSignature({ secret: "s", signatureHeader: undefined, payload: "{}" }), false);
  assert.equal(app.methods.verifyWebhookSignature({ secret: undefined, signatureHeader: "t=1,v1=a", payload: "{}" }), false);
  assert.equal(app.methods.verifyWebhookSignature({ secret: "s", signatureHeader: "garbage", payload: "{}" }), false);
});
