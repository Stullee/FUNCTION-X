"""Sensors: the house at a glance plus what the orchestrator decided and why."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import asdict, dataclass
from typing import Any

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorEntityDescription,
    SensorStateClass,
)
from homeassistant.const import PERCENTAGE, UnitOfPower
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .coordinator import FunctionXConfigEntry, FunctionXCoordinator, FunctionXData
from .entity import FunctionXEntity
from .optimizer import PRICE_CHEAP, PRICE_NORMAL, PRICE_UNKNOWN

PARALLEL_UPDATES = 0


@dataclass(frozen=True, kw_only=True)
class FunctionXSensorDescription(SensorEntityDescription):
    value_fn: Callable[[FunctionXData], Any]
    exists_fn: Callable[[FunctionXData], bool] = lambda _: True


def _watts(value: float | None) -> int | None:
    return None if value is None else round(value)


def _power(
    key: str,
    value_fn: Callable[[FunctionXData], float | None],
    exists_fn: Callable[[FunctionXData], bool] = lambda _: True,
) -> FunctionXSensorDescription:
    return FunctionXSensorDescription(
        key=key,
        device_class=SensorDeviceClass.POWER,
        state_class=SensorStateClass.MEASUREMENT,
        native_unit_of_measurement=UnitOfPower.WATT,
        value_fn=lambda d: _watts(value_fn(d)),
        exists_fn=exists_fn,
    )


SENSORS: tuple[FunctionXSensorDescription, ...] = (
    _power("pv_power", lambda d: d.site.pv_power),
    _power("grid_power", lambda d: d.site.grid_power),
    _power("home_power", lambda d: d.site.home_power),
    _power("surplus_power", lambda d: d.plan.surplus_power),
    FunctionXSensorDescription(
        key="battery_soc",
        device_class=SensorDeviceClass.BATTERY,
        state_class=SensorStateClass.MEASUREMENT,
        native_unit_of_measurement=PERCENTAGE,
        value_fn=lambda d: d.site.battery_soc,
        exists_fn=lambda d: d.site.battery_soc is not None,
    ),
    _power(
        "battery_power",
        lambda d: d.site.battery_power,
        exists_fn=lambda d: d.site.battery_power is not None,
    ),
    FunctionXSensorDescription(
        key="grid_price",
        state_class=SensorStateClass.MEASUREMENT,
        suggested_display_precision=3,
        value_fn=lambda d: d.site.grid_price,
        exists_fn=lambda d: d.site.grid_price is not None,
    ),
    FunctionXSensorDescription(
        key="price_level",
        device_class=SensorDeviceClass.ENUM,
        options=[PRICE_CHEAP, PRICE_NORMAL, PRICE_UNKNOWN],
        value_fn=lambda d: d.plan.price_level,
    ),
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: FunctionXConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    coordinator = entry.runtime_data
    entities: list[SensorEntity] = [
        FunctionXSensor(coordinator, description)
        for description in SENSORS
        if description.exists_fn(coordinator.data)
    ]
    entities.append(DecisionSensor(coordinator))
    entities.extend(
        LoadpointPowerSensor(coordinator, lp.id, lp.title)
        for lp in coordinator.data.site.loadpoints
    )
    async_add_entities(entities)


class FunctionXSensor(FunctionXEntity, SensorEntity):
    entity_description: FunctionXSensorDescription

    def __init__(
        self, coordinator: FunctionXCoordinator, description: FunctionXSensorDescription
    ) -> None:
        super().__init__(coordinator, description.key)
        self.entity_description = description
        if description.key == "grid_price" and coordinator.data.site.currency:
            self._attr_native_unit_of_measurement = f"{coordinator.data.site.currency}/kWh"

    @property
    def native_value(self) -> Any:
        return self.entity_description.value_fn(self.coordinator.data)


class DecisionSensor(FunctionXEntity, SensorEntity):
    """What the orchestrator wants to change right now, with its reasoning."""

    def __init__(self, coordinator: FunctionXCoordinator) -> None:
        super().__init__(coordinator, "decision")

    @property
    def native_value(self) -> str:
        return self.coordinator.data.plan.summary[:255]

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        data = self.coordinator.data
        return {
            "orchestrating": data.orchestrating,
            "decisions": [asdict(d) for d in data.plan.decisions],
            "explanation": "\n".join(
                f"{d.device}: {d.action} – {d.reason}" for d in data.plan.decisions
            ),
            "errors": data.errors,
        }


class LoadpointPowerSensor(FunctionXEntity, SensorEntity):
    _attr_device_class = SensorDeviceClass.POWER
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_native_unit_of_measurement = UnitOfPower.WATT

    def __init__(self, coordinator: FunctionXCoordinator, lp_id: int, title: str) -> None:
        super().__init__(coordinator, f"loadpoint_{lp_id}_power")
        self._lp_id = lp_id
        self._attr_translation_key = "loadpoint_power"
        self._attr_translation_placeholders = {"name": title}

    def _loadpoint(self):
        return next(
            (lp for lp in self.coordinator.data.site.loadpoints if lp.id == self._lp_id),
            None,
        )

    @property
    def available(self) -> bool:
        return super().available and self._loadpoint() is not None

    @property
    def native_value(self) -> int | None:
        lp = self._loadpoint()
        return _watts(lp.charge_power) if lp else None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        lp = self._loadpoint()
        if lp is None:
            return {}
        return {
            "mode": lp.mode,
            "connected": lp.connected,
            "charging": lp.charging,
            "vehicle_soc": lp.vehicle_soc,
            "limit_soc": lp.limit_soc,
        }
