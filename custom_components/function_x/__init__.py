"""FUNCTION-X Energy Orchestrator: makes separately bought energy devices work together."""

from __future__ import annotations

from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.typing import ConfigType

from .const import CONF_API_KEY, CONF_EVCC_URL, CONF_SOURCE, DOMAIN, SOURCE_DEMO
from .coordinator import FunctionXConfigEntry, FunctionXCoordinator
from .demo import DemoSite
from .evcc import EvccClient
from .panel import async_register_panel, async_setup_websocket, async_unregister_panel

PLATFORMS: list[Platform] = [Platform.BINARY_SENSOR, Platform.SENSOR, Platform.SWITCH]

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    async_setup_websocket(hass)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: FunctionXConfigEntry) -> bool:
    if entry.data.get(CONF_SOURCE) == SOURCE_DEMO:
        source: EvccClient | DemoSite = DemoSite()
    else:
        source = EvccClient(
            async_get_clientsession(hass),
            entry.data[CONF_EVCC_URL],
            entry.data.get(CONF_API_KEY),
        )

    coordinator = FunctionXCoordinator(hass, entry, source)
    await coordinator.async_config_entry_first_refresh()
    entry.runtime_data = coordinator

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    await async_register_panel(hass)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: FunctionXConfigEntry) -> bool:
    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    others = [
        e for e in hass.config_entries.async_loaded_entries(DOMAIN) if e.entry_id != entry.entry_id
    ]
    if unloaded and not others:
        async_unregister_panel(hass)
    return unloaded
