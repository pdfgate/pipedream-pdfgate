import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import envelopeSent from "../sources/envelope-sent-instant/envelope-sent-instant.mjs";
import envelopeCompleted from "../sources/envelope-completed-instant/envelope-completed-instant.mjs";
import {
  buildContext, fakeDb, fakeHttp,
} from "./helpers.mjs";

const SOURCES = [
  envelopeSent,
  envelopeCompleted,
];

const sign = (secret, timestamp, payload) =>
  createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");

const buildSource = (source, { db = fakeDb(), http = fakeHttp(), appMethods = {} } = {}) => {
  const emitted = [];
  const ctx = buildContext(source, {
    db,
    http,
    $emit: (data, meta) => emitted.push({ data, meta }),
  }, appMethods);
  return { ctx, db, http, emitted };
};

const signedEvent = (secret, body) => {
  const bodyRaw = JSON.stringify(body);
  const now = Math.floor(Date.now() / 1000);
  return {
    body,
    bodyRaw,
    headers: { "x-pdfgate-signature": `t=${now},v1=${sign(secret, now, bodyRaw)}` },
  };
};

test("every source has the required registry metadata and a sample event", () => {
  for (const source of SOURCES) {
    assert.equal(source.type, "source", `${source.name} type`);
    assert.match(source.key, /^pdfgate-[a-z-]+-instant$/, `${source.name} key`);
    assert.match(source.name, /^New /, `${source.name} starts with New`);
    assert.match(source.version, /^\d+\.\d+\.\d+$/, `${source.name} version`);
    assert.equal(source.dedupe, "unique");
    assert.ok(source.props.app && source.props.db && source.props.http, `${source.name} props`);
    assert.equal(source.props.http.customResponse, true);
    assert.equal(source.sampleEmit.event, source.methods.getEventType());
  }
});

test("activate registers a webhook for the source's event and stores id + secret", async () => {
  const calls = [];
  const { ctx, db } = buildSource(envelopeSent, {
    appMethods: {
      createWebhook: (opts) => {
        calls.push(opts);
        return Promise.resolve({ id: "wh_1", secret: "whsec_1" });
      },
    },
  });

  await envelopeSent.hooks.activate.call(ctx);

  assert.deepEqual(calls[0].data, {
    url: "https://eo.m.pipedream.net/hook",
    eventTypes: ["envelope.sent"],
  });
  assert.equal(db.get("webhookId"), "wh_1");
  assert.equal(db.get("webhookSecret"), "whsec_1");
});

test("activate fails when PDFGate returns no signing secret", async () => {
  const { ctx, db } = buildSource(envelopeSent, {
    appMethods: {
      createWebhook: () => Promise.resolve({ id: "wh_1" }),
    },
  });
  await assert.rejects(() => envelopeSent.hooks.activate.call(ctx), /signing secret/);
  assert.equal(db.get("webhookId"), undefined);
});

test("deactivate deletes the webhook and clears state", async () => {
  const calls = [];
  const { ctx, db } = buildSource(envelopeCompleted, {
    db: fakeDb({ webhookId: "wh_1", webhookSecret: "whsec_1" }),
    appMethods: {
      deleteWebhook: (opts) => {
        calls.push(opts);
        return Promise.resolve();
      },
    },
  });

  await envelopeCompleted.hooks.deactivate.call(ctx);

  assert.equal(calls[0].webhookId, "wh_1");
  assert.equal(db.get("webhookId"), null);
  assert.equal(db.get("webhookSecret"), null);
});

test("deactivate treats a 404 as already deleted and clears state", async () => {
  const { ctx, db } = buildSource(envelopeCompleted, {
    db: fakeDb({ webhookId: "wh_1", webhookSecret: "whsec_1" }),
    appMethods: {
      deleteWebhook: () => Promise.reject(Object.assign(new Error("gone"), { response: { status: 404 } })),
    },
  });
  await envelopeCompleted.hooks.deactivate.call(ctx);
  assert.equal(db.get("webhookId"), null);
  assert.equal(db.get("webhookSecret"), null);
});

