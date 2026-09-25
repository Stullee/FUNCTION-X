const STRINGS = {
  en: {
    house: "House",
    overview: "Overview",
    orchestration: "Orchestration",
    acting: "Acting: FUNCTION-X switches your devices",
    shadow: "Shadow mode: only shows what it would do",
    solar: "Solar",
    home: "Home",
    grid: "Grid",
    importing: "Importing",
    exporting: "Exporting",
    battery: "Battery",
    charging: "Charging",
    discharging: "Discharging",
    idle: "Idle",
    car: "Car",
    car_away: "Away",
    car_plugged: "Plugged in",
    car_charging: "Charging",
    heat_pump: "Heat pump",
    boost: "Boost",
    normal: "Normal",
    price: "Price",
    cheap: "Cheap",
    price_normal: "Normal",
    unknown: "Unknown",
    decisions: "What FUNCTION-X is doing",
    no_decisions: "Nothing to decide right now.",
    levels: "Levels",
    rooms: "Rooms",
    rooms_count: (n) => (n === 1 ? "1 room" : `${n} rooms`),
    devices_count: (n) => (n === 1 ? "1 device" : `${n} devices`),
    lights_on: (n) => (n === 1 ? "1 light on" : `${n} lights on`),
    no_rooms: "This level has no rooms yet.",
    no_devices: "No devices in this room yet.",
    assign_hint: "Assign devices to rooms in the house setup.",
    back: "Back",
    edit_house: "Edit house",
    demo_layout_hint: "This is a sample house. Set up your own levels and rooms to see your home.",
    set_up: "Set up my house",
    loading: "Loading your house…",
    error: "Could not load the house",
    not_admin: "Ask an administrator to set up the house.",
    target: "Target",
    open: "Open",
    close: "Close",
    on: "On",
    off: "Off",
    // Setup guide
    wizard_title: "Set up your house",
    step_levels: "Levels & rooms",
    step_energy: "Energy",
    step_devices: "Devices",
    welcome: "Tell FUNCTION-X what your home looks like. The house on the left updates as you go.",
    levels_help: "Add a level for each floor, lowest first, and the rooms on it.",
    level_name: "Level name",
    level_number: "Level",
    add_level: "Add level",
    remove_level: "Remove level",
    room_name: "Room name",
    add_room: "Add room",
    remove_room: "Remove room",
    new_level: (n) => (n === 0 ? "Ground floor" : n < 0 ? "Basement" : `Floor ${n}`),
    energy_help: "What is installed at your home? Detected equipment is already ticked.",
    has_solar: "Solar panels on the roof",
    has_battery: "Home battery",
    has_heat_pump: "Heat pump",
    cars: "Cars / wallboxes",
    detected: "detected",
    devices_help: "These lights, thermostats and sensors are not in a room yet. Pick a room for each.",
    no_unassigned: "All devices are in a room. Nice!",
    choose_room: "Choose room…",
    next: "Next",
    previous: "Back",
    save: "Save",
    saving: "Saving…",
    done: "Done",
    cancel: "Cancel",
    confirm_delete: (names) =>
      `This removes ${names} from Home Assistant. Devices in removed rooms stay, but lose their room. Continue?`,
  },
  de: {
    house: "Haus",
    overview: "Übersicht",
    orchestration: "Orchestrierung",
    acting: "Aktiv: FUNCTION-X schaltet deine Geräte",
    shadow: "Schattenmodus: zeigt nur, was es tun würde",
    solar: "PV",
    home: "Haus",
    grid: "Netz",
    importing: "Bezug",
    exporting: "Einspeisung",
    battery: "Speicher",
    charging: "Lädt",
    discharging: "Entlädt",
    idle: "Ruht",
    car: "Auto",
    car_away: "Unterwegs",
    car_plugged: "Eingesteckt",
    car_charging: "Lädt",
    heat_pump: "Wärmepumpe",
    boost: "Boost",
    normal: "Normal",
    price: "Preis",
    cheap: "Günstig",
    price_normal: "Normal",
    unknown: "Unbekannt",
    decisions: "Was FUNCTION-X gerade tut",
    no_decisions: "Gerade gibt es nichts zu entscheiden.",
    levels: "Etagen",
    rooms: "Räume",
    rooms_count: (n) => (n === 1 ? "1 Raum" : `${n} Räume`),
    devices_count: (n) => (n === 1 ? "1 Gerät" : `${n} Geräte`),
    lights_on: (n) => (n === 1 ? "1 Licht an" : `${n} Lichter an`),
    no_rooms: "Diese Etage hat noch keine Räume.",
    no_devices: "Noch keine Geräte in diesem Raum.",
    assign_hint: "Ordne Geräte in der Hauseinrichtung einem Raum zu.",
    back: "Zurück",
    edit_house: "Haus bearbeiten",
    demo_layout_hint: "Das ist ein Beispielhaus. Richte deine Etagen und Räume ein, um dein Zuhause zu sehen.",
    set_up: "Mein Haus einrichten",
    loading: "Lade dein Haus…",
    error: "Das Haus konnte nicht geladen werden",
    not_admin: "Bitte eine Administratorin oder einen Administrator, das Haus einzurichten.",
    target: "Soll",
    open: "Öffnen",
    close: "Schließen",
    on: "An",
    off: "Aus",
    wizard_title: "Dein Haus einrichten",
    step_levels: "Etagen & Räume",
    step_energy: "Energie",
    step_devices: "Geräte",
    welcome: "Zeig FUNCTION-X, wie dein Zuhause aussieht. Das Haus links passt sich beim Eingeben an.",
    levels_help: "Lege für jedes Stockwerk eine Etage an, die unterste zuerst, und ihre Räume.",
    level_name: "Name der Etage",
    level_number: "Ebene",
    add_level: "Etage hinzufügen",
    remove_level: "Etage entfernen",
    room_name: "Raumname",
    add_room: "Raum hinzufügen",
    remove_room: "Raum entfernen",
    new_level: (n) => (n === 0 ? "Erdgeschoss" : n < 0 ? "Keller" : `${n}. Obergeschoss`),
    energy_help: "Was ist bei dir installiert? Erkannte Geräte sind schon angehakt.",
    has_solar: "PV-Anlage auf dem Dach",
    has_battery: "Batteriespeicher",
    has_heat_pump: "Wärmepumpe",
    cars: "Autos / Wallboxen",
    detected: "erkannt",
    devices_help: "Diese Lichter, Thermostate und Sensoren sind noch keinem Raum zugeordnet. Wähle jeweils einen Raum.",
    no_unassigned: "Alle Geräte sind einem Raum zugeordnet. Super!",
    choose_room: "Raum wählen…",
    next: "Weiter",
    previous: "Zurück",
    save: "Speichern",
    saving: "Speichere…",
    done: "Fertig",
    cancel: "Abbrechen",
    confirm_delete: (names) =>
      `Damit wird ${names} aus Home Assistant entfernt. Geräte in entfernten Räumen bleiben erhalten, verlieren aber ihren Raum. Fortfahren?`,
  },
};

