import { test } from "node:test";
import assert from "node:assert/strict";
import generatePdf from "../actions/generate-pdf/generate-pdf.mjs";
import uploadFile from "../actions/upload-file/upload-file.mjs";
import getDocument from "../actions/get-document/get-document.mjs";
import deleteDocument from "../actions/delete-document/delete-document.mjs";
import compressPdf from "../actions/compress-pdf/compress-pdf.mjs";
import flattenPdf from "../actions/flatten-pdf/flatten-pdf.mjs";
import extractFormData from "../actions/extract-form-data/extract-form-data.mjs";
import protectPdf from "../actions/protect-pdf/protect-pdf.mjs";
import watermarkPdf from "../actions/watermark-pdf/watermark-pdf.mjs";
import createEnvelope from "../actions/create-envelope/create-envelope.mjs";
import sendEnvelope from "../actions/send-envelope/send-envelope.mjs";
import getEnvelope from "../actions/get-envelope/get-envelope.mjs";
import {
  buildContext, buildStep,
} from "./helpers.mjs";

const ALL_ACTIONS = [
  generatePdf,
  uploadFile,
  getDocument,
  deleteDocument,
  compressPdf,
  flattenPdf,
  extractFormData,
  protectPdf,
  watermarkPdf,
  createEnvelope,
  sendEnvelope,
  getEnvelope,
];

test("every action has the required registry metadata", () => {
  const keys = new Set();
  for (const action of ALL_ACTIONS) {
    assert.equal(action.type, "action", `${action.name} type`);
    assert.match(action.key, /^pdfgate-[a-z-]+$/, `${action.name} key`);
    assert.match(action.version, /^\d+\.\d+\.\d+$/, `${action.name} version`);
    assert.ok(action.description.includes("[See the documentation]"), `${action.name} description links docs`);
    assert.ok(action.props.app, `${action.name} has app prop`);
    assert.ok(action.annotations, `${action.name} has annotations`);
    assert.ok(!keys.has(action.key), `duplicate key ${action.key}`);
    keys.add(action.key);
  }
});

const stub = (name, ...rest) => {
  const result = rest.length
    ? rest[0]
    : { id: "doc_out" };
  const calls = [];
  return {
    calls,
    methods: {
      [name]: (opts) => {
        calls.push(opts);
        return Promise.resolve(result);
      },
    },
  };
};

test("generate-pdf builds the request body with nested margin/viewport/authentication", async () => {
  const { calls, methods } = stub("generatePdf");
  const ctx = buildContext(generatePdf, {
    url: "https://example.com",
    pageSizeType: "a4",
    marginTop: "20px",
    marginBottom: "",
    viewportWidth: 1280,
    authenticationUsername: "user",
    authenticationPassword: "pass",
    httpHeaders: "{\"X-Trace\":\"1\"}",
    clickSelectorChainSetup: { chains: [{ selectors: ["#ok"] }] },
    scale: "1.5",
    preSignedUrlExpiresIn: 120,
    metadata: { invoiceId: "INV-1" },
  }, methods);
  const { $, exports } = buildStep();

  const result = await generatePdf.run.call(ctx, { $ });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].data, {
    jsonResponse: true,
    url: "https://example.com",
    pageSizeType: "a4",
    clickSelectorChainSetup: { chains: [{ selectors: ["#ok"] }] },
    scale: 1.5,
    httpHeaders: { "X-Trace": "1" },
    preSignedUrlExpiresIn: 120,
    metadata: { invoiceId: "INV-1" },
    margin: { top: "20px" },
    viewport: { width: 1280 },
    authentication: { username: "user", password: "pass" },
  });
  assert.equal(calls[0].timeout, 15 * 60 * 1000);
  assert.deepEqual(result, { id: "doc_out" });
  assert.match(exports.$summary, /doc_out/);
});

test("generate-pdf requires either url or html", async () => {
  const ctx = buildContext(generatePdf, {}, stub("generatePdf").methods);
  await assert.rejects(() => generatePdf.run.call(ctx, buildStep()), /URL.*HTML Content/);
});

test("generate-pdf rejects invalid JSON in object fields", async () => {
  const ctx = buildContext(generatePdf, {
    html: "<p/>",
    metadata: "{not json",
  }, stub("generatePdf").methods);
  await assert.rejects(() => generatePdf.run.call(ctx, buildStep()), /Metadata.*valid JSON object/);
});

test("upload-file never sends jsonResponse", async () => {
  const { calls, methods } = stub("uploadFile");
  const ctx = buildContext(uploadFile, {
    url: "https://files.example.com/a.pdf",
    metadata: "{\"a\":1}",
  }, methods);
  await uploadFile.run.call(ctx, buildStep());
  assert.deepEqual(calls[0].data, {
    url: "https://files.example.com/a.pdf",
    metadata: { a: 1 },
  });
  assert.equal("jsonResponse" in calls[0].data, false);
});

