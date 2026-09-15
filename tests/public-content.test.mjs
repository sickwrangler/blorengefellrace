import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("route guide presents the requested seven photographed stages", () => {
  const html = fs.readFileSync("route.html", "utf8");
  assert.equal((html.match(/class="route-step"/g) ?? []).length, 7);
  for (const label of ["The start", "The tunnel", "The incline", "The scramble", "The trig", "The muddy descent", "The final decline"]) {
    assert.ok(html.includes(label), `missing route stage: ${label}`);
  }
  for (const photo of ["route-start", "route-tunnel", "route-tramroad", "route-ascent", "route-trig", "route-muddy-descent", "route-finish"]) {
    assert.ok(html.includes(`data-photo-id="${photo}"`), `missing route photograph: ${photo}`);
  }
  assert.ok(html.includes('class="route-intro__image" src="images/generated/photos/route-steep-climb.jpg"'));
  assert.match(html, /The incline[\s\S]*?data-photo-id="route-tramroad"/);
  assert.match(html, /The scramble[\s\S]*?data-photo-id="route-ascent"/);
  assert.match(html, /The muddy descent[\s\S]*?data-photo-id="route-muddy-descent"/);
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
    assert.ok(html.includes('class="tabs"'), `${file} has no Information tab navigation`);
    assert.ok(html.includes('href="info.html#travel"'));
    assert.ok(html.includes('href="info.html#kit"'));
    assert.ok(html.includes('href="recce.html"'));
    assert.ok(html.includes('href="kit-swap.html"'));
    assert.ok(html.includes('href="info.html#race-report"'));
    assert.ok(html.includes('href="info.html#stats"'));
  }
});

test("shared navigation uses equal-height link boxes without active-border movement", () => {
  const css = fs.readFileSync("components/navbar/navbar.css", "utf8");
  assert.match(css, /--nav-item-height:2\.75rem/);
  assert.match(css, /\.nav-links li \{[^}]*height:var\(--nav-item-height\)/);
  assert.match(css, /\.nav-links a \{[^}]*height:100%[^}]*border:0/);
  assert.match(css, /\.nav-links a::after \{[^}]*position:absolute[^}]*height:\.2rem/);
  assert.match(css, /\.nav-links \.nav-enter::after \{[^}]*display:none/);
  assert.match(css, /--nav-item-height-mobile:3\.35rem/);
});

test("Recce and Kit Swap use the restrained responsive content-image layout", () => {
  const css = fs.readFileSync("style.css", "utf8");
  assert.match(css, /\.managed-image--content \{[^}]*width:\s*min\(100%, var\(--reading-width\)\)[^}]*justify-self:\s*start/);
  assert.match(css, /\.managed-image--content img \{[^}]*aspect-ratio:\s*3 \/ 2[^}]*object-fit:\s*cover/);
  for (const file of ["recce.html", "kit-swap.html"]) {
    const html = fs.readFileSync(file, "utf8");
    assert.match(html, /class="managed-image managed-image--content"/, file);
    assert.doesNotMatch(html, /class="managed-image managed-image--hero"/, file);
  }
});
