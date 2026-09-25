// FUNCTION-X sidebar panel: a 3D house with live energy flows, level and room
// views, and a setup guide that writes floors and rooms into Home Assistant.

import { HouseScene } from "./scene.js";
import { STYLES } from "./styles.js";
import {
  entityName,
  esc,
  formatPercent,
  formatPower,
  formatState,
  numberFormat,
  strings,
} from "./i18n.js";

const REGISTRY_EVENTS = [
  "floor_registry_updated",
  "area_registry_updated",
  "device_registry_updated",
  "entity_registry_updated",
];

const DOMAIN_ICONS = {
  light: "mdi:lightbulb",
  switch: "mdi:toggle-switch-variant",
  fan: "mdi:fan",
  climate: "mdi:thermostat",
  water_heater: "mdi:water-boiler",
  cover: "mdi:window-shutter",
  sensor: "mdi:thermometer",
  binary_sensor: "mdi:window-open-variant",
};
const TOGGLE_DOMAINS = new Set(["light", "switch", "fan"]);

const num = (hass, id) => {
  if (!id) return null;
  const value = parseFloat(hass.states[id]?.state);
  return Number.isFinite(value) ? value : null;
};

class FunctionXPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._view = { level: null, room: null };
    this._wizard = null;
    this._wizardOffered = false;
    this._signature = "";
  }

  // ------------------------------------------------------ Home Assistant API

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) this._init();
    else this._scheduleUpdate();
  }

  get hass() {
    return this._hass;
  }

  set narrow(value) {
    this._narrow = value;
    this.toggleAttribute("narrow", !!value);
    this._renderTopbar();
    this._updateInsets();
  }

  set panel(value) {
    this._panel = value;
  }

  set route(value) {
    this._route = value;
  }

  connectedCallback() {
    if (this._hass && !this._scene && this._house) this._createScene();
    this._subscribe();
  }

  disconnectedCallback() {
    this._scene?.dispose();
    this._scene = null;
    this._unsubscribe();
  }

  // ------------------------------------------------------ setup

  _init() {
    this.shadowRoot.innerHTML = `
      <style>${STYLES}</style>
      <div class="root">
        <div class="stage"></div>
        <div class="topbar"></div>
        <aside class="sidebar"><div class="scroll"><div class="muted">${esc(strings(this._hass).loading)}</div></div></aside>
      </div>`;
    this.$stage = this.shadowRoot.querySelector(".stage");
    this.$topbar = this.shadowRoot.querySelector(".topbar");
    this.$sidebar = this.shadowRoot.querySelector(".sidebar");
    this.$sidebar.addEventListener("click", (e) => this._onClick(e));
    this.$topbar.addEventListener("click", (e) => this._onClick(e));
    this.$sidebar.addEventListener("input", (e) => this._onInput(e));
    this.$sidebar.addEventListener("change", (e) => this._onChange(e));
    this.$sidebar.addEventListener("keydown", (e) => this._onKeydown(e));
    new ResizeObserver(() => this._updateInsets()).observe(this.$sidebar);
    this._renderTopbar();
    this._subscribe();
    this._load();
  }

  async _load(entryId) {
    try {
      const house = await this._hass.callWS({ type: "function_x/house", ...(entryId ? { entry_id: entryId } : {}) });
      this._setHouse(house);
    } catch (err) {
      this._error = err?.message || String(err);
      this._renderSidebar(true);
    }
  }

  _setHouse(house) {
    this._house = house;
    this._error = null;
    this._roomIndex = new Map();
    house.floors.forEach((floor, level) => floor.rooms.forEach((room) => this._roomIndex.set(room.id, { room, level })));
    if (this._view.level != null && this._view.level >= house.floors.length) this._view = { level: null, room: null };
    if (this._view.room && !this._roomIndex.has(this._view.room)) this._view.room = null;

    if (!this._scene) this._createScene();
    else if (!this._wizard) this._scene.setModel(this._sceneModel());

    if (!house.settings.configured && !this._wizardOffered && this._hass.user?.is_admin) {
      this._wizardOffered = true;
      this._startWizard();
      return;
    }
    this._update(true);
  }

  _createScene() {
    this._scene = new HouseScene(this.$stage, {
      onSelectLevel: (level) => this._go({ level, room: null }),
      onSelectRoom: (room) => {
        if (room == null) this._go({ level: this._view.level, room: null });
        else this._go({ level: this._roomIndex.get(room)?.level ?? this._view.level, room });
      },
    });
    this._scene.setTheme(!!this._hass.themes?.darkMode);
    this._scene.setModel(this._wizard ? this._wizardModel() : this._sceneModel());
    if (this._view.level != null) this._scene.selectLevel(this._view.level);
    if (this._view.room) this._scene.selectRoom(this._view.room);
    this._updateInsets();
    this._scene.setLive(this._liveModel());
  }

  async _subscribe() {
    const conn = this._hass?.connection;
    if (!conn || this._unsubs || !this.isConnected) return;
    this._unsubs = [];
    const reload = () => {
      clearTimeout(this._reloadTimer);
      this._reloadTimer = setTimeout(() => {
        if (!this._wizard) this._load(this._house?.entry_id);
      }, 400);
    };
    for (const type of REGISTRY_EVENTS) {
      try {
        this._unsubs.push(await conn.subscribeEvents(reload, type));
      } catch {
        /* not allowed for this user: fine, we just won't auto-refresh */
      }
    }
  }

  _unsubscribe() {
    (this._unsubs || []).forEach((unsub) => typeof unsub === "function" && unsub());
    this._unsubs = null;
  }

  _updateInsets() {
    if (!this._scene || !this.$sidebar) return;
    const rect = this.$sidebar.getBoundingClientRect();
    this._scene.setInsets(this._narrow ? { bottom: rect.height } : { right: rect.width + 24 });
  }

  // ------------------------------------------------------ models

  _sceneModel() {
    const h = this._house;
    return { floors: h.floors, energy: h.energy };
  }

  _roomState(room) {
    const hass = this._hass;
    let lights = 0;
    let heating = false;
    let open = false;
    let temp = room.temperature_entity ? num(hass, room.temperature_entity) : null;
    for (const e of room.entities) {
      const state = hass.states[e.entity_id];
      if (!state) continue;
      if (e.domain === "light" && state.state === "on") lights++;
      if (e.domain === "climate") {
        if (state.attributes.hvac_action === "heating") heating = true;
        if (temp == null && typeof state.attributes.current_temperature === "number") temp = state.attributes.current_temperature;
      }
      if (e.domain === "binary_sensor" && ["window", "door", "opening"].includes(e.device_class) && state.state === "on") open = true;
      if (temp == null && e.domain === "sensor" && e.device_class === "temperature") temp = num(hass, e.entity_id);
    }
    const t = strings(hass);
    const parts = [];
    if (temp != null) parts.push(`${numberFormat(hass, { maximumFractionDigits: 1 }).format(temp)} °C`);
    if (lights) parts.push(t.lights_on(lights));
    return { lights, heating, open, temp, summary: parts.join(" · ") };
  }

  _liveModel() {
    const hass = this._hass;
    const house = this._house;
    if (!house) return null;
    const t = strings(hass);
    const ids = house.energy.entities;
    const pv = num(hass, ids.pv_power);
    const grid = num(hass, ids.grid_power);
    const battery = num(hass, ids.battery_power);
    const batterySoc = num(hass, ids.battery_soc);
    const home = num(hass, ids.home_power);
    const hpState = hass.states[ids.heat_pump_boost];
    const heatPumpBoost = house.energy.heat_pump_switch
      ? hass.states[house.energy.heat_pump_switch]?.state === "on"
      : hpState?.state === "on";

    const cars = house.energy.loadpoints.map((lp) => {
      const state = hass.states[lp.entity_id];
      const power = num(hass, lp.entity_id) || 0;
      return {
        title: lp.title,
        power,
        connected: !!state?.attributes.connected,
        charging: !!state?.attributes.charging || power > 50,
        soc: state?.attributes.vehicle_soc,
        mode: state?.attributes.mode,
      };
    });
    while (cars.length < (house.energy.cars || 0)) cars.push({ title: t.car, power: 0, connected: false, charging: false });

    const rooms = {};
    for (const floor of house.floors) for (const room of floor.rooms) rooms[room.id] = this._roomState(room);

    const labels = {
      home: home != null ? formatPower(hass, home) : null,
      grid: grid != null ? `${grid >= 0 ? "↓" : "↑"} ${formatPower(hass, grid)}` : null,
    };
    if (house.energy.has_solar) labels.solar = formatPower(hass, pv ?? 0);
    if (house.energy.has_battery) labels.battery = batterySoc != null ? formatPercent(hass, batterySoc) : "–";
    if (house.energy.has_heat_pump) labels.heat_pump = heatPumpBoost ? t.boost : t.normal;
    cars.forEach((car, i) => {
      labels[`car${i}`] = !car.connected
        ? t.car_away
        : car.charging
          ? `${formatPower(hass, car.power)}${car.soc != null ? ` · ${formatPercent(hass, car.soc)}` : ""}`
          : `${t.car_plugged}${car.soc != null ? ` · ${formatPercent(hass, car.soc)}` : ""}`;
    });

    return { pv, grid, battery, batterySoc, home, heatPumpBoost, cars, rooms, labels };
  }

  // ------------------------------------------------------ updates

  _scheduleUpdate() {
    if (this._pending) return;
    this._pending = requestAnimationFrame(() => {
      this._pending = null;
      this._update(false);
    });
  }

  _relevantIds() {
    const house = this._house;
    const ids = [...Object.values(house.energy.entities), ...house.energy.loadpoints.map((l) => l.entity_id)];
    if (house.energy.heat_pump_switch) ids.push(house.energy.heat_pump_switch);
    for (const floor of house.floors) {
      for (const room of floor.rooms) {
        ids.push(...room.entities.map((e) => e.entity_id));
        if (room.temperature_entity) ids.push(room.temperature_entity);
      }
    }
    return ids;
  }

  _update(force) {
    if (!this._house) return;
    const hass = this._hass;
    this._scene?.setTheme(!!hass.themes?.darkMode);
    const signature = this._relevantIds()
      .map((id) => `${id}=${hass.states[id]?.last_updated}`)
      .join("|") + `|${hass.language}`;
    if (!force && signature === this._signature) return;
    this._signature = signature;
    this._scene?.setLive(this._liveModel());
    if (!this._wizard) this._renderSidebar(false);
    this._renderTopbar();
  }

  _go(view) {
    if (this._wizard) return;
    this._view = { level: view.level ?? null, room: view.room ?? null };
    if (this._view.room) this._scene?.selectRoom(this._view.room);
    else if (this._view.level != null) {
      this._scene?.selectLevel(this._view.level);
    } else this._scene?.resetView();
    this._renderSidebar(true);
    this._renderTopbar();
  }

  // ------------------------------------------------------ rendering

  _renderTopbar() {
    if (!this.$topbar || !this._hass) return;
    const t = strings(this._hass);
    const house = this._house;
    const floors = this._wizard ? [] : house?.floors || [];
    this.$topbar.innerHTML = `
      <span class="menu"></span>
      <div class="brand">
        <div class="logo"><ha-icon icon="mdi:home-lightning-bolt"></ha-icon></div>
        <div><b>FUNCTION-X</b>${house ? `<small>${esc(house.title)}</small>` : ""}</div>
      </div>
      ${floors.length > 1 || (floors.length === 1 && floors[0].rooms.length)
        ? `<div class="levels">
            <button class="pill ${this._view.level == null ? "active" : ""}" data-action="overview">${esc(t.house)}</button>
            ${floors
              .map((f, i) => `<button class="pill ${this._view.level === i ? "active" : ""}" data-action="level" data-level="${i}">${esc(f.name)}</button>`)
              .join("")}
          </div>`
        : ""}`;
    if (this._narrow) {
      const menu = document.createElement("ha-menu-button");
      menu.hass = this._hass;
      menu.narrow = true;
      this.$topbar.querySelector(".menu").appendChild(menu);
    }
  }

  _renderSidebar(resetScroll) {
    const scroll = this.$sidebar.querySelector(".scroll");
    const top = resetScroll ? 0 : scroll?.scrollTop || 0;
    this.$sidebar.classList.toggle("wide", !!this._wizard);
    let body;
    let footer = "";
    if (this._error) body = `<div class="error">${esc(strings(this._hass).error)}: ${esc(this._error)}</div>`;
    else if (!this._house) body = `<div class="muted">${esc(strings(this._hass).loading)}</div>`;
    else if (this._wizard) [body, footer] = this._renderWizard();
    else if (this._view.room) body = this._renderRoom();
    else if (this._view.level != null) body = this._renderLevel();
    else body = this._renderOverview();
    this.$sidebar.innerHTML = `<div class="scroll">${body}</div>${footer ? `<div class="footer">${footer}</div>` : ""}`;
    this.$sidebar.querySelector(".scroll").scrollTop = top;
  }

  _tile(icon, color, value, labelText) {
    return `<div class="tile" style="--c:${color}"><div class="icon"><ha-icon icon="${icon}"></ha-icon></div>
      <div><div class="v">${esc(value)}</div><div class="l">${esc(labelText)}</div></div></div>`;
  }

  _renderOverview() {
    const hass = this._hass;
    const t = strings(hass);
    const house = this._house;
    const ids = house.energy.entities;
    const live = this._liveModel();
    const orch = hass.states[ids.orchestration];
    const acting = orch?.state === "on";

    const tiles = [];
    if (house.energy.has_solar) tiles.push(this._tile("mdi:solar-power-variant", "#ff9800", formatPower(hass, live.pv ?? 0), t.solar));
    tiles.push(this._tile("mdi:home-lightning-bolt", "#5d7df7", formatPower(hass, live.home), t.home));
    tiles.push(
      this._tile(
        "mdi:transmission-tower",
        (live.grid ?? 0) >= 0 ? "#488fc2" : "#8353d1",
        formatPower(hass, live.grid),
        `${t.grid} · ${(live.grid ?? 0) >= 0 ? t.importing : t.exporting}`,
      ),
    );
    if (house.energy.has_battery) {
      const b = live.battery ?? 0;
      tiles.push(
        this._tile("mdi:home-battery", "#f06292", formatPercent(hass, live.batterySoc), `${t.battery} · ${b > 30 ? t.discharging : b < -30 ? t.charging : t.idle}`),
      );
    }
    live.cars.forEach((car) => {
      const status = !car.connected ? t.car_away : car.charging ? t.car_charging : t.car_plugged;
      const value = car.charging ? formatPower(hass, car.power) : car.soc != null && car.connected ? formatPercent(hass, car.soc) : "–";
      tiles.push(this._tile("mdi:car-electric", "#26a69a", value, `${car.title} · ${status}`));
    });
    if (house.energy.has_heat_pump) tiles.push(this._tile("mdi:heat-pump", "#ef6c3a", live.heatPumpBoost ? t.boost : t.normal, t.heat_pump));
    if (ids.grid_price && hass.states[ids.grid_price]) {
      const level = hass.states[ids.price_level]?.state;
      const levelText = level === "cheap" ? t.cheap : level === "normal" ? t.price_normal : t.unknown;
      tiles.push(this._tile("mdi:cash", "#0f9d58", formatState(hass, ids.grid_price), `${t.price} · ${levelText}`));
    }

    const decision = hass.states[ids.decision];
    const decisions = decision?.attributes.decisions || [];
    const errors = decision?.attributes.errors || [];

    const levels = house.floors
      .map((floor, i) => {
        const lights = floor.rooms.reduce((n, r) => n + this._roomState(r).lights, 0);
        const meta = [t.rooms_count(floor.rooms.length), lights ? t.lights_on(lights) : null].filter(Boolean).join(" · ");
        return `<button class="item" data-action="level" data-level="${i}">
          <ha-icon class="icon" icon="${esc(floor.icon || "mdi:floor-plan")}"></ha-icon>
          <div><div class="name">${esc(floor.name)}</div><div class="meta">${esc(meta)}</div></div></button>`;
      })
      .reverse()
      .join("");

    const admin = !!hass.user?.is_admin;
    return `
      ${house.demo_layout ? `<div class="hint">${esc(t.demo_layout_hint)}${admin ? ` <button class="btn small" data-action="wizard">${esc(t.set_up)}</button>` : ""}</div>` : ""}
      ${ids.orchestration ? `<div class="toggle-card">
        <div class="text"><b>${esc(t.orchestration)}</b>${esc(acting ? t.acting : t.shadow)}</div>
        <button class="switch" role="switch" aria-checked="${acting}" aria-label="${esc(t.orchestration)}" data-action="orchestration"></button>
      </div>` : ""}
      <h2>${esc(t.overview)}</h2>
      <div class="tiles">${tiles.join("")}</div>
      <h2>${esc(t.decisions)}</h2>
      <div class="decisions">
        ${decisions.length
          ? decisions
              .map(
                (d) => `<div class="decision"><b>${esc(d.device)}</b><span class="tag ${d.action === "keep" || d.action === "skip" ? "keep" : ""}">${esc(d.action)}</span><br>
                  <span class="muted">${esc(d.reason)}</span></div>`,
              )
              .join("")
          : `<div class="muted">${esc(t.no_decisions)}</div>`}
        ${errors.map((e) => `<div class="error">${esc(e)}</div>`).join("")}
      </div>
      <h2 class="row">${esc(t.levels)}<span class="spacer"></span>${admin ? `<button class="btn flat small" data-action="wizard">${esc(t.edit_house)}</button>` : ""}</h2>
      <div class="list">${levels}</div>`;
  }

  _renderLevel() {
    const t = strings(this._hass);
    const floor = this._house.floors[this._view.level];
    if (!floor) return "";
    const rooms = floor.rooms
      .map((room) => {
        const s = this._roomState(room);
        const meta = [s.summary, t.devices_count(room.entities.length)].filter(Boolean).join(" · ");
        return `<button class="item" data-action="room" data-room="${esc(room.id)}">
          <ha-icon class="icon" icon="${esc(room.icon || (s.lights ? "mdi:lightbulb-on" : "mdi:door"))}"></ha-icon>
          <div><div class="name">${esc(room.name)}</div><div class="meta">${esc(meta)}</div></div></button>`;
      })
      .join("");
    return `
      <button class="back" data-action="overview"><ha-icon icon="mdi:chevron-left"></ha-icon>${esc(t.house)}</button>
      <div class="title">${esc(floor.name)}</div>
      <div class="muted">${esc(t.rooms_count(floor.rooms.length))}</div>
      <h2>${esc(t.rooms)}</h2>
      <div class="list">${rooms || `<div class="muted">${esc(t.no_rooms)}</div>`}</div>`;
  }

  _renderRoom() {
    const hass = this._hass;
    const t = strings(hass);
    const found = this._roomIndex.get(this._view.room);
    if (!found) return "";
    const { room, level } = found;
    const floor = this._house.floors[level];
    const s = this._roomState(room);
    const rows = room.entities.map((e) => this._renderDevice(e)).join("");
    return `
      <button class="back" data-action="level" data-level="${level}"><ha-icon icon="mdi:chevron-left"></ha-icon>${esc(floor.name)}</button>
      <div class="title">${esc(room.name)}</div>
      <div class="muted">${esc(s.summary || t.devices_count(room.entities.length))}</div>
      <h2>${esc(t.devices_count(room.entities.length))}</h2>
      <div class="list">${rows || `<div class="muted">${esc(t.no_devices)} ${hass.user?.is_admin ? esc(t.assign_hint) : ""}</div>`}</div>`;
  }

  _renderDevice(entity) {
    const hass = this._hass;
    const t = strings(hass);
    const state = hass.states[entity.entity_id];
    const name = esc(entityName(hass, entity.entity_id));
    const icon = state?.attributes.icon || DOMAIN_ICONS[entity.domain] || "mdi:devices";
    let control = `<span class="value">${esc(formatState(hass, entity.entity_id))}</span>`;
    if (!state) control = `<span class="muted">–</span>`;
    else if (TOGGLE_DOMAINS.has(entity.domain)) {
      control = `<button class="switch" role="switch" aria-label="${name}" aria-checked="${state.state === "on"}" data-action="toggle" data-entity="${esc(entity.entity_id)}"></button>`;
    } else if (entity.domain === "climate") {
      const target = state.attributes.temperature;
      const current = state.attributes.current_temperature;
      control = `<div class="control">
        ${current != null ? `<span class="muted">${esc(current)} °C</span>` : ""}
        ${target != null ? `<button class="icon-btn" data-action="temp" data-delta="-0.5" data-entity="${esc(entity.entity_id)}" aria-label="-"><ha-icon icon="mdi:minus"></ha-icon></button>
          <span class="value">${esc(target)} °C</span>
          <button class="icon-btn" data-action="temp" data-delta="0.5" data-entity="${esc(entity.entity_id)}" aria-label="+"><ha-icon icon="mdi:plus"></ha-icon></button>` : `<span class="value">${esc(formatState(hass, entity.entity_id))}</span>`}
      </div>`;
    } else if (entity.domain === "cover") {
      control = `<div class="control"><span class="muted">${esc(formatState(hass, entity.entity_id))}</span>
        <button class="btn flat small" data-action="cover" data-service="open_cover" data-entity="${esc(entity.entity_id)}">${esc(t.open)}</button>
        <button class="btn flat small" data-action="cover" data-service="close_cover" data-entity="${esc(entity.entity_id)}">${esc(t.close)}</button></div>`;
    }
    return `<div class="item static"><ha-icon class="icon" icon="${esc(icon)}"></ha-icon>
      <div class="spacer"><div class="name">${name}</div></div>${control}</div>`;
  }

  // ------------------------------------------------------ setup guide

  _startWizard() {
    const house = this._house;
    const t = strings(this._hass);
    const settings = house.settings;
    const detected = house.detected;
    const floors = house.floors.map((floor, i) => ({
      key: `f${i}`,
      id: floor.synthetic ? null : floor.id,
      name: floor.name,
      level: floor.level ?? i,
      rooms: floor.rooms.map((room, j) => ({ key: `r${i}_${j}`, id: room.synthetic ? null : room.id, name: room.name })),
    }));
    if (!floors.length) floors.push({ key: "f0", id: null, name: t.new_level(0), level: 0, rooms: [] });
    this._wizard = {
      step: 0,
      floors,
      original: {
        floors: house.floors.filter((f) => !f.synthetic).map((f) => ({ id: f.id, name: f.name })),
        rooms: house.floors.flatMap((f) => f.rooms).filter((r) => !r.synthetic).map((r) => ({ id: r.id, name: r.name })),
      },
      settings: {
        solar: settings.solar ?? detected.solar,
        battery: settings.battery ?? detected.battery,
        heat_pump: settings.heat_pump ?? detected.heat_pump,
        cars: settings.cars ?? detected.cars,
      },
      saving: false,
      error: null,
      nextKey: 1000,
    };
    this._go({ level: null, room: null });
    this._wizardPreview(true);
    this._renderSidebar(true);
    this._renderTopbar();
  }

  _closeWizard() {
    this._wizard = null;
    this._scene?.setModel(this._sceneModel());
    this._scene?.setLive(this._liveModel());
    this._renderSidebar(true);
    this._renderTopbar();
  }

  _wizardModel() {
    const w = this._wizard;
    const floors = [...w.floors]
      .sort((a, b) => a.level - b.level)
      .map((f) => ({ id: f.key, name: f.name, rooms: f.rooms.map((r) => ({ id: r.key, name: r.name })) }));
    return {
      floors,
      energy: { has_solar: w.settings.solar, has_battery: w.settings.battery, has_heat_pump: w.settings.heat_pump, cars: w.settings.cars },
    };
  }

  _wizardPreview(immediate) {
    clearTimeout(this._previewTimer);
    const apply = () => {
      if (!this._wizard || !this._scene) return;
      this._scene.setModel(this._wizardModel(), { keepCamera: !immediate });
      this._scene.setLive(this._liveModel());
    };
    if (immediate) apply();
    else this._previewTimer = setTimeout(apply, 150);
  }

  _renderWizard() {
    const t = strings(this._hass);
    const w = this._wizard;
    const steps = [t.step_levels, t.step_energy, t.step_devices];
    const header = `
      <div class="title">${esc(t.wizard_title)}</div>
      <div class="steps">${steps.map((s, i) => `<span class="${i <= w.step ? "on" : ""}">${esc(s)}</span>`).join("")}</div>
      ${w.error ? `<div class="error">${esc(w.error)}</div>` : ""}`;

    if (w.step === 0) {
      const unassigned = this._house.unassigned_rooms.map((r) => `<option value="${esc(r.name)}">`).join("");
      const cards = [...w.floors]
        .sort((a, b) => b.level - a.level)
        .map(
          (f) => `<div class="level-card">
            <div class="head">
              <input type="number" value="${f.level}" title="${esc(t.level_number)}" aria-label="${esc(t.level_number)}" data-field="level" data-floor="${f.key}">
              <input type="text" value="${esc(f.name)}" placeholder="${esc(t.level_name)}" aria-label="${esc(t.level_name)}" data-field="floor-name" data-floor="${f.key}">
              <button class="icon-btn" data-action="remove-floor" data-floor="${f.key}" title="${esc(t.remove_level)}" aria-label="${esc(t.remove_level)}" ${w.floors.length === 1 ? "disabled" : ""}><ha-icon icon="mdi:delete-outline"></ha-icon></button>
            </div>
            <div class="rooms-edit">
              ${f.rooms
                .map(
                  (r) => `<div class="room-row">
                    <ha-icon icon="mdi:door" style="--mdc-icon-size:18px;color:var(--fx-muted)"></ha-icon>
                    <input type="text" list="fx-unassigned" value="${esc(r.name)}" placeholder="${esc(t.room_name)}" aria-label="${esc(t.room_name)}" data-field="room-name" data-floor="${f.key}" data-room="${r.key}">
                    <button class="icon-btn" data-action="remove-room" data-floor="${f.key}" data-room="${r.key}" title="${esc(t.remove_room)}" aria-label="${esc(t.remove_room)}"><ha-icon icon="mdi:close"></ha-icon></button>
                  </div>`,
                )
                .join("")}
              <div><button class="btn flat small" data-action="add-room" data-floor="${f.key}">+ ${esc(t.add_room)}</button></div>
            </div>
          </div>`,
        )
        .join("");
      return [
        `${header}<p class="muted">${esc(t.welcome)} ${esc(t.levels_help)}</p>
         <datalist id="fx-unassigned">${unassigned}</datalist>
         <button class="btn flat small" data-action="add-floor">+ ${esc(t.add_level)}</button>
         ${cards}`,
        `<button class="btn flat" data-action="wizard-cancel">${esc(t.cancel)}</button>
         <button class="btn" data-action="wizard-next">${esc(t.next)}</button>`,
      ];
    }

    if (w.step === 1) {
      const d = this._house.detected;
      const check = (key, icon, text) => `<label class="check">
          <input type="checkbox" data-field="setting" data-setting="${key}" ${w.settings[key] ? "checked" : ""}>
          <ha-icon class="icon" icon="${icon}"></ha-icon>${esc(text)}
          ${d[key] ? `<span class="badge">${esc(t.detected)}</span>` : ""}</label>`;
      return [
        `${header}<p class="muted">${esc(t.energy_help)}</p>
         ${check("solar", "mdi:solar-power-variant", t.has_solar)}
         ${check("battery", "mdi:home-battery", t.has_battery)}
         ${check("heat_pump", "mdi:heat-pump", t.has_heat_pump)}
         <div class="check"><ha-icon class="icon" icon="mdi:car-electric"></ha-icon>${esc(t.cars)}
           ${d.cars ? `<span class="badge">${esc(t.detected)}: ${d.cars}</span>` : ""}
           <div class="stepper">
             <button class="icon-btn" data-action="cars" data-delta="-1" aria-label="-"><ha-icon icon="mdi:minus"></ha-icon></button>
             <span class="value">${w.settings.cars}</span>
             <button class="icon-btn" data-action="cars" data-delta="1" aria-label="+"><ha-icon icon="mdi:plus"></ha-icon></button>
           </div></div>`,
        `<button class="btn flat" data-action="wizard-back">${esc(t.previous)}</button>
         <button class="btn" data-action="wizard-save" ${w.saving ? "disabled" : ""}>${esc(w.saving ? t.saving : t.save)}</button>`,
      ];
    }

    const areas = this._house.floors
      .map(
        (f) => `<optgroup label="${esc(f.name)}">${f.rooms.map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join("")}</optgroup>`,
      )
      .join("");
    const items = this._house.unassigned_entities
      .map(
        (e) => `<div class="item static">
          <ha-icon class="icon" icon="${esc(this._hass.states[e.entity_id]?.attributes.icon || DOMAIN_ICONS[e.domain] || "mdi:devices")}"></ha-icon>
          <div class="spacer"><div class="name">${esc(entityName(this._hass, e.entity_id))}</div><div class="meta">${esc(e.entity_id)}</div></div>
          <select data-field="assign" data-entity="${esc(e.entity_id)}" aria-label="${esc(t.choose_room)}"><option value="">${esc(t.choose_room)}</option>${areas}</select>
        </div>`,
      )
      .join("");
    return [
      `${header}<p class="muted">${esc(items ? t.devices_help : t.no_unassigned)}</p><div class="assign">${items}</div>`,
      `<button class="btn" data-action="wizard-done">${esc(t.done)}</button>`,
    ];
  }

  _wizardFloor(key) {
    return this._wizard.floors.find((f) => f.key === key);
  }

  async _wizardSave() {
    const t = strings(this._hass);
    const w = this._wizard;
    const keptFloors = new Set(w.floors.map((f) => f.id).filter(Boolean));
    const keptRooms = new Set(w.floors.flatMap((f) => f.rooms.map((r) => r.id)).filter(Boolean));
    const deleteFloors = w.original.floors.filter((f) => !keptFloors.has(f.id));
    const deleteRooms = w.original.rooms.filter((r) => !keptRooms.has(r.id));
    const floors = w.floors
      .map((f) => ({ ...f, name: f.name.trim(), rooms: f.rooms.filter((r) => r.name.trim()) }))
      .filter((f) => f.name);
    if (!floors.length) {
      w.error = `${t.level_name}?`;
      this._renderSidebar(false);
      return;
    }
    const removed = [...deleteFloors, ...deleteRooms].map((x) => `"${x.name}"`);
    if (removed.length && !window.confirm(t.confirm_delete(removed.join(", ")))) return;

    w.saving = true;
    w.error = null;
    this._renderSidebar(false);
    try {
      const house = await this._hass.callWS({
        type: "function_x/house/save",
        entry_id: this._house.entry_id,
        floors: floors.map((f) => ({
          id: f.id,
          name: f.name,
          level: Number.isFinite(f.level) ? f.level : 0,
          rooms: f.rooms.map((r) => ({ id: r.id, name: r.name.trim() })),
        })),
        settings: w.settings,
        delete_floors: deleteFloors.map((f) => f.id),
        delete_rooms: deleteRooms.map((r) => r.id),
      });
      this._house = house;
      this._setHouseSilently(house);
      w.saving = false;
      w.step = 2;
      this._scene?.setModel(this._sceneModel(), { keepCamera: true });
      this._scene?.setLive(this._liveModel());
    } catch (err) {
      w.saving = false;
      w.error = err?.message || String(err);
    }
    this._renderSidebar(true);
  }

  _setHouseSilently(house) {
    this._roomIndex = new Map();
    house.floors.forEach((floor, level) => floor.rooms.forEach((room) => this._roomIndex.set(room.id, { room, level })));
  }

  // ------------------------------------------------------ events

  _onClick(event) {
    const el = event.target.closest("[data-action]");
    if (!el || el.disabled) return;
    const hass = this._hass;
    const w = this._wizard;
    const action = el.dataset.action;
    switch (action) {
      case "overview":
        return this._go({ level: null, room: null });
      case "level":
        return this._go({ level: Number(el.dataset.level), room: null });
      case "room":
        return this._go({ level: this._roomIndex.get(el.dataset.room)?.level, room: el.dataset.room });
      case "orchestration": {
        const id = this._house.energy.entities.orchestration;
        const on = hass.states[id]?.state === "on";
        return hass.callService("switch", on ? "turn_off" : "turn_on", { entity_id: id });
      }
      case "toggle": {
        const id = el.dataset.entity;
        return hass.callService(id.split(".")[0], "toggle", { entity_id: id });
      }
      case "temp": {
        const id = el.dataset.entity;
        const current = hass.states[id]?.attributes.temperature;
        if (typeof current !== "number") return;
        return hass.callService("climate", "set_temperature", { entity_id: id, temperature: current + Number(el.dataset.delta) });
      }
      case "cover":
        return hass.callService("cover", el.dataset.service, { entity_id: el.dataset.entity });
      case "wizard":
        return this._startWizard();
      case "wizard-cancel":
      case "wizard-done":
        return this._closeWizard();
      case "wizard-next":
        w.step = 1;
        w.error = null;
        return this._renderSidebar(true);
      case "wizard-back":
        w.step = 0;
        return this._renderSidebar(true);
      case "wizard-save":
        return this._wizardSave();
      case "add-floor": {
        const level = Math.max(...w.floors.map((f) => f.level), -1) + 1;
        w.floors.push({ key: `f${w.nextKey++}`, id: null, name: strings(hass).new_level(level), level, rooms: [] });
        this._wizardPreview(true);
        return this._renderSidebar(false);
      }
      case "remove-floor":
        w.floors = w.floors.filter((f) => f.key !== el.dataset.floor);
        this._wizardPreview(true);
        return this._renderSidebar(false);
      case "add-room": {
        const floor = this._wizardFloor(el.dataset.floor);
        const key = `r${w.nextKey++}`;
        floor.rooms.push({ key, id: null, name: "" });
        this._renderSidebar(false);
        this.$sidebar.querySelector(`input[data-room="${key}"]`)?.focus();
        return;
      }
      case "remove-room": {
        const floor = this._wizardFloor(el.dataset.floor);
        floor.rooms = floor.rooms.filter((r) => r.key !== el.dataset.room);
        this._wizardPreview(false);
        return this._renderSidebar(false);
      }
      case "cars":
        w.settings.cars = Math.max(0, Math.min(3, w.settings.cars + Number(el.dataset.delta)));
        this._wizardPreview(false);
        return this._renderSidebar(false);
      default:
    }
  }

  _onInput(event) {
    const el = event.target;
    const w = this._wizard;
    if (!w) return;
    const floor = el.dataset.floor && this._wizardFloor(el.dataset.floor);
    switch (el.dataset.field) {
      case "floor-name":
        floor.name = el.value;
        break;
      case "level":
        floor.level = parseInt(el.value, 10);
        if (!Number.isFinite(floor.level)) floor.level = 0;
        break;
      case "room-name":
        floor.rooms.find((r) => r.key === el.dataset.room).name = el.value;
        break;
      default:
        return;
    }
    this._wizardPreview(false);
  }

  async _onChange(event) {
    const el = event.target;
    const w = this._wizard;
    if (!w) return;
    if (el.dataset.field === "setting") {
      w.settings[el.dataset.setting] = el.checked;
      this._wizardPreview(false);
    } else if (el.dataset.field === "level") {
      this._renderSidebar(false); // re-sort the level cards
    } else if (el.dataset.field === "assign" && el.value) {
      el.disabled = true;
      try {
        const house = await this._hass.callWS({
          type: "function_x/assign",
          entry_id: this._house.entry_id,
          entity_id: el.dataset.entity,
          area_id: el.value,
        });
        this._house = house;
        this._setHouseSilently(house);
        w.error = null;
      } catch (err) {
        w.error = err?.message || String(err);
      }
      this._renderSidebar(false);
    }
  }

  _onKeydown(event) {
    const el = event.target;
    if (event.key === "Enter" && el.dataset.field === "room-name") {
      event.preventDefault();
      this.$sidebar.querySelector(`[data-action="add-room"][data-floor="${el.dataset.floor}"]`)?.click();
    }
  }
}

if (!customElements.get("function-x-panel")) customElements.define("function-x-panel", FunctionXPanel);
