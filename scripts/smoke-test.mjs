#!/usr/bin/env node
/**
 * Sandbox smoke test: runs the REAL components (not the standalone build) against the
 * PDFGate API exactly as Pipedream would, with a stubbed step object.
 *
 *   PDFGATE_API_KEY=test_... node scripts/smoke-test.mjs [--send] [--email you@example.com]
 *
 * Steps (each one feeds the next):
 *   generate-pdf → get-document → upload-file → compress/flatten/protect/watermark →
 *   generate-pdf (form) → extract-form-data → create-envelope → get-envelope →
 *   [send-envelope with --send] → trigger activate/deactivate (webhook create/delete) →
 *   delete-document cleanup.
 *
 * Use a `test_` key so nothing is billed. Exit code is non-zero if any step fails.
 */
import app from "../pdfgate.app.mjs";
import generatePdf from "../actions/generate-pdf/generate-pdf.mjs";
import getDocument from "../actions/get-document/get-document.mjs";
import uploadFile from "../actions/upload-file/upload-file.mjs";
import compressPdf from "../actions/compress-pdf/compress-pdf.mjs";
import flattenPdf from "../actions/flatten-pdf/flatten-pdf.mjs";
import protectPdf from "../actions/protect-pdf/protect-pdf.mjs";
import watermarkPdf from "../actions/watermark-pdf/watermark-pdf.mjs";
import extractFormData from "../actions/extract-form-data/extract-form-data.mjs";
import createEnvelope from "../actions/create-envelope/create-envelope.mjs";
import getEnvelope from "../actions/get-envelope/get-envelope.mjs";
import sendEnvelope from "../actions/send-envelope/send-envelope.mjs";
import deleteDocument from "../actions/delete-document/delete-document.mjs";
import envelopeCompleted from "../sources/envelope-completed-instant/envelope-completed-instant.mjs";

const apiKey = process.env.PDFGATE_API_KEY;
if (!apiKey) {
  console.error("Set PDFGATE_API_KEY (use a test_ key for the sandbox).");
  process.exit(2);
}

const args = process.argv.slice(2);
const shouldSend = args.includes("--send");
const emailIdx = args.indexOf("--email");
const recipientEmail = emailIdx !== -1
  ? args[emailIdx + 1]
  : process.env.PDFGATE_TEST_EMAIL ?? "recipient@example.com";

const realApp = {
  $auth: {
    api_key: apiKey,
  },
  ...app.methods,
};

const results = [];
const createdDocumentIds = [];

const step = () => {
  const exports = {};
  return {
    $: {
      export: (key, value) => {
        exports[key] = value;
      },
    },
    exports,
  };
};

async function run(label, component, props, { optional = false } = {}) {
  const started = Date.now();
  const { $, exports } = step();
  const ctx = {
    ...(component.methods ?? {}),
    app: realApp,
    ...props,
  };
  try {
    const result = await component.run.call(ctx, {
      $,
    });
    const ms = Date.now() - started;
    results.push({
      label,
      ok: true,
      ms,
      summary: exports.$summary,
    });
    console.log(`✔ ${label} (${ms} ms) — ${exports.$summary ?? ""}`);
    return result;
  } catch (error) {
    const ms = Date.now() - started;
    const detail = error?.response?.data
      ? JSON.stringify(error.response.data)
      : error?.message ?? String(error);
    results.push({
      label,
      ok: !optional
        ? false
        : "skipped",
      ms,
      summary: detail,
    });
    console.log(`${optional
      ? "–"
      : "✖"} ${label} (${ms} ms) — ${detail}`);
    if (!optional) {
      return undefined;
    }
    return undefined;
  }
}

console.log(`Target: ${realApp._baseUrl()}\n`);

// 1. Generate a simple PDF from HTML
const generated = await run("generate-pdf (html)", generatePdf, {
  html: "<html><body><h1>PDFGate Pipedream smoke test</h1><p>Generated at " + new Date().toISOString() + "</p></body></html>",
  pageSizeType: "a4",
  marginTop: "1cm",
  marginBottom: "1cm",
  printBackground: true,
  preSignedUrlExpiresIn: 600,
  metadata: {
    source: "pipedream-smoke-test",
  },
});
if (generated?.id) createdDocumentIds.push(generated.id);

// 2. Get it back
if (generated?.id) {
  await run("get-document", getDocument, {
    documentId: generated.id,
    preSignedUrlExpiresIn: 120,
  });
}

// 3. Upload the generated file from its pre-signed URL
let uploaded;
if (generated?.fileUrl) {
  uploaded = await run("upload-file (from fileUrl)", uploadFile, {
    url: generated.fileUrl,
    metadata: {
      source: "pipedream-smoke-test",
    },
  });
  if (uploaded?.id) createdDocumentIds.push(uploaded.id);
} else {
  console.log("– upload-file skipped: generate-pdf returned no fileUrl");
}

