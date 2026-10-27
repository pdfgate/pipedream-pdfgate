import {
  before, test,
} from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { buildStandalone } from "../scripts/build-standalone.mjs";
import {
  fakeDb, fakeHttp,
} from "./helpers.mjs";

// Built into the repo's git-ignored dist-standalone/ (the default) so that the
// generated files can resolve @pipedream/platform from node_modules when imported.
let files;

before(async () => {
  files = await buildStandalone();
});

const load = async (relative) => {
  const file = files.find((f) => f.endsWith(relative));
  assert.ok(file, `built file ${relative}`);
  const { default: component } = await import(pathToFileURL(file));
  return {
    component,
    src: await readFile(file, "utf8"),
  };
};

test("builds one file per action and source", () => {
  assert.equal(files.length, 14);
});

test("generated files are self-contained and never reference the app prop", async () => {
  for (const file of files) {
    const src = await readFile(file, "utf8");
    assert.doesNotMatch(src, /from "\.\.?\//, `${file} has a relative import`);
    assert.doesNotMatch(src, /this\.app\./, `${file} still uses this.app`);
    assert.doesNotMatch(src, /propDefinition: \[/, `${file} still has a propDefinition reference`);
    assert.match(src, /api_key: this\.apiKey/, `${file} binds the apiKey prop`);
  }
});

test("actions take a secret apiKey prop with inlined prop definitions", async () => {
  const { component } = await load("actions/compress-pdf/compress-pdf.mjs");
  assert.equal(component.key, "pdfgate_standalone-compress-pdf");
  assert.equal(component.name, "Compress PDF (Standalone)");
  assert.equal(component.props.app, undefined);
  assert.equal(component.props.apiKey.type, "string");
  assert.equal(component.props.apiKey.secret, true);
  assert.equal(component.props.documentId.type, "string");
  assert.equal(component.props.metadata.type, "object");
  assert.equal(component.props.metadata.optional, true);
  assert.equal(component.props.preSignedUrlExpiresIn.max, 86400);
});

test("getApp binds the real app methods to the apiKey prop", async () => {
  const { component } = await load("actions/get-document/get-document.mjs");
  const sandbox = component.methods.getApp.call({
    apiKey: "test_abc",
  });
  assert.equal(sandbox._baseUrl(), "https://api-sandbox.pdfgate.com");
  const live = component.methods.getApp.call({
    apiKey: "live_abc",
  });
  assert.equal(live._baseUrl(), "https://api.pdfgate.com");
  assert.equal(typeof sandbox.verifyWebhookSignature, "function");
});

test("standalone actions run end to end against a stubbed app", async () => {
  const { component } = await load("actions/generate-pdf/generate-pdf.mjs");
  const calls = [];
  const exports = {};
  const ctx = {
    ...component.methods,
    apiKey: "test_abc",
    html: "<p>hello</p>",
    marginTop: "1cm",
    getApp: () => ({
      generatePdf: (opts) => {
        calls.push(opts);
        return Promise.resolve({
          id: "doc_1",
        });
      },
    }),
  };
  const result = await component.run.call(ctx, {
    $: {
      export: (k, v) => {
        exports[k] = v;
      },
    },
  });
  assert.deepEqual(calls[0].data, {
    jsonResponse: true,
    html: "<p>hello</p>",
    margin: {
      top: "1cm",
    },
  });
  assert.deepEqual(result, {
    id: "doc_1",
  });
  assert.match(exports.$summary, /doc_1/);
});

test("standalone sources keep hooks, signature check and sample events", async () => {
  const { component } = await load("sources/envelope-completed-instant/envelope-completed-instant.mjs");
  assert.equal(component.key, "pdfgate_standalone-envelope-completed-instant");
  assert.equal(component.props.app, undefined);
  assert.equal(component.props.apiKey.secret, true);
  assert.equal(component.props.http.customResponse, true);
  assert.equal(component.sampleEmit.event, "envelope.completed");

  const calls = [];
  const db = fakeDb();
  const http = fakeHttp();
  const emitted = [];
  const ctx = {
    ...component.methods,
    apiKey: "test_abc",
    db,
    http,
    $emit: (data, meta) => emitted.push({
      data,
      meta,
    }),
    getApp: () => ({
      createWebhook: (opts) => {
        calls.push(opts);
        return Promise.resolve({
          id: "wh_1",
          secret: "whsec_1",
        });
      },
      verifyWebhookSignature: () => true,
    }),
  };

  await component.hooks.activate.call(ctx);
  assert.deepEqual(calls[0].data, {
    url: http.endpoint,
    eventTypes: [
      "envelope.completed",
    ],
  });
  assert.equal(db.get("webhookId"), "wh_1");

  await component.run.call(ctx, {
    body: component.sampleEmit,
    headers: {},
  });
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].meta.id, component.sampleEmit.eventId);
});
