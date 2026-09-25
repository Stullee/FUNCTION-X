export const STYLES = `
:host {
  display: block;
  height: 100vh;
  --fx-radius: 16px;
  --fx-card: var(--card-background-color, #fff);
  --fx-text: var(--primary-text-color, #1c1c1c);
  --fx-muted: var(--secondary-text-color, #6b6b6b);
  --fx-divider: var(--divider-color, rgba(0, 0, 0, 0.12));
  --fx-primary: var(--primary-color, #03a9f4);
  --fx-bg: var(--primary-background-color, #f5f5f5);
  color: var(--fx-text);
  font-family: var(--paper-font-body1_-_font-family, Roboto, "Segoe UI", system-ui, sans-serif);
}
* { box-sizing: border-box; }
.root { position: relative; height: 100%; overflow: hidden; background: var(--fx-bg); }
.stage { position: absolute; inset: 0; z-index: 0; isolation: isolate; }
.stage .webgl { display: block; outline: none; touch-action: none; }
.stage .labels { position: absolute; inset: 0; pointer-events: none; }

.topbar {
  position: absolute; top: 12px; left: 12px; right: 400px;
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap; pointer-events: none; z-index: 2;
}
.topbar > * { pointer-events: auto; }
.brand { display: flex; align-items: center; gap: 8px; padding: 6px 12px 6px 6px; }
.brand .logo {
  width: 32px; height: 32px; border-radius: 10px; display: grid; place-items: center;
  background: linear-gradient(135deg, #ff9800, #26a69a); color: #fff; --mdc-icon-size: 20px;
}
.brand b { font-size: 16px; letter-spacing: 0.3px; }
.brand small { display: block; color: var(--fx-muted); font-size: 12px; }
.levels { display: flex; gap: 6px; flex-wrap: wrap; }
.pill {
  border: 1px solid var(--fx-divider); background: var(--fx-card); color: var(--fx-text);
  border-radius: 999px; padding: 6px 12px; font: inherit; font-size: 13px; cursor: pointer;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}
.pill:hover { border-color: var(--fx-primary); }
.pill.active { background: var(--fx-primary); border-color: var(--fx-primary); color: #fff; }

.sidebar {
  position: absolute; top: 12px; right: 12px; bottom: 12px; width: 372px;
  background: var(--fx-card); border-radius: var(--fx-radius);
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12); display: flex; flex-direction: column; overflow: hidden; z-index: 2;
}
.sidebar.wide { width: 440px; }
.sidebar .scroll { overflow-y: auto; padding: 16px; flex: 1; }
.sidebar .footer { border-top: 1px solid var(--fx-divider); padding: 12px 16px; display: flex; gap: 8px; justify-content: flex-end; }

:host([narrow]) .topbar { right: 12px; }
:host([narrow]) .sidebar, :host([narrow]) .sidebar.wide {
  top: auto; left: 0; right: 0; bottom: 0; width: auto; height: 46%;
  border-radius: var(--fx-radius) var(--fx-radius) 0 0;
}

h2 { font-size: 15px; margin: 18px 0 8px; font-weight: 600; }
h2:first-child { margin-top: 0; }
.muted { color: var(--fx-muted); font-size: 13px; }
.row { display: flex; align-items: center; gap: 10px; }
.spacer { flex: 1; }

.toggle-card { display: flex; align-items: center; gap: 12px; padding: 12px; border-radius: 12px; background: color-mix(in srgb, var(--fx-primary) 8%, transparent); }
.toggle-card .text { flex: 1; font-size: 13px; }
.toggle-card b { display: block; font-size: 14px; margin-bottom: 2px; }
.switch {
  position: relative; width: 44px; height: 26px; border-radius: 13px; border: none; cursor: pointer; flex: none;
  background: var(--fx-divider); transition: background 0.2s;
}
.switch::after {
  content: ""; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%;
  background: #fff; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3); transition: transform 0.2s;
}
.switch[aria-checked="true"] { background: var(--fx-primary); }
.switch[aria-checked="true"]::after { transform: translateX(18px); }

.tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.tile { border: 1px solid var(--fx-divider); border-radius: 12px; padding: 10px; display: flex; gap: 10px; align-items: center; min-width: 0; }
.tile .icon { width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; flex: none;
  background: color-mix(in srgb, var(--c) 16%, transparent); color: var(--c); --mdc-icon-size: 20px; }
.tile .v { font-weight: 600; font-size: 15px; white-space: nowrap; }
.tile .l { color: var(--fx-muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tile > div { min-width: 0; }

.decisions { display: flex; flex-direction: column; gap: 8px; }
.decision { font-size: 13px; line-height: 1.4; padding: 8px 10px; border-radius: 10px; border: 1px solid var(--fx-divider); }
.decision .tag { display: inline-block; font-size: 11px; font-weight: 600; padding: 1px 8px; border-radius: 999px; margin-left: 6px;
  background: color-mix(in srgb, var(--fx-primary) 14%, transparent); color: var(--fx-primary); }
.decision .tag.keep { background: var(--fx-divider); color: var(--fx-muted); }
.error { color: var(--error-color, #db4437); font-size: 13px; }

.list { display: flex; flex-direction: column; gap: 6px; }
.item { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 12px; border: 1px solid var(--fx-divider);
  background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; width: 100%; }
.item:hover { border-color: var(--fx-primary); }
.item .icon { --mdc-icon-size: 22px; color: var(--fx-muted); }
.item .name { font-weight: 500; }
.item .meta { color: var(--fx-muted); font-size: 12px; }
.item.static { cursor: default; }
.item.static:hover { border-color: var(--fx-divider); }

.back { display: inline-flex; align-items: center; gap: 4px; border: none; background: none; color: var(--fx-primary);
  font: inherit; font-size: 13px; cursor: pointer; padding: 0; margin-bottom: 8px; --mdc-icon-size: 18px; }
.title { font-size: 20px; font-weight: 600; margin: 0 0 4px; }

.btn { border: none; border-radius: 10px; padding: 9px 16px; font: inherit; font-weight: 500; cursor: pointer;
  background: var(--fx-primary); color: #fff; }
.btn.flat { background: none; color: var(--fx-primary); }
.btn.small { padding: 5px 10px; font-size: 13px; }
.btn.danger { color: var(--error-color, #db4437); }
.btn[disabled] { opacity: 0.5; cursor: default; }
.icon-btn { border: none; background: none; color: var(--fx-muted); cursor: pointer; padding: 4px; border-radius: 8px; --mdc-icon-size: 18px; display: inline-grid; place-items: center; }
.icon-btn:hover { color: var(--fx-text); background: var(--fx-divider); }
.control { display: flex; align-items: center; gap: 6px; }
.value { font-weight: 600; }

.hint { font-size: 13px; padding: 10px 12px; border-radius: 12px; background: color-mix(in srgb, #ff9800 12%, transparent); margin-bottom: 12px; }

/* Setup guide */
.steps { display: flex; gap: 6px; margin: 4px 0 14px; }
.steps span { flex: 1; font-size: 12px; text-align: center; padding-top: 6px; border-top: 3px solid var(--fx-divider); color: var(--fx-muted); }
.steps span.on { border-color: var(--fx-primary); color: var(--fx-text); font-weight: 600; }
.level-card { border: 1px solid var(--fx-divider); border-radius: 12px; padding: 10px; margin-bottom: 10px; }
.level-card .head { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
input[type="text"], input[type="number"], select {
  font: inherit; font-size: 14px; color: var(--fx-text); background: var(--fx-card);
  border: 1px solid var(--fx-divider); border-radius: 8px; padding: 7px 9px; min-width: 0;
}
input:focus, select:focus { outline: 2px solid color-mix(in srgb, var(--fx-primary) 50%, transparent); border-color: var(--fx-primary); }
.level-card .head input[type="text"] { flex: 1; font-weight: 600; }
.level-card .head input[type="number"] { width: 58px; }
.rooms-edit { display: flex; flex-direction: column; gap: 6px; padding-left: 6px; }
.rooms-edit .room-row { display: flex; gap: 6px; align-items: center; }
.rooms-edit .room-row input { flex: 1; }
.check { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid var(--fx-divider); border-radius: 12px; margin-bottom: 8px; cursor: pointer; }
.check input { width: 18px; height: 18px; accent-color: var(--fx-primary); }
.check .icon { --mdc-icon-size: 20px; color: var(--fx-muted); }
.check .badge { font-size: 11px; color: var(--fx-muted); margin-left: auto; }
.assign { display: flex; flex-direction: column; gap: 6px; }
.assign .item select { max-width: 150px; }
.stepper { display: flex; align-items: center; gap: 8px; margin-left: auto; }

/* Labels floating in the 3D scene */
.chip {
  display: flex; align-items: center; gap: 5px; padding: 4px 9px 4px 5px; border-radius: 999px; white-space: nowrap;
  background: var(--fx-card); color: var(--fx-text); font-size: 12px; font-weight: 600;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18); border: 1.5px solid var(--c); transform: translateY(-4px);
}
.chip ha-icon { --mdc-icon-size: 16px; color: var(--c); }
.room-label {
  display: flex; flex-direction: column; align-items: center; pointer-events: auto; cursor: pointer;
  background: color-mix(in srgb, var(--fx-card) 88%, transparent); border-radius: 10px; padding: 4px 9px;
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.15); font-size: 12px; line-height: 1.3; max-width: 140px; text-align: center;
}
.room-label b { font-weight: 600; }
.room-label span { color: var(--fx-muted); font-size: 11px; }
.room-label span:empty { display: none; }
.level-label { background: var(--fx-primary); color: #fff; font-size: 12px; font-weight: 600; padding: 3px 10px; border-radius: 999px; white-space: nowrap; }
.center-msg { position: absolute; inset: 0; display: grid; place-items: center; color: var(--fx-muted); }
`;
