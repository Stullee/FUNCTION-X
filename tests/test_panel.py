"""Tests for the sidebar panel and its websocket API."""

from homeassistant.components import frontend
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
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.function_x.const import (
    CONF_EV_CONTROL,
    CONF_HOUSE,
    CONF_SOURCE,
    DOMAIN,
    SOURCE_DEMO,
)
from custom_components.function_x.panel import FRONTEND_DIR, PANEL_URL_PATH


async def _setup(hass: HomeAssistant, **options) -> MockConfigEntry:
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="FUNCTION-X (demo)",
        data={CONF_SOURCE: SOURCE_DEMO},
        options={CONF_EV_CONTROL: True, **options},
        unique_id=SOURCE_DEMO,
    )
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


async def _ws(hass_ws_client: WebSocketGenerator, hass: HomeAssistant, **msg):
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(msg)
    return await client.receive_json()


def test_panel_bundle_is_shipped() -> None:
    bundle = FRONTEND_DIR / "function-x-panel.js"
    assert bundle.is_file()
    assert 'customElements.define("function-x-panel"' in bundle.read_text()


async def test_panel_registered_and_removed(hass: HomeAssistant) -> None:
    entry = await _setup(hass)
    panels = hass.data[frontend.DATA_PANELS]
    assert PANEL_URL_PATH in panels
    assert panels[PANEL_URL_PATH].sidebar_title == "FUNCTION-X"

    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()
    assert PANEL_URL_PATH not in hass.data[frontend.DATA_PANELS]


async def test_demo_house_without_floors(
    hass: HomeAssistant, hass_ws_client: WebSocketGenerator
) -> None:
    await _setup(hass)
    msg = await _ws(hass_ws_client, hass, type="function_x/house")
    assert msg["success"]
    house = msg["result"]
    assert house["demo_layout"] is True
    assert house["settings"]["configured"] is False
    assert [f["name"] for f in house["floors"]] == ["Ground floor", "First floor"]
    assert all(f["synthetic"] for f in house["floors"])
    energy = house["energy"]
    assert energy["has_solar"] and energy["has_battery"] and energy["has_heat_pump"]
    assert energy["cars"] == 1
    assert energy["entities"]["pv_power"] == "sensor.function_x_demo_solar_power"
    assert energy["loadpoints"][0]["entity_id"] == "sensor.function_x_demo_demo_car_charging_power"


async def test_house_from_floors_areas_and_devices(
    hass: HomeAssistant, hass_ws_client: WebSocketGenerator
) -> None:
    entry = await _setup(hass)
    floors = fr.async_get(hass)
    areas = ar.async_get(hass)
    upstairs = floors.async_create("Upstairs", level=1)
    downstairs = floors.async_create("Downstairs", level=0)
    kitchen = areas.async_create("Kitchen", floor_id=downstairs.floor_id)
    areas.async_create("Bedroom", floor_id=upstairs.floor_id)
    areas.async_create("Garage")

    # A light assigned through its device, and one without any room.
    ent_reg = er.async_get(hass)
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=entry.entry_id, identifiers={("test", "lamp")}
    )
    dr.async_get(hass).async_update_device(device.id, area_id=kitchen.id)
    ent_reg.async_get_or_create("light", "test", "lamp", device_id=device.id)
    ent_reg.async_get_or_create("light", "test", "garden")
    ent_reg.async_get_or_create("sensor", "test", "energy_total")  # not room-relevant

    house = (await _ws(hass_ws_client, hass, type="function_x/house"))["result"]
    assert house["demo_layout"] is False
    assert [f["name"] for f in house["floors"]] == ["Downstairs", "Upstairs"]
    kitchen_room = house["floors"][0]["rooms"][0]
    assert kitchen_room["name"] == "Kitchen"
    assert [e["entity_id"] for e in kitchen_room["entities"]] == ["light.test_lamp"]
    assert [r["name"] for r in house["unassigned_rooms"]] == ["Garage"]
    assert [e["entity_id"] for e in house["unassigned_entities"]] == ["light.test_garden"]


async def test_save_house_creates_floors_and_rooms(
    hass: HomeAssistant, hass_ws_client: WebSocketGenerator
) -> None:
    entry = await _setup(hass)
    existing = ar.async_get(hass).async_create("Kitchen")

    msg = await _ws(
        hass_ws_client,
        hass,
        type="function_x/house/save",
        entry_id=entry.entry_id,
        floors=[
            {
                "name": "Ground floor",
                "level": 0,
                "rooms": [{"name": "Kitchen"}, {"name": "Living room"}],
            },
            {"name": "First floor", "level": 1, "rooms": [{"name": "Bedroom"}]},
        ],
        settings={"solar": True, "battery": False, "heat_pump": True, "cars": 2},
    )
    assert msg["success"], msg
    house = msg["result"]
    assert house["settings"]["configured"] is True
    assert house["energy"]["has_battery"] is False
    assert house["energy"]["cars"] == 2
    assert [[r["name"] for r in f["rooms"]] for f in house["floors"]] == [
        ["Kitchen", "Living room"],
        ["Bedroom"],
    ]

    ground = fr.async_get(hass).async_get_floor_by_name("Ground floor")
    assert ground.level == 0
    # Typing an existing room's name reuses that area instead of failing.
    assert ar.async_get(hass).async_get_area(existing.id).floor_id == ground.floor_id
    assert entry.options[CONF_HOUSE]["cars"] == 2
    assert entry.options[CONF_EV_CONTROL] is True  # other options untouched


