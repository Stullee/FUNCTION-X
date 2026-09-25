"""FUNCTION-X Energy Orchestrator: makes separately bought energy devices work together."""

from __future__ import annotations

from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import CONF_API_KEY, CONF_EVCC_URL, CONF_SOURCE, SOURCE_DEMO
from .coordinator import FunctionXConfigEntry, FunctionXCoordinator
from .demo import DemoSite
from .evcc import EvccClient

PLATFORMS: list[Platform] = [Platform.BINARY_SENSOR, Platform.SENSOR, Platform.SWITCH]


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
    return True


async def async_unload_entry(hass: HomeAssistant, entry: FunctionXConfigEntry) -> bool:
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
