import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("route guide presents the requested seven photographed stages", () => {
  const html = fs.readFileSync("route.html", "utf8");
  assert.equal((html.match(/class="route-step"/g) ?? []).length, 7);
  for (const label of ["The start", "The tunnel", "The incline", "The scramble", "The trig", "The muddy descent", "The final decline"]) {
    assert.ok(html.includes(label), `missing route stage: ${label}`);
  }
  for (const photo of ["route-start", "route-tunnel", "route-steep-climb", "route-tramroad", "route-trig", "route-muddy-descent", "route-finish"]) {
    assert.ok(html.includes(`data-photo-id="${photo}"`), `missing route photograph: ${photo}`);
  }
  assert.equal(html.includes("route-character"), false);
  assert.equal(html.includes("Course character"), false);
});

test("Recce and Kit Swap are Information sub-pages rather than primary links", () => {
  const navigation = fs.readFileSync("components/navbar/navbar.html", "utf8");
  assert.equal(navigation.includes('href="/recce.html"'), false);
  assert.equal(navigation.includes('href="/kit-swap.html"'), false);
  assert.ok(navigation.includes('class="nav-enter"'));

  for (const file of ["info.html", "recce.html", "kit-swap.html"]) {
    const html = fs.readFileSync(file, "utf8");
    assert.ok(html.includes('class="info-area-tabs"'), `${file} has no Information sub-navigation`);
    assert.ok(html.includes('href="recce.html"'));
    assert.ok(html.includes('href="kit-swap.html"'));
  }
});