test("deactivate keeps the stored id and rethrows on other failures", async () => {
  const { ctx, db } = buildSource(envelopeCompleted, {
    db: fakeDb({ webhookId: "wh_1", webhookSecret: "whsec_1" }),
    appMethods: {
      deleteWebhook: () => Promise.reject(Object.assign(new Error("boom"), { response: { status: 500 } })),
    },
  });
  await assert.rejects(() => envelopeCompleted.hooks.deactivate.call(ctx), /boom/);
  assert.equal(db.get("webhookId"), "wh_1");
  assert.equal(db.get("webhookSecret"), "whsec_1");
});

test("deactivate is a no-op when no webhook was registered", async () => {
  let called = false;
  const { ctx } = buildSource(envelopeCompleted, {
    appMethods: {
      deleteWebhook: () => {
        called = true;
        return Promise.resolve();
      },
    },
  });
  await envelopeCompleted.hooks.deactivate.call(ctx);
  assert.equal(called, false);
});

test("run emits a correctly signed event of the matching type", async () => {
  const secret = "whsec_1";
  const body = envelopeCompleted.sampleEmit;
  const { ctx, http, emitted } = buildSource(envelopeCompleted, {
    db: fakeDb({ webhookId: "wh_1", webhookSecret: secret }),
  });

  const event = signedEvent(secret, body);
  // header name case must not matter
  event.headers = { "X-PDFGate-Signature": event.headers["x-pdfgate-signature"] };
  await envelopeCompleted.run.call(ctx, event);

  assert.deepEqual(http.responses, [{ status: 200, body: "OK" }]);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].data, body);
  assert.equal(emitted[0].meta.id, body.eventId);
  assert.equal(emitted[0].meta.ts, Date.parse(body.timestamp));
  assert.match(emitted[0].meta.summary, /envelope\.completed: envelope 6a12d80d8ce4ed8f2d3e5b86/);
});

test("run responds 401 and emits nothing on an invalid signature", async () => {
  const body = envelopeSent.sampleEmit;
  const { ctx, http, emitted } = buildSource(envelopeSent, {
    db: fakeDb({ webhookId: "wh_1", webhookSecret: "whsec_1" }),
  });

  await envelopeSent.run.call(ctx, {
    body,
    bodyRaw: JSON.stringify(body),
    headers: { "x-pdfgate-signature": "t=1,v1=bad" },
  });

  assert.equal(http.responses[0].status, 401);
  assert.equal(emitted.length, 0);
});

test("run fails closed when no secret is stored", async () => {
  const body = envelopeSent.sampleEmit;
  const { ctx, http, emitted } = buildSource(envelopeSent);

  await envelopeSent.run.call(ctx, signedEvent("whsec_1", body));

  assert.equal(http.responses[0].status, 401);
  assert.equal(emitted.length, 0);
});

test("run ignores signed events of a different type", async () => {
  const secret = "whsec_1";
  const body = envelopeCompleted.sampleEmit;
  const { ctx, http, emitted } = buildSource(envelopeSent, {
    db: fakeDb({ webhookId: "wh_1", webhookSecret: secret }),
  });

  await envelopeSent.run.call(ctx, signedEvent(secret, body));

  assert.deepEqual(http.responses, [{ status: 200, body: "OK" }]);
  assert.equal(emitted.length, 0);
});

test("run falls back to a synthetic id when the event has no eventId", async () => {
  const secret = "whsec_1";
  const body = { ...envelopeSent.sampleEmit };
  delete body.eventId;
  const { ctx, emitted } = buildSource(envelopeSent, {
    db: fakeDb({ webhookId: "wh_1", webhookSecret: secret }),
  });

  await envelopeSent.run.call(ctx, signedEvent(secret, body));

  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].meta.id, `envelope.sent-${body.resource.id}-${body.timestamp}`);
});