test("extract-form-data sends only the documentId", async () => {
  const { calls, methods } = stub("extractFormData", { field: "value" });
  const ctx = buildContext(extractFormData, { documentId: "doc_1" }, methods);
  const result = await extractFormData.run.call(ctx, buildStep());
  assert.deepEqual(calls[0].data, { documentId: "doc_1" });
  assert.deepEqual(result, { field: "value" });
});

test("get-document passes preSignedUrlExpiresIn as a query param", async () => {
  const { calls, methods } = stub("getDocument");
  const ctx = buildContext(getDocument, { documentId: "doc_1", preSignedUrlExpiresIn: 600 }, methods);
  await getDocument.run.call(ctx, buildStep());
  assert.equal(calls[0].documentId, "doc_1");
  assert.deepEqual(calls[0].params, { preSignedUrlExpiresIn: 600 });
});

test("delete-document falls back to a synthetic result when the API returns no body", async () => {
  const { calls, methods } = stub("deleteDocument", undefined);
  const ctx = buildContext(deleteDocument, { documentId: "doc_1" }, methods);
  const result = await deleteDocument.run.call(ctx, buildStep());
  assert.equal(calls[0].documentId, "doc_1");
  assert.deepEqual(result, { id: "doc_1", deleted: true });
});

test("compress-pdf sends jsonResponse and optional linearize", async () => {
  const { calls, methods } = stub("compressPdf");
  const ctx = buildContext(compressPdf, { documentId: "doc_1", linearize: true }, methods);
  await compressPdf.run.call(ctx, buildStep());
  assert.deepEqual(calls[0].data, { documentId: "doc_1", jsonResponse: true, linearize: true });
});

test("flatten-pdf includes fieldNames only when provided", async () => {
  const { calls, methods } = stub("flattenPdf");
  await flattenPdf.run.call(buildContext(flattenPdf, { documentId: "doc_1", fieldNames: [] }, methods), buildStep());
  assert.deepEqual(calls[0].data, { documentId: "doc_1", jsonResponse: true });
  await flattenPdf.run.call(buildContext(flattenPdf, { documentId: "doc_1", fieldNames: ["name", "date"] }, methods), buildStep());
  assert.deepEqual(calls[1].data, { documentId: "doc_1", jsonResponse: true, fieldNames: ["name", "date"] });
});

test("protect-pdf forwards passwords and permission flags", async () => {
  const { calls, methods } = stub("protectPdf");
  const ctx = buildContext(protectPdf, {
    documentId: "doc_1",
    algorithm: "AES256",
    userPassword: "open",
    ownerPassword: "",
    disablePrint: true,
    disableCopy: false,
  }, methods);
  await protectPdf.run.call(ctx, buildStep());
  assert.deepEqual(calls[0].data, {
    documentId: "doc_1",
    jsonResponse: true,
    algorithm: "AES256",
    userPassword: "open",
    disablePrint: true,
    disableCopy: false,
  });
});

test("watermark-pdf always sends type=text and coerces numeric strings", async () => {
  const { calls, methods } = stub("watermarkPdf");
  const ctx = buildContext(watermarkPdf, {
    documentId: "doc_1",
    text: "CONFIDENTIAL",
    opacity: "0.4",
    rotate: "45",
    fontSize: 36,
    font: "helvetica-bold",
  }, methods);
  await watermarkPdf.run.call(ctx, buildStep());
  assert.deepEqual(calls[0].data, {
    documentId: "doc_1",
    type: "text",
    text: "CONFIDENTIAL",
    jsonResponse: true,
    fontSize: 36,
    font: "helvetica-bold",
    opacity: 0.4,
    rotate: 45,
  });
});

test("watermark-pdf rejects an out-of-range opacity", async () => {
  const ctx = buildContext(watermarkPdf, { documentId: "doc_1", text: "x", opacity: "1.5" }, stub("watermarkPdf").methods);
  await assert.rejects(() => watermarkPdf.run.call(ctx, buildStep()), /Opacity.*between 0 and 1/);
});

test("generate-pdf rejects an out-of-range scale", async () => {
  const ctx = buildContext(generatePdf, { html: "<p/>", scale: "3" }, stub("generatePdf").methods);
  await assert.rejects(() => generatePdf.run.call(ctx, buildStep()), /Page Scale.*between 0.1 and 2/);
});

