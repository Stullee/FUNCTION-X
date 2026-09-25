// Clicks through the panel preview and checks that actions reach Home Assistant.
// Usage: node dev/smoke.mjs   (serve the repo root on :8765 first)
import { chromium } from "playwright";

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || undefined,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://localhost:8765/frontend/dev/index.html");
await page.waitForTimeout(2500);
const $ = (fn, arg) => page.evaluate(fn, arg);
const failures = [];
const check = (name, ok) => (ok ? console.log(`ok   ${name}`) : (failures.push(name), console.log(`FAIL ${name}`)));

// A real mouse click on the upper storey of the 3D house opens that level.
const point = await $(() => {
  const scene = window.__panel._scene;
  const level = scene.levels[1];
  const v = level.hit.getWorldPosition(level.hit.position.clone());
  v.project(scene.camera);
  const rect = scene.renderer.domElement.getBoundingClientRect();
  return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
});
await page.mouse.click(point.x, point.y);
await page.waitForTimeout(300);
check("3D click on upper storey opens First floor", await $(() => window.__panel.shadowRoot.querySelector(".title")?.textContent === "First floor"));

// Room view: toggle a light and change a thermostat.
await $(() => window.__panel.shadowRoot.querySelector('[data-action="room"][data-room="bedroom"]').click());
await page.waitForTimeout(300);
await $(() => window.__panel.shadowRoot.querySelector('[data-action="toggle"][data-entity="light.bedroom"]').click());
await page.waitForTimeout(300);
check("light toggle calls light.toggle", await $(() => JSON.stringify(window.__mock.calls.at(-1)) === JSON.stringify({ domain: "light", service: "toggle", data: { entity_id: "light.bedroom" } })));
check("light switch reflects new state", await $(() => window.__panel.shadowRoot.querySelector('[data-entity="light.bedroom"]').getAttribute("aria-checked") === "false"));
check("3D window goes dark", await $(() => window.__panel._scene.levels[1].rooms[0].lit === false));
await $(() => window.__panel.shadowRoot.querySelector('[data-action="temp"][data-delta="0.5"][data-entity="climate.bedroom"]').click());
await page.waitForTimeout(200);
check("thermostat + sets 19 °C", await $(() => window.__mock.calls.at(-1).data.temperature === 19));

// Orchestration switch.
await $(() => window.__panel.shadowRoot.querySelector('[data-action="overview"]').click());
await page.waitForTimeout(200);
await $(() => window.__panel.shadowRoot.querySelector('[data-action="orchestration"]').click());
await page.waitForTimeout(200);
check("orchestration switch turns on", await $(() => window.__mock.hass.states["switch.function_x_demo_orchestration"].state === "on"));

// Live values flow into the scene: car unplugs, battery discharges.
await $(() => window.__mock.setValue("sensor.function_x_demo_demo_car_charging_power", 0, { connected: false, charging: false }));
await $(() => window.__mock.setValue("sensor.function_x_demo_battery_power", 900));
await page.waitForTimeout(300);
check("car hidden when unplugged", await $(() => window.__panel._scene.cars[0].body.visible === false));
check("battery flow reverses when discharging", await $(() => window.__panel._scene.flows.battery.direction === -1));

// Setup guide: add a level with a room and save.
await $(() => window.__panel.shadowRoot.querySelector('[data-action="wizard"]').click());
await page.waitForTimeout(200);
await $(() => window.__panel.shadowRoot.querySelector('[data-action="add-floor"]').click());
const newFloorKey = await $(() => window.__panel._wizard.floors.at(-1).key);
await $((key) => window.__panel.shadowRoot.querySelector(`[data-action="add-room"][data-floor="${key}"]`).click(), newFloorKey);
await page.keyboard.type("Attic studio");
await page.waitForTimeout(400);
check("3D preview grows a third level", await $(() => window.__panel._scene.levels.length === 3));
await $(() => window.__panel.shadowRoot.querySelector('[data-action="wizard-next"]').click());
await $(() => window.__panel.shadowRoot.querySelector('[data-action="wizard-save"]').click());
await page.waitForTimeout(500);
const save = await $(() => window.__mock.calls.find((c) => c.type === "function_x/house/save"));
check("save sends three levels", save?.floors.length === 3);
check("new room is included", save?.floors.some((f) => f.rooms.some((r) => r.name === "Attic studio")));
check("guide moves on to devices", await $(() => window.__panel._wizard?.step === 2));
await $(() => {
  const select = window.__panel.shadowRoot.querySelector('select[data-entity="light.garden"]');
  select.value = select.querySelector("option[value]:not([value=''])").value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
});
await page.waitForTimeout(400);
check("assigning a device calls function_x/assign", await $(() => window.__mock.calls.some((c) => c.type === "function_x/assign" && c.entity_id === "light.garden")));
await $(() => window.__panel.shadowRoot.querySelector('[data-action="wizard-done"]').click());
await page.waitForTimeout(300);
check("house shows three levels after setup", await $(() => window.__panel._scene.levels.length === 3));

await browser.close();
if (errors.length) console.log(`page errors:\n${errors.join("\n")}`);
process.exit(failures.length || errors.length ? 1 : 0);