export function strings(hass) {
  const lang = (hass?.locale?.language || hass?.language || "en").slice(0, 2);
  return STRINGS[lang] || STRINGS.en;
}

export function numberFormat(hass, options) {
  const lang = hass?.locale?.language || hass?.language || "en";
  try {
    return new Intl.NumberFormat(lang, options);
  } catch {
    return new Intl.NumberFormat("en", options);
  }
}

export function formatPower(hass, watts) {
  if (watts == null || Number.isNaN(watts)) return "–";
  const abs = Math.abs(watts);
  if (abs >= 1000) {
    return `${numberFormat(hass, { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(abs / 1000)} kW`;
  }
  return `${numberFormat(hass, { maximumFractionDigits: 0 }).format(abs)} W`;
}

export function formatPercent(hass, value) {
  if (value == null || Number.isNaN(value)) return "–";
  return `${numberFormat(hass, { maximumFractionDigits: 0 }).format(value)} %`;
}

export function formatState(hass, entityId) {
  const state = hass.states[entityId];
  if (!state) return "–";
  if (typeof hass.formatEntityState === "function") {
    try {
      return hass.formatEntityState(state);
    } catch {
      /* fall through */
    }
  }
  const unit = state.attributes.unit_of_measurement;
  return unit ? `${state.state} ${unit}` : state.state;
}

export function entityName(hass, entityId) {
  const state = hass.states[entityId];
  return state?.attributes.friendly_name || entityId;
}

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]);
}