test("every action declares ai: optimized and every prop description has an example", () => {
  for (const action of ALL_ACTIONS) {
    assert.equal(action.ai, "optimized", `${action.name} ai`);
    for (const [name, prop] of Object.entries(action.props)) {
      if (name === "app" || prop.propDefinition) continue;
      assert.match(prop.description, /e\.g\. `|Example: `/, `${action.name} prop ${name} has an example`);
    }
  }
});

test("watermark-pdf rejects a non-numeric opacity", async () => {
  const ctx = buildContext(watermarkPdf, { documentId: "doc_1", text: "x", opacity: "abc" }, stub("watermarkPdf").methods);
  await assert.rejects(() => watermarkPdf.run.call(ctx, buildStep()), /Opacity.*must be a number/);
});

test("create-envelope builds documents from the primary document plus additional documents", async () => {
  const { calls, methods } = stub("createEnvelope", { id: "env_1" });
  const ctx = buildContext(createEnvelope, {
    requesterName: "Acme Inc",
    sourceDocumentId: "doc_1",
    documentName: "NDA.pdf",
    recipients: [
      "{\"email\":\"a@example.com\",\"name\":\"A\",\"role\":\"Signer\"}",
      { email: "b@example.com", name: "B", reminderIntervalDays: 0 },
    ],
    reminderIntervalDays: 3,
    reminderAttempts: 2,
    additionalDocuments: [
      "{\"sourceDocumentId\":\"doc_2\",\"name\":\"Annex.pdf\",\"recipients\":[{\"email\":\"c@example.com\",\"name\":\"C\"}]}",
    ],
    metadata: "{\"dealId\":\"42\"}",
  }, methods);
  const { $, exports } = buildStep();

  const result = await createEnvelope.run.call(ctx, { $ });

  assert.deepEqual(calls[0].data, {
    requesterName: "Acme Inc",
    documents: [
      {
        sourceDocumentId: "doc_1",
        name: "NDA.pdf",
        recipients: [
          { email: "a@example.com", name: "A", role: "Signer", reminderIntervalDays: 3, reminderAttempts: 2 },
          { email: "b@example.com", name: "B", reminderIntervalDays: 0, reminderAttempts: 2 },
        ],
      },
      {
        sourceDocumentId: "doc_2",
        name: "Annex.pdf",
        recipients: [
          { email: "c@example.com", name: "C", reminderIntervalDays: 3, reminderAttempts: 2 },
        ],
      },
    ],
    metadata: { dealId: "42" },
  });
  assert.deepEqual(result, { id: "env_1" });
  assert.match(exports.$summary, /env_1/);
});

test("create-envelope accepts a single JSON array string for recipients", async () => {
  const { calls, methods } = stub("createEnvelope", { id: "env_1" });
  const ctx = buildContext(createEnvelope, {
    requesterName: "Acme Inc",
    sourceDocumentId: "doc_1",
    documentName: "NDA.pdf",
    recipients: "[{\"email\":\"a@example.com\",\"name\":\"A\"}]",
  }, methods);
  await createEnvelope.run.call(ctx, buildStep());
  assert.deepEqual(calls[0].data.documents[0].recipients, [
    { email: "a@example.com", name: "A" },
  ]);
});

test("create-envelope rejects recipients missing email or name", async () => {
  const ctx = buildContext(createEnvelope, {
    requesterName: "Acme Inc",
    sourceDocumentId: "doc_1",
    documentName: "NDA.pdf",
    recipients: ["{\"email\":\"a@example.com\"}"],
  }, stub("createEnvelope").methods);
  await assert.rejects(() => createEnvelope.run.call(ctx, buildStep()), /email.*name/);
});

test("create-envelope rejects an empty recipient list", async () => {
  const ctx = buildContext(createEnvelope, {
    requesterName: "Acme Inc",
    sourceDocumentId: "doc_1",
    documentName: "NDA.pdf",
    recipients: [],
  }, stub("createEnvelope").methods);
  await assert.rejects(() => createEnvelope.run.call(ctx, buildStep()), /at least one recipient/);
});

test("send-envelope and get-envelope pass the envelope id through", async () => {
  const send = stub("sendEnvelope", { id: "env_1", status: "in_progress" });
  await sendEnvelope.run.call(buildContext(sendEnvelope, { envelopeId: "env_1" }, send.methods), buildStep());
  assert.equal(send.calls[0].envelopeId, "env_1");

  const get = stub("getEnvelope", { id: "env_1", status: "completed" });
  const result = await getEnvelope.run.call(buildContext(getEnvelope, { envelopeId: "env_1" }, get.methods), buildStep());
  assert.equal(get.calls[0].envelopeId, "env_1");
  assert.equal(result.status, "completed");
});
