"""Sidebar panel with the 3D house, and the websocket command that feeds it."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import voluptuous as vol
from homeassistant.components import frontend, panel_custom, websocket_api
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant, callback

from .const import DOMAIN
from .house import HouseSetupError, assign_room, describe_house, save_house

PANEL_URL_PATH = "function-x"
PANEL_ELEMENT = "function-x-panel"
STATIC_URL = f"/{DOMAIN}_static"
FRONTEND_DIR = Path(__file__).parent / "frontend"
_DATA_STATIC_REGISTERED = f"{DOMAIN}_static_registered"


def _version() -> str:
    manifest = json.loads((Path(__file__).parent / "manifest.json").read_text())
    return manifest["version"]


def _loaded_entries(hass: HomeAssistant) -> list:
    return [
        entry
        for entry in hass.config_entries.async_entries(DOMAIN)
        if entry.state is ConfigEntryState.LOADED
    ]


async def async_register_panel(hass: HomeAssistant) -> None:
    """Serve the panel bundle and add FUNCTION-X to the sidebar."""
    if not hass.data.get(_DATA_STATIC_REGISTERED):
        await hass.http.async_register_static_paths(
            [StaticPathConfig(STATIC_URL, str(FRONTEND_DIR), cache_headers=False)]
        )
        hass.data[_DATA_STATIC_REGISTERED] = True

    if PANEL_URL_PATH in hass.data.get(frontend.DATA_PANELS, {}):
        return
    version = await hass.async_add_executor_job(_version)
    await panel_custom.async_register_panel(
        hass,
        frontend_url_path=PANEL_URL_PATH,
        webcomponent_name=PANEL_ELEMENT,
        sidebar_title="FUNCTION-X",
        sidebar_icon="mdi:home-lightning-bolt",
        module_url=f"{STATIC_URL}/function-x-panel.js?v={version}",
        require_admin=False,
    )


@callback
def async_unregister_panel(hass: HomeAssistant) -> None:
    """Remove the sidebar entry once no FUNCTION-X entry is loaded."""
    frontend.async_remove_panel(hass, PANEL_URL_PATH, warn_if_unknown=False)


@callback
def async_setup_websocket(hass: HomeAssistant) -> None:
    websocket_api.async_register_command(hass, ws_house)
    websocket_api.async_register_command(hass, ws_save_house)
    websocket_api.async_register_command(hass, ws_assign_room)


def _entry(hass: HomeAssistant, entry_id: str | None):
    entries = _loaded_entries(hass)
    if entry_id:
        entries = [e for e in entries if e.entry_id == entry_id]
    return entries[0] if entries else None


def _send_house(hass: HomeAssistant, connection, msg_id: int, entry) -> None:
    house = describe_house(hass, entry)
    house["entries"] = [{"entry_id": e.entry_id, "title": e.title} for e in _loaded_entries(hass)]
    connection.send_result(msg_id, house)


@websocket_api.websocket_command(
    {vol.Required("type"): "function_x/house", vol.Optional("entry_id"): str}
)
@callback
def ws_house(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    entry = _entry(hass, msg.get("entry_id"))
    if entry is None:
        connection.send_error(msg["id"], "not_found", "No FUNCTION-X setup is loaded")
        return
    _send_house(hass, connection, msg["id"], entry)


_ROOM = vol.Schema({vol.Optional("id"): vol.Any(str, None), vol.Required("name"): str})
_FLOOR = vol.Schema(
    {
        vol.Optional("id"): vol.Any(str, None),
        vol.Required("name"): str,
        vol.Required("level"): int,
        vol.Required("rooms"): [_ROOM],
    }
)
_SETTINGS = vol.Schema(
    {
        vol.Optional("solar"): vol.Any(bool, None),
        vol.Optional("battery"): vol.Any(bool, None),
        vol.Optional("heat_pump"): vol.Any(bool, None),
        vol.Optional("cars"): vol.Any(vol.All(int, vol.Range(min=0, max=4)), None),
    }
)


@websocket_api.websocket_command(
    {
        vol.Required("type"): "function_x/house/save",
        vol.Required("entry_id"): str,
        vol.Required("floors"): vol.All([_FLOOR], vol.Length(min=1, max=12)),
        vol.Required("settings"): _SETTINGS,
        vol.Optional("delete_floors", default=[]): [str],
        vol.Optional("delete_rooms", default=[]): [str],
    }
)
@websocket_api.require_admin
@callback
def ws_save_house(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    entry = _entry(hass, msg["entry_id"])
    if entry is None:
        connection.send_error(msg["id"], "not_found", "No FUNCTION-X setup is loaded")
        return
    try:
        save_house(
            hass,
            entry,
            msg["floors"],
            msg["settings"],
            msg["delete_floors"],
            msg["delete_rooms"],
        )
    except HouseSetupError as err:
        connection.send_error(msg["id"], "invalid_house", str(err))
        return
    _send_house(hass, connection, msg["id"], entry)


@websocket_api.websocket_command(
    {
        vol.Required("type"): "function_x/assign",
        vol.Required("entry_id"): str,
        vol.Required("entity_id"): str,
        vol.Required("area_id"): vol.Any(str, None),
    }
)
@websocket_api.require_admin
@callback
def ws_assign_room(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    entry = _entry(hass, msg["entry_id"])
    if entry is None:
        connection.send_error(msg["id"], "not_found", "No FUNCTION-X setup is loaded")
        return
    try:
        assign_room(hass, msg["entity_id"], msg["area_id"])
    except HouseSetupError as err:
        connection.send_error(msg["id"], "invalid_room", str(err))
        return
    _send_house(hass, connection, msg["id"], entry)