// 4. Processing operations on the uploaded document
const sourceId = uploaded?.id ?? generated?.id;
if (sourceId) {
  const compressed = await run("compress-pdf", compressPdf, {
    documentId: sourceId,
    linearize: true,
  });
  if (compressed?.id) createdDocumentIds.push(compressed.id);

  const flattened = await run("flatten-pdf", flattenPdf, {
    documentId: sourceId,
  });
  if (flattened?.id) createdDocumentIds.push(flattened.id);

  const protectedDoc = await run("protect-pdf", protectPdf, {
    documentId: sourceId,
    algorithm: "AES256",
    userPassword: "open-me",
    ownerPassword: "owner-me",
    disablePrint: true,
  });
  if (protectedDoc?.id) createdDocumentIds.push(protectedDoc.id);

  const watermarked = await run("watermark-pdf", watermarkPdf, {
    documentId: sourceId,
    text: "SMOKE TEST",
    fontSize: 48,
    fontColor: "#FF0000",
    font: "helvetica-bold",
    opacity: "0.3",
    rotate: "45",
  });
  if (watermarked?.id) createdDocumentIds.push(watermarked.id);
}

// 5. Fillable form (with a signature field so it can also back an envelope) → extract its data
const formDoc = await run("generate-pdf (form fields)", generatePdf, {
  html: "<html><body><form>"
    + "<label>Name <input type=\"text\" name=\"fullName\" value=\"Jane Doe\"></label>"
    + "<label>Agree <input type=\"checkbox\" name=\"agree\" checked></label>"
    + "<p>Signature: <pdfgate-signature-field name=\"signature\" style=\"display:inline-block;width:200px;height:60px;border:1px solid #000\"></pdfgate-signature-field></p>"
    + "</form></body></html>",
  enableFormFields: true,
});
if (formDoc?.id) {
  createdDocumentIds.push(formDoc.id);
  const data = await run("extract-form-data", extractFormData, {
    documentId: formDoc.id,
  });
  if (data) console.log("   extracted:", JSON.stringify(data));
}

// 6. Envelope lifecycle (the source document must contain at least one field)
let envelope;
if (formDoc?.id) {
  envelope = await run("create-envelope", createEnvelope, {
    requesterName: "Pipedream Smoke Test",
    sourceDocumentId: formDoc.id,
    documentName: "Smoke Test Agreement.pdf",
    recipients: [
      {
        email: recipientEmail,
        name: "Smoke Test Recipient",
        // no `role`: the document's fields carry no pdfgate-role attribute, so the single
        // recipient gets every field
      },
    ],
    reminderIntervalDays: 0,
    metadata: {
      source: "pipedream-smoke-test",
    },
  });
  if (envelope?.id) {
    await run("get-envelope", getEnvelope, {
      envelopeId: envelope.id,
    });
    if (shouldSend) {
      await run("send-envelope", sendEnvelope, {
        envelopeId: envelope.id,
      });
    } else {
      console.log("– send-envelope skipped (pass --send --email you@example.com to email a real signing link)");
    }
  }
}

// 7. Trigger hooks: register and remove a webhook like a deployed source would
{
  const store = {};
  const ctx = {
    ...envelopeCompleted.methods,
    app: realApp,
    db: {
      get: (k) => store[k],
      set: (k, v) => {
        store[k] = v;
      },
    },
    http: {
      endpoint: "https://example.pipedream.net/pdfgate-smoke-test",
    },
  };
  const started = Date.now();
  try {
    await envelopeCompleted.hooks.activate.call(ctx);
    if (!store.webhookId || !store.webhookSecret) {
      throw new Error("activate() did not store webhookId/webhookSecret");
    }
    await envelopeCompleted.hooks.deactivate.call(ctx);
    results.push({
      label: "trigger activate/deactivate (webhook create+delete)",
      ok: true,
      ms: Date.now() - started,
    });
    console.log(`✔ trigger activate/deactivate (webhook create+delete) (${Date.now() - started} ms)`);
  } catch (error) {
    const detail = error?.response?.data
      ? JSON.stringify(error.response.data)
      : error?.message;
    results.push({
      label: "trigger activate/deactivate (webhook create+delete)",
      ok: false,
      ms: Date.now() - started,
      summary: detail,
    });
    console.log(`✖ trigger activate/deactivate — ${detail}`);
  }
}

// 8. Cleanup: delete every document we created (documents used by an envelope may be refused)
for (const documentId of createdDocumentIds) {
  await run(`delete-document ${documentId}`, deleteDocument, {
    documentId,
  }, {
    optional: true,
  });
}

const failed = results.filter((r) => r.ok === false);
console.log(`\n${results.length - failed.length}/${results.length} steps passed${failed.length
  ? `, ${failed.length} failed`
  : ""}`);
process.exit(failed.length
  ? 1
  : 0);
