"""Describes the house for the 3D panel.

The layout comes from Home Assistant itself: floors (stacked by level) hold
areas (rooms), and entities belong to a room directly or through their device.
The FUNCTION-X entities supply what goes around the house: solar on the roof,
battery, heat pump, car and grid.
"""

from __future__ import annotations

from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers import (
    area_registry as ar,
)
from homeassistant.helpers import (
    device_registry as dr,
)
from homeassistant.helpers import (
    entity_registry as er,
)
from homeassistant.helpers import (
    floor_registry as fr,
)

from .const import CONF_HOUSE, DOMAIN

# Entities worth showing in a room, with the device classes that matter
# (None = every entity of that domain).
ROOM_DOMAINS: dict[str, frozenset[str] | None] = {
    "light": None,
    "switch": None,
    "climate": None,
    "water_heater": None,
    "cover": None,
    "fan": None,
    "sensor": frozenset({"temperature", "humidity", "carbon_dioxide", "power"}),
    "binary_sensor": frozenset({"door", "window", "opening", "motion", "occupancy", "presence"}),
}

ENERGY_KEYS = (
    "pv_power",
    "grid_power",
    "home_power",
    "surplus_power",
    "battery_soc",
    "battery_power",
    "grid_price",
    "price_level",
    "decision",
)

DEMO_FLOORS = (
    ("Ground floor", ("Living room", "Kitchen", "Hallway", "Utility room")),
    ("First floor", ("Bedroom", "Kids room", "Bathroom", "Office")),
)


def _room_entities(
    hass: HomeAssistant,
) -> tuple[dict[str, list[dict[str, Any]]], list[dict[str, Any]]]:
    """Group relevant, visible entities by area id; also return those without a room."""
    ent_reg = er.async_get(hass)
    dev_reg = dr.async_get(hass)
    rooms: dict[str, list[dict[str, Any]]] = {}
    unassigned: list[dict[str, Any]] = []

    for entry in ent_reg.entities.values():
        if entry.platform == DOMAIN or entry.disabled_by or entry.hidden_by:
            continue
        if entry.entity_category is not None:
            continue
        if entry.domain not in ROOM_DOMAINS:
            continue
        device_class = entry.device_class or entry.original_device_class
        wanted = ROOM_DOMAINS[entry.domain]
        if wanted is not None and device_class not in wanted:
            continue

        area_id = entry.area_id
        if area_id is None and entry.device_id:
            device = dev_reg.async_get(entry.device_id)
            area_id = device.area_id if device else None
        info = {
            "entity_id": entry.entity_id,
            "domain": entry.domain,
            "device_class": device_class,
        }
        if area_id is None:
            unassigned.append(info)
        else:
            rooms.setdefault(area_id, []).append(info)

    for entities in (*rooms.values(), unassigned):
        entities.sort(key=lambda e: (e["domain"], e["entity_id"]))
    return rooms, unassigned


def _room(area: ar.AreaEntry, entities: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "id": area.id,
        "name": area.name,
        "icon": area.icon,
        "temperature_entity": area.temperature_entity_id,
        "humidity_entity": area.humidity_entity_id,
        "entities": entities,
    }


def _demo_floors() -> list[dict[str, Any]]:
    return [
        {
            "id": f"demo_{level}",
            "name": name,
            "level": level,
            "icon": None,
            "synthetic": True,
            "rooms": [
                {
                    "id": f"demo_{level}_{index}",
                    "name": room,
                    "icon": None,
                    "temperature_entity": None,
                    "humidity_entity": None,
                    "entities": [],
                    "synthetic": True,
                }
                for index, room in enumerate(rooms)
            ],
        }
        for level, (name, rooms) in enumerate(DEMO_FLOORS)
    ]


def _floors(
    hass: HomeAssistant, demo: bool, entities: dict[str, list[dict[str, Any]]]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], bool]:
    """Return (floors, rooms without a floor, whether the demo layout is used)."""
    floor_reg = fr.async_get(hass)
    area_reg = ar.async_get(hass)

    floor_entries = sorted(
        floor_reg.async_list_floors(),
        key=lambda f: (f.level is None, f.level if f.level is not None else 0, f.name),
    )
    areas = sorted(area_reg.async_list_areas(), key=lambda a: a.name)
    rooms_by_floor: dict[str | None, list[dict[str, Any]]] = {}
    for area in areas:
        rooms_by_floor.setdefault(area.floor_id, []).append(_room(area, entities.get(area.id, [])))

    if not floor_entries:
        if demo and not areas:
            return _demo_floors(), [], True
        # No floors configured: a single-storey house holding every room.
        return (
            [
                {
                    "id": "home",
                    "name": "Home",
                    "level": 0,
                    "icon": None,
                    "synthetic": True,
                    "rooms": rooms_by_floor.get(None, []),
                }
            ],
            [],
            False,
        )

    floors = [
        {
            "id": floor.floor_id,
            "name": floor.name,
            "level": floor.level,
            "icon": floor.icon,
            "rooms": rooms_by_floor.get(floor.floor_id, []),
        }
        for floor in floor_entries
    ]
    return floors, rooms_by_floor.get(None, []), False


def house_settings(entry) -> dict[str, Any]:
    return {
        "configured": False,
        "solar": None,
        "battery": None,
        "heat_pump": None,
        "cars": None,
        **entry.options.get(CONF_HOUSE, {}),
    }


def _pick(value: Any, detected: Any) -> Any:
    return detected if value is None else value


