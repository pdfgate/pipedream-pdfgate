# Development notes

This repository holds the PDFGate components for [Pipedream](https://pipedream.com). It mirrors the
layout Pipedream expects under `components/pdfgate/` in the
[PipedreamHQ/pipedream](https://github.com/PipedreamHQ/pipedream) monorepo, so the whole directory can
be copied there verbatim when the integration is submitted.

```
pdfgate.app.mjs                 app definition: auth, base URL selection, request helpers,
                                webhook signature verification
common/constants.mjs            base URLs, option lists, timeouts, event types
common/utils.mjs                JSON prop parsing and request-body helpers
actions/<slug>/<slug>.mjs       one action per folder (key: pdfgate-<slug>)
sources/common/webhook.mjs      shared webhook source: activate/deactivate hooks, signature check, emit
sources/<slug>/<slug>.mjs       one instant source per folder (key: pdfgate-<slug>)
sources/<slug>/test-event.mjs   sample payload shown in the Pipedream UI before a real event arrives
test/                           node:test unit tests (no Pipedream runtime needed)
README.md                       the registry README (Overview / Example Use Cases / Getting Started / Troubleshooting)
```

## Feature parity

The component set matches the n8n node and the Zapier integration:

| Capability | Component |
| --- | --- |
| Generate PDF (`POST /v1/generate/pdf`) | `actions/generate-pdf` |
| Upload File (`POST /upload`) | `actions/upload-file` |
| Get Document (`GET /document/{id}`) | `actions/get-document` |
| Delete Document (`DELETE /document/{id}`) | `actions/delete-document` |
| Compress PDF (`POST /compress/pdf`) | `actions/compress-pdf` |
| Flatten PDF (`POST /forms/flatten`, incl. `fieldNames`) | `actions/flatten-pdf` |
| Extract Form Data (`POST /forms/extract-data`) | `actions/extract-form-data` |
| Protect PDF (`POST /protect/pdf`) | `actions/protect-pdf` |
| Watermark PDF (`POST /watermark/pdf`, text only) | `actions/watermark-pdf` |
| Create Envelope (`POST /envelope`) | `actions/create-envelope` |
| Send Envelope (`POST /envelope/{id}/send`) | `actions/send-envelope` |
| Get Envelope (`GET /envelope/{id}`) | `actions/get-envelope` |
| Envelope Sent webhook (`envelope.sent`) | `sources/envelope-sent-instant` |
| Envelope Completed webhook (`envelope.completed`) | `sources/envelope-completed-instant` |

Wire-format rules carried over from the other integrations:

- `jsonResponse: true` is sent on generate / compress / flatten / protect / watermark so the API returns
  a document object rather than binary. `/upload` and `/forms/extract-data` always return JSON and
  reject that flag, so it is never sent there.
- The base URL is chosen from the API key prefix (`test_` → sandbox, otherwise production).
- Webhook deliveries carry `x-pdfgate-signature: t=<unix>,v1=<hex>`; the signed payload is
  `${t}.${rawBody}` with HMAC-SHA256 over the webhook secret, with a 5 minute tolerance.

## Authentication on Pipedream

Pipedream manages app credentials. The app file reads the key from `this.$auth.api_key`, which is the
conventional field name Pipedream assigns to single-key integrations. If the Pipedream team registers
the app with a different field name, update `_apiKey()` in `pdfgate.app.mjs` and the `$auth` stub in
`test/helpers.mjs`.

## Prerequisite: the app must exist on Pipedream

Pipedream does not allow third parties to create app entries. There is currently no `pdfgate` app in
the registry, so before a components PR can be merged the Pipedream team must register the app (name,
slug `pdfgate`, API-key auth with a Bearer header, and the `GET /auth` endpoint for credential tests).
Request it by opening an issue in the monorepo with the **App / Integration Request** template
(`.github/ISSUE_TEMPLATE/app---service-integration.md`) or through Pipedream support, linking to
<https://pdfgate.com/documentation>.

## Local development

```bash
npm install
npm test        # node --test "test/**/*.test.mjs"
npm run lint    # eslint
```

Tests run the components with a stubbed `this` context (see `test/helpers.mjs`) so no Pipedream
runtime or network access is required.

### Sandbox smoke test (real API, no Pipedream needed)

`scripts/smoke-test.mjs` runs the real components against the PDFGate API with a stubbed step
object, chaining every action (generate → get → upload → compress / flatten / protect / watermark →
form generate → extract → create envelope → get envelope) plus the trigger's webhook
registration/removal, then deletes the documents it created. This is the quickest way to confirm the
request bodies and endpoints are right before publishing anything.

```bash
PDFGATE_API_KEY=test_xxx npm run smoke
# to also email a real signing link (Send Envelope):
PDFGATE_API_KEY=test_xxx npm run smoke -- --send --email you@example.com
```

## Testing on Pipedream before the app is registered

Pipedream rejects any component whose `app` prop names an unregistered slug, so the real components
cannot be published yet. `npm run build:standalone` generates a testing variant of every action and
source under `dist-standalone/` (git-ignored). Each generated file is self-contained and differs from
the real component only in how it authenticates:

- the `app` prop becomes a secret **PDFGate API Key** string prop,
- keys are prefixed `pdfgate_standalone-` and names end in "(Standalone)" so they never clash with
  the registry components later.

Everything else (request bodies, webhook registration, signature verification, sample events) is the
same code, so a passing test here is a meaningful test of the real integration.

```bash
# 1. Install the Pipedream CLI and log in with the API key from Settings → Account in Pipedream
curl https://cli.pipedream.com/install | sh
pd login

# 2. Generate the standalone components
npm run build:standalone

# 3. Publish all actions to your workspace (they appear under "My Actions" in the workflow builder)
for f in dist-standalone/actions/*/*.mjs; do pd publish "$f"; done

# 4. Deploy a trigger; the CLI prompts for the API key prop and prints the source ID and endpoint
pd deploy dist-standalone/sources/envelope-completed-instant/envelope-completed-instant.mjs
pd deploy dist-standalone/sources/envelope-sent-instant/envelope-sent-instant.mjs

# 5. Watch events and logs while you exercise it
pd events -f <source-id>
pd logs <source-id>
```

Use a `test_` key so nothing is billed. A full end-to-end run is: Generate PDF → Create Envelope with
your own email as the recipient → Send Envelope (the Envelope Sent source fires) → open the email and
sign (the Envelope Completed source fires). `pd publish --dev <file>` auto-versions each publish while
you iterate; `pd dev <file>` redeploys a source on every save.

Once Pipedream registers the app, publish the real components instead:

```bash
pd publish actions/generate-pdf/generate-pdf.mjs
pd deploy sources/envelope-completed-instant/envelope-completed-instant.mjs
```

## Submitting to the Pipedream registry

1. Fork `PipedreamHQ/pipedream` and copy this directory to `components/pdfgate/`
   (everything except `.github/`, `DEVELOPMENT.md`, `eslint.config.mjs`, `test/` and `LICENSE`).
2. Run the monorepo's linter (`pnpm lint`) from the fork root and fix any style findings; the monorepo
   enforces double quotes, trailing commas and one-array-item-per-line formatting, which this repo's
   ESLint config approximates.
3. Open a PR titled `[Components] pdfgate` describing the actions and sources, and respond to review.

## Releasing

Bump `version` in `package.json` and in every changed component before submitting an update; Pipedream
publishes components by version and ignores unchanged ones.
