// A fake `hass` object with a two-storey house, for previewing the panel
// without Home Assistant. Mirrors what function_x/house returns.

const P = "sensor.function_x_demo_";

function room(id, name, entities = [], extra = {}) {
  return { id, name, icon: null, temperature_entity: null, humidity_entity: null, entities, ...extra };
}
const ent = (entity_id, device_class = null) => ({ entity_id, domain: entity_id.split(".")[0], device_class });

function houseFixture({ configured, floors }) {
  const layout = floors
    ? [
        {
          id: "ground", name: "Ground floor", level: 0, icon: null,
          rooms: [
            room("living", "Living room", [ent("light.living_ceiling"), ent("light.living_lamp"), ent("climate.living"), ent("binary_sensor.living_window", "window")]),
            room("kitchen", "Kitchen", [ent("light.kitchen"), ent("sensor.kitchen_temperature", "temperature")]),
            room("hall", "Hallway", [ent("light.hall")]),
            room("utility", "Utility room", [ent("sensor.utility_temperature", "temperature")]),
          ],
        },
        {
          id: "first", name: "First floor", level: 1, icon: null,
          rooms: [
            room("bedroom", "Bedroom", [ent("light.bedroom"), ent("climate.bedroom")]),
            room("kids", "Kids room", [ent("light.kids")]),
            room("bath", "Bathroom", [ent("climate.bathroom"), ent("fan.bathroom")]),
          ],
        },
      ]
    : [
        { id: "demo_0", name: "Ground floor", level: 0, icon: null, synthetic: true,
          rooms: ["Living room", "Kitchen", "Hallway", "Utility room"].map((n, i) => room(`demo_0_${i}`, n, [], { synthetic: true })) },
        { id: "demo_1", name: "First floor", level: 1, icon: null, synthetic: true,
          rooms: ["Bedroom", "Kids room", "Bathroom", "Office"].map((n, i) => room(`demo_1_${i}`, n, [], { synthetic: true })) },
      ];
  return {
    entry_id: "demo-entry",
    title: "FUNCTION-X (demo)",
    demo: true,
    demo_layout: !floors,
    settings: { configured, solar: null, battery: null, heat_pump: null, cars: null },
    detected: { solar: true, battery: true, heat_pump: true, cars: 1 },
    floors: layout,
    unassigned_rooms: [room("garage", "Garage")],
    unassigned_entities: [ent("light.garden"), ent("sensor.office_temperature", "temperature"), ent("switch.coffee_machine")],
    energy: {
      has_solar: true, has_battery: true, has_heat_pump: true, cars: 1, heat_pump_switch: null,
      entities: {
        pv_power: `${P}solar_power`, grid_power: `${P}grid_power`, home_power: `${P}home_consumption`,
        surplus_power: `${P}solar_surplus`, battery_soc: `${P}battery`, battery_power: `${P}battery_power`,
        grid_price: `${P}electricity_price`, price_level: `${P}price_level`, decision: `${P}decision`,
        orchestration: "switch.function_x_demo_orchestration",
        heat_pump_boost: "binary_sensor.function_x_demo_heat_pump_boost_recommended",
      },
      loadpoints: [{ id: 1, title: "Demo car", entity_id: `${P}demo_car_charging_power` }],
    },
    entries: [{ entry_id: "demo-entry", title: "FUNCTION-X (demo)" }],
  };
}

function s(entity_id, state, attributes = {}) {
  return { entity_id, state: String(state), attributes, last_updated: new Date().toISOString() };
}