async def test_save_house_renames_and_deletes(
    hass: HomeAssistant, hass_ws_client: WebSocketGenerator
) -> None:
    entry = await _setup(hass)
    floors = fr.async_get(hass)
    areas = ar.async_get(hass)
    floor = floors.async_create("EG", level=0)
    old_floor = floors.async_create("Attic", level=2)
    room = areas.async_create("Wohnzimmer", floor_id=floor.floor_id)
    doomed = areas.async_create("Storage", floor_id=floor.floor_id)

    msg = await _ws(
        hass_ws_client,
        hass,
        type="function_x/house/save",
        entry_id=entry.entry_id,
        floors=[
            {
                "id": floor.floor_id,
                "name": "Erdgeschoss",
                "level": 0,
                "rooms": [{"id": room.id, "name": "Wohnzimmer & Küche"}],
            }
        ],
        settings={},
        delete_floors=[old_floor.floor_id],
        delete_rooms=[doomed.id],
    )
    assert msg["success"], msg
    assert floors.async_get_floor(floor.floor_id).name == "Erdgeschoss"
    assert areas.async_get_area(room.id).name == "Wohnzimmer & Küche"
    assert floors.async_get_floor(old_floor.floor_id) is None
    assert areas.async_get_area(doomed.id) is None


async def test_save_house_rejects_duplicate_rooms(
    hass: HomeAssistant, hass_ws_client: WebSocketGenerator
) -> None:
    entry = await _setup(hass)
    msg = await _ws(
        hass_ws_client,
        hass,
        type="function_x/house/save",
        entry_id=entry.entry_id,
        floors=[{"name": "Ground", "level": 0, "rooms": [{"name": "Bath"}, {"name": "bath "}]}],
        settings={},
    )
    assert not msg["success"]
    assert msg["error"]["code"] == "invalid_house"
    assert list(fr.async_get(hass).async_list_floors()) == []


async def test_save_requires_admin(
    hass: HomeAssistant, hass_ws_client: WebSocketGenerator, hass_read_only_access_token: str
) -> None:
    entry = await _setup(hass)
    client = await hass_ws_client(hass, hass_read_only_access_token)
    await client.send_json_auto_id(
        {
            "type": "function_x/house/save",
            "entry_id": entry.entry_id,
            "floors": [{"name": "Ground", "level": 0, "rooms": []}],
            "settings": {},
        }
    )
    msg = await client.receive_json()
    assert not msg["success"]
    assert msg["error"]["code"] == "unauthorized"


async def test_assign_moves_device_into_room(
    hass: HomeAssistant, hass_ws_client: WebSocketGenerator
) -> None:
    entry = await _setup(hass)
    area = ar.async_get(hass).async_create("Office")
    dev_reg = dr.async_get(hass)
    device = dev_reg.async_get_or_create(
        config_entry_id=entry.entry_id, identifiers={("test", "t")}
    )
    er.async_get(hass).async_get_or_create(
        "sensor", "test", "t", device_id=device.id, original_device_class="temperature"
    )
    er.async_get(hass).async_get_or_create("light", "test", "loose")

    msg = await _ws(
        hass_ws_client,
        hass,
        type="function_x/assign",
        entry_id=entry.entry_id,
        entity_id="sensor.test_t",
        area_id=area.id,
    )
    assert msg["success"], msg
    assert dev_reg.async_get(device.id).area_id == area.id

    msg = await _ws(
        hass_ws_client,
        hass,
        type="function_x/assign",
        entry_id=entry.entry_id,
        entity_id="light.test_loose",
        area_id=area.id,
    )
    assert msg["success"], msg
    assert er.async_get(hass).async_get("light.test_loose").area_id == area.id
    assert msg["result"]["unassigned_entities"] == []


async def test_options_flow_keeps_house_settings(hass: HomeAssistant) -> None:
    entry = await _setup(hass, **{CONF_HOUSE: {"configured": True, "cars": 2}})
    result = await hass.config_entries.options.async_init(entry.entry_id)
    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {CONF_EV_CONTROL: False}
    )
    result = await hass.config_entries.options.async_configure(
        result["flow_id"],
        {
            "hp_boost_export_w": 1500,
            "hp_stop_import_w": 300,
            "hp_min_on_minutes": 20,
            "hp_min_off_minutes": 10,
            "cheap_price_quantile": 25,
        },
    )
    await hass.async_block_till_done()
    assert entry.options[CONF_HOUSE] == {"configured": True, "cars": 2}
    assert entry.options[CONF_EV_CONTROL] is False
