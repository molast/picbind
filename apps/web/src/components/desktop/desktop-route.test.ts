import assert from "node:assert/strict";
import test from "node:test";
import { getDesktopRoute, retainDesktopRoute } from "./desktop-route";

test("classifies the persistent desktop routes", () => {
  assert.equal(getDesktopRoute("/"), "home");
  assert.equal(getDesktopRoute("/favicon-converter"), "favicon");
  assert.equal(getDesktopRoute("/favicon-generator"), "favicon");
  assert.equal(getDesktopRoute("/workspace"), "workspace");
  assert.equal(getDesktopRoute("/admin"), null);
});

test("retains every route that has been mounted", () => {
  const home = retainDesktopRoute(new Set(), "home");
  const withWorkspace = retainDesktopRoute(home, "workspace");
  const withFavicon = retainDesktopRoute(withWorkspace, "favicon");

  assert.deepEqual([...withFavicon], ["home", "workspace", "favicon"]);
  assert.equal(retainDesktopRoute(withFavicon, "home"), withFavicon);
});
