import app from "../pdfgate.app.mjs";

/**
 * Build a `this` context for running a component outside Pipedream.
 * `appMethods` override individual PDFGate app methods (e.g. generatePdf) with stubs.
 * All other app methods keep their real implementation, bound to a fake `$auth`.
 */
export function buildContext(component, props = {}, appMethods = {}, apiKey = "test_key") {
  const fakeApp = {
    $auth: {
      api_key: apiKey,
    },
    ...app.methods,
    ...appMethods,
  };
  return {
    ...(component.methods ?? {}),
    app: fakeApp,
    ...props,
  };
}

export function buildStep() {
  const exports = {};
  return {
    $: {
      export: (key, value) => {
        exports[key] = value;
      },
    },
    exports,
  };
}

export function fakeDb(initial = {}) {
  const store = {
    ...initial,
  };
  return {
    get: (key) => store[key],
    set: (key, value) => {
      store[key] = value;
    },
    store,
  };
}

export function fakeHttp(endpoint = "https://eo.m.pipedream.net/hook") {
  const responses = [];
  return {
    endpoint,
    respond: (response) => responses.push(response),
    responses,
  };
}
