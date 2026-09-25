"""Base entity for FUNCTION-X."""

from __future__ import annotations

from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN, MANUFACTURER
from .coordinator import FunctionXCoordinator


class FunctionXEntity(CoordinatorEntity[FunctionXCoordinator]):
    _attr_has_entity_name = True

    def __init__(self, coordinator: FunctionXCoordinator, key: str) -> None:
        super().__init__(coordinator)
        entry = coordinator.config_entry
        self._attr_unique_id = f"{entry.entry_id}_{key}"
        self._attr_translation_key = key
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry.entry_id)},
            name=entry.title,
            manufacturer=MANUFACTURER,
            model="Demo house" if coordinator.is_demo else "evcc",
            sw_version=coordinator.data.site.version if coordinator.data else None,
        )
