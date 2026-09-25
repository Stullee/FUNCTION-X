"""The master switch: off = shadow mode (decide and explain only), on = act."""

from __future__ import annotations

from typing import Any

from homeassistant.components.switch import SwitchEntity
from homeassistant.const import STATE_ON
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.restore_state import RestoreEntity

from .coordinator import FunctionXConfigEntry, FunctionXCoordinator
from .entity import FunctionXEntity

PARALLEL_UPDATES = 0


async def async_setup_entry(
    hass: HomeAssistant,
    entry: FunctionXConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    async_add_entities([OrchestrationSwitch(entry.runtime_data)])


class OrchestrationSwitch(FunctionXEntity, SwitchEntity, RestoreEntity):
    def __init__(self, coordinator: FunctionXCoordinator) -> None:
        super().__init__(coordinator, "orchestration")

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        last = await self.async_get_last_state()
        if last is not None and last.state == STATE_ON:
            await self.coordinator.async_set_orchestration(True)

    @property
    def is_on(self) -> bool:
        return self.coordinator.orchestration_enabled

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self.coordinator.async_set_orchestration(True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self.coordinator.async_set_orchestration(False)
