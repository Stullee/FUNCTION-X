"""Heat pump boost recommendation."""

from __future__ import annotations

from homeassistant.components.binary_sensor import BinarySensorEntity
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .coordinator import FunctionXConfigEntry, FunctionXCoordinator
from .entity import FunctionXEntity

PARALLEL_UPDATES = 0


async def async_setup_entry(
    hass: HomeAssistant,
    entry: FunctionXConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    coordinator = entry.runtime_data
    if coordinator.has_heat_pump:
        async_add_entities([HeatPumpBoostSensor(coordinator)])


class HeatPumpBoostSensor(FunctionXEntity, BinarySensorEntity):
    """On when the orchestrator wants the heat pump boosted (SG Ready state 3)."""

    def __init__(self, coordinator: FunctionXCoordinator) -> None:
        super().__init__(coordinator, "heat_pump_boost")

    @property
    def is_on(self) -> bool | None:
        return self.coordinator.data.plan.heat_pump_boost

    @property
    def extra_state_attributes(self) -> dict[str, str]:
        decision = next(
            (d for d in self.coordinator.data.plan.decisions if d.device == "Heat pump"),
            None,
        )
        return {"reason": decision.reason} if decision else {}