function initialStates() {
  const list = [
    s(`${P}solar_power`, 5200, { unit_of_measurement: "W", friendly_name: "Solar power" }),
    s(`${P}grid_power`, -1300, { unit_of_measurement: "W" }),
    s(`${P}home_consumption`, 3400, { unit_of_measurement: "W" }),
    s(`${P}solar_surplus`, 1300, { unit_of_measurement: "W" }),
    s(`${P}battery`, 78, { unit_of_measurement: "%" }),
    s(`${P}battery_power`, -1500, { unit_of_measurement: "W" }),
    s(`${P}electricity_price`, 0.231, { unit_of_measurement: "EUR/kWh" }),
    s(`${P}price_level`, "cheap"),
    s(`${P}demo_car_charging_power`, 3700, { unit_of_measurement: "W", connected: true, charging: true, vehicle_soc: 55, mode: "solar" }),
    s(`${P}decision`, "Heat pump: boost on", {
      orchestrating: false,
      errors: [],
      decisions: [
        { device: "Heat pump", action: "boost on", reason: "2800 W of solar would otherwise be exported" },
        { device: "Demo car", action: "keep", reason: "Already charging from solar, which is cheaper still" },
      ],
    }),
    s("switch.function_x_demo_orchestration", "off"),
    s("binary_sensor.function_x_demo_heat_pump_boost_recommended", "on"),
    s("light.living_ceiling", "on", { friendly_name: "Ceiling light" }),
    s("light.living_lamp", "on", { friendly_name: "Reading lamp" }),
    s("climate.living", "heat", { friendly_name: "Living room thermostat", temperature: 21, current_temperature: 20.4, hvac_action: "heating" }),
    s("binary_sensor.living_window", "off", { friendly_name: "Window", device_class: "window" }),
    s("light.kitchen", "off", { friendly_name: "Kitchen light" }),
    s("sensor.kitchen_temperature", 21.8, { friendly_name: "Kitchen temperature", unit_of_measurement: "°C" }),
    s("light.hall", "off", { friendly_name: "Hall light" }),
    s("sensor.utility_temperature", 18.2, { friendly_name: "Utility temperature", unit_of_measurement: "°C" }),
    s("light.bedroom", "on", { friendly_name: "Bedroom light" }),
    s("climate.bedroom", "heat", { friendly_name: "Bedroom thermostat", temperature: 18.5, current_temperature: 18.9, hvac_action: "idle" }),
    s("light.kids", "off", { friendly_name: "Kids room light" }),
    s("climate.bathroom", "heat", { friendly_name: "Bathroom radiator", temperature: 22, current_temperature: 21.1, hvac_action: "heating" }),
    s("fan.bathroom", "off", { friendly_name: "Bathroom fan" }),
    s("light.garden", "off", { friendly_name: "Garden light" }),
    s("sensor.office_temperature", 20.1, { friendly_name: "Office temperature", unit_of_measurement: "°C" }),
    s("switch.coffee_machine", "off", { friendly_name: "Coffee machine" }),
  ];
  return Object.fromEntries(list.map((x) => [x.entity_id, x]));
}

export function createMockHass({ dark = false, configured = true, floors = true } = {}) {
  let house = houseFixture({ configured, floors });
  const mock = { onChange: null, calls: [] };

  const build = (states) => ({
    states,
    language: "en",
    locale: { language: "en" },
    themes: { darkMode: dark },
    user: { is_admin: true, name: "Preview" },
    connection: { subscribeEvents: async () => () => {} },
    callWS: async (msg) => {
      mock.calls.push(msg);
      if (msg.type === "function_x/house/save") {
        house = {
          ...house,
          demo_layout: false,
          settings: { configured: true, ...msg.settings },
          energy: { ...house.energy, has_solar: msg.settings.solar, has_battery: msg.settings.battery, has_heat_pump: msg.settings.heat_pump, cars: msg.settings.cars },
          floors: [...msg.floors]
            .sort((a, b) => a.level - b.level)
            .map((f, i) => ({ id: f.id || `new_floor_${i}`, name: f.name, level: f.level, icon: null,
              rooms: f.rooms.map((r, j) => room(r.id || `new_room_${i}_${j}`, r.name)) })),
        };
      }
      if (msg.type === "function_x/assign") {
        const moved = house.unassigned_entities.find((e) => e.entity_id === msg.entity_id);
        house = { ...house, unassigned_entities: house.unassigned_entities.filter((e) => e !== moved) };
        for (const f of house.floors) for (const r of f.rooms) if (r.id === msg.area_id) r.entities.push(moved);
      }
      return structuredClone(house);
    },
    callService: async (domain, service, data) => {
      mock.calls.push({ domain, service, data });
      const id = data.entity_id;
      const current = mock.hass.states[id];
      let next = current;
      if (service === "toggle") next = { ...current, state: current.state === "on" ? "off" : "on" };
      if (service === "turn_on") next = { ...current, state: "on" };
      if (service === "turn_off") next = { ...current, state: "off" };
      if (service === "set_temperature") next = { ...current, attributes: { ...current.attributes, temperature: data.temperature } };
      mock.set(id, { ...next, last_updated: new Date().toISOString() });
    },
  });

  mock.hass = build(initialStates());
  mock.set = (id, state) => {
    mock.hass = build({ ...mock.hass.states, [id]: state });
    mock.onChange?.(mock.hass);
  };
  mock.setValue = (id, value, attributes) => {
    const current = mock.hass.states[id];
    mock.set(id, { ...current, state: String(value), attributes: { ...current.attributes, ...attributes }, last_updated: new Date().toISOString() });
  };
  return mock;
}