def describe_house(hass: HomeAssistant, entry) -> dict[str, Any]:
    """Everything the panel needs, except live states (it reads those itself)."""
    coordinator = entry.runtime_data
    ent_reg = er.async_get(hass)
    settings = house_settings(entry)

    def entity_id(platform: str, key: str) -> str | None:
        return ent_reg.async_get_entity_id(platform, DOMAIN, f"{entry.entry_id}_{key}")

    site = coordinator.data.site
    energy_entities = {key: entity_id("sensor", key) for key in ENERGY_KEYS}
    energy_entities["orchestration"] = entity_id("switch", "orchestration")
    energy_entities["heat_pump_boost"] = entity_id("binary_sensor", "heat_pump_boost")

    detected = {
        "solar": site.has_pv,
        "battery": site.battery_soc is not None,
        "heat_pump": coordinator.has_heat_pump,
        "cars": len(site.loadpoints),
    }
    room_entities, unassigned_entities = _room_entities(hass)
    floors, unassigned_rooms, demo_layout = _floors(hass, coordinator.is_demo, room_entities)
    return {
        "entry_id": entry.entry_id,
        "title": entry.title,
        "demo": coordinator.is_demo,
        "demo_layout": demo_layout,
        "settings": settings,
        "detected": detected,
        "floors": floors,
        "unassigned_rooms": unassigned_rooms,
        "unassigned_entities": unassigned_entities,
        "energy": {
            "has_solar": _pick(settings["solar"], detected["solar"]),
            "has_battery": _pick(settings["battery"], detected["battery"]),
            "has_heat_pump": _pick(settings["heat_pump"], detected["heat_pump"]),
            "cars": _pick(settings["cars"], detected["cars"]),
            "heat_pump_switch": coordinator.heat_pump_entity,
            "entities": {k: v for k, v in energy_entities.items() if v},
            "loadpoints": [
                {
                    "id": lp.id,
                    "title": lp.title,
                    "entity_id": entity_id("sensor", f"loadpoint_{lp.id}_power"),
                }
                for lp in site.loadpoints
            ],
        },
    }


class HouseSetupError(Exception):
    """The submitted house layout cannot be saved."""


def _check_unique(names: list[str], what: str) -> None:
    seen: set[str] = set()
    for name in names:
        key = name.strip().casefold()
        if not key:
            raise HouseSetupError(f"Every {what} needs a name")
        if key in seen:
            raise HouseSetupError(f"The {what} name '{name.strip()}' is used twice")
        seen.add(key)


def save_house(
    hass: HomeAssistant,
    entry,
    floors: list[dict[str, Any]],
    settings: dict[str, Any],
    delete_floors: list[str],
    delete_rooms: list[str],
) -> None:
    """Write the setup guide's result into Home Assistant's floors and areas.

    Existing floors and areas are updated in place. A new name that matches an
    existing floor or area reuses it, so typing "Kitchen" links the room that
    already exists. Only ids listed in delete_floors / delete_rooms are removed.
    """
    _check_unique([f["name"] for f in floors], "level")
    _check_unique([r["name"] for f in floors for r in f["rooms"]], "room")

    floor_reg = fr.async_get(hass)
    area_reg = ar.async_get(hass)

    try:
        for index, floor in enumerate(floors):
            name = floor["name"].strip()
            level = floor.get("level", index)
            existing = floor_reg.async_get_floor(floor.get("id") or "") or (
                floor_reg.async_get_floor_by_name(name)
            )
            if existing:
                floor_id = floor_reg.async_update(
                    existing.floor_id, name=name, level=level
                ).floor_id
            else:
                floor_id = floor_reg.async_create(name, level=level).floor_id

            for room in floor["rooms"]:
                room_name = room["name"].strip()
                area = area_reg.async_get_area(room.get("id") or "") or (
                    area_reg.async_get_area_by_name(room_name)
                )
                if area:
                    area_reg.async_update(area.id, name=room_name, floor_id=floor_id)
                else:
                    area_reg.async_create(room_name, floor_id=floor_id)
    except ValueError as err:
        raise HouseSetupError(str(err)) from err

    for area_id in delete_rooms:
        if area_reg.async_get_area(area_id):
            area_reg.async_delete(area_id)
    for floor_id in delete_floors:
        if floor_reg.async_get_floor(floor_id):
            floor_reg.async_delete(floor_id)

    hass.config_entries.async_update_entry(
        entry,
        options={
            **entry.options,
            CONF_HOUSE: {
                "configured": True,
                "solar": settings.get("solar"),
                "battery": settings.get("battery"),
                "heat_pump": settings.get("heat_pump"),
                "cars": settings.get("cars"),
            },
        },
    )


def assign_room(hass: HomeAssistant, entity_id: str, area_id: str | None) -> None:
    """Put an entity (and its whole device, if it has one) into a room."""
    ent_reg = er.async_get(hass)
    entry = ent_reg.async_get(entity_id)
    if entry is None:
        raise HouseSetupError(f"Unknown entity {entity_id}")
    if area_id is not None and ar.async_get(hass).async_get_area(area_id) is None:
        raise HouseSetupError(f"Unknown room {area_id}")
    if entry.device_id:
        dr.async_get(hass).async_update_device(entry.device_id, area_id=area_id)
        if entry.area_id is not None:
            ent_reg.async_update_entity(entity_id, area_id=None)
    else:
        ent_reg.async_update_entity(entity_id, area_id=area_id)
