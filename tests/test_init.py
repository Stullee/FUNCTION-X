"""End-to-end tests inside a real Home Assistant core."""

from datetime import timedelta

from freezegun.api import FrozenDateTimeFactory
from homeassistant import config_entries
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.setup import async_setup_component
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_fire_time_changed,
)
from pytest_homeassistant_custom_component.test_util.aiohttp import AiohttpClientMocker

from custom_components.function_x.const import (
    CONF_EV_CONTROL,
    CONF_EVCC_URL,
    CONF_HEAT_PUMP_SWITCH,
    CONF_HP_MIN_OFF_MIN,
    CONF_SOURCE,
    DOMAIN,
    SOURCE_DEMO,
    SOURCE_EVCC,
)

from .test_evcc import CURRENT

EVCC_URL = "http://evcc.local:7070"


async def _setup_demo(hass: HomeAssistant, **options) -> MockConfigEntry:
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


async def test_demo_creates_entities(hass: HomeAssistant) -> None:
    await _setup_demo(hass)

    assert float(hass.states.get("sensor.function_x_demo_solar_power").state) > 0
    assert hass.states.get("sensor.function_x_demo_battery").state == "96.0"
    assert hass.states.get("sensor.function_x_demo_demo_car_charging_power") is not None
    assert hass.states.get("binary_sensor.function_x_demo_heat_pump_boost_recommended")
    decision = hass.states.get("sensor.function_x_demo_decision")
    assert decision.attributes["orchestrating"] is False
    assert decision.attributes["decisions"]
    assert hass.states.get("switch.function_x_demo_orchestration").state == "off"


async def test_orchestration_drives_mapped_switch(hass: HomeAssistant) -> None:
    assert await async_setup_component(
        hass, "input_boolean", {"input_boolean": {"heat_pump": {"name": "Heat pump"}}}
    )
    # The helper was just created, so skip the compressor's minimum pause.
    await _setup_demo(
        hass, **{CONF_HEAT_PUMP_SWITCH: "input_boolean.heat_pump", CONF_HP_MIN_OFF_MIN: 0}
    )

    # The simulated house starts at 10:00 with a nearly full battery and spare solar.
    assert (
        hass.states.get("binary_sensor.function_x_demo_heat_pump_boost_recommended").state == "on"
    )
    assert hass.states.get("input_boolean.heat_pump").state == "off"  # shadow mode

    await hass.services.async_call(
        "switch", "turn_on", {"entity_id": "switch.function_x_demo_orchestration"}, blocking=True
    )
    await hass.async_block_till_done()
    assert hass.states.get("input_boolean.heat_pump").state == "on"


async def test_demo_updates_over_time(hass: HomeAssistant, freezer: FrozenDateTimeFactory) -> None:
    await _setup_demo(hass)
    battery = "sensor.function_x_demo_battery"
    assert hass.states.get(battery).state == "96.0"
    freezer.tick(timedelta(minutes=5))  # one simulated hour of sunshine
    async_fire_time_changed(hass)
    await hass.async_block_till_done()
    assert hass.states.get(battery).state == "100.0"


async def test_config_flow_demo(hass: HomeAssistant) -> None:
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": config_entries.SOURCE_USER}
    )
    assert result["type"] is FlowResultType.MENU
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"next_step_id": "demo"}
    )
    assert result["step_id"] == "roles"
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_EV_CONTROL: True}
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["data"] == {CONF_SOURCE: SOURCE_DEMO}
    await hass.async_block_till_done()


async def test_config_flow_evcc(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": config_entries.SOURCE_USER}
    )
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"next_step_id": "evcc"}
    )

    aioclient_mock.get(f"{EVCC_URL}/api/state", status=500)
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_EVCC_URL: EVCC_URL}
    )
    assert result["errors"] == {"base": "cannot_connect"}

    aioclient_mock.clear_requests()
    aioclient_mock.get(f"{EVCC_URL}/api/state", json=CURRENT)
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_EVCC_URL: EVCC_URL + "/"}
    )
    assert result["step_id"] == "roles"
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_EV_CONTROL: False}
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["data"][CONF_SOURCE] == SOURCE_EVCC
    assert result["data"][CONF_EVCC_URL] == EVCC_URL
    await hass.async_block_till_done()

    assert hass.states.get("sensor.function_x_grid_power").state == "-1500"
    assert hass.states.get("sensor.function_x_garage_charging_power").state == "4100"


async def test_evcc_sets_loadpoint_mode(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker
) -> None:
    idle_car = {**CURRENT["loadpoints"][0], "charging": False, "chargePower": 0}
    cheap_now = {
        **CURRENT,
        "loadpoints": [idle_car],
        "tariffGrid": 0.10,
        "forecast": {
            "grid": [
                [
                    int(dt_util.utcnow().timestamp()) + i * 3600,
                    int(dt_util.utcnow().timestamp()) + (i + 1) * 3600,
                    p,
                ]
                for i, p in enumerate([0.10, 0.30, 0.35, 0.40, 0.30, 0.30])
            ]
        },
    }
    aioclient_mock.get(f"{EVCC_URL}/api/state", json=cheap_now)
    aioclient_mock.post(f"{EVCC_URL}/api/loadpoints/1/mode/now", json={"result": "now"})
    entry = MockConfigEntry(
        domain=DOMAIN,
        data={CONF_SOURCE: SOURCE_EVCC, CONF_EVCC_URL: EVCC_URL},
        options={CONF_EV_CONTROL: True},
    )
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    assert not any(m == "POST" for m, *_ in aioclient_mock.mock_calls)
    await entry.runtime_data.async_set_orchestration(True)
    await hass.async_block_till_done()
    posts = [str(url) for m, url, *_ in aioclient_mock.mock_calls if m == "POST"]
    assert posts == [f"{EVCC_URL}/api/loadpoints/1/mode/now"]


async def test_demo_day_story(hass: HomeAssistant) -> None:
    """Midday solar goes to the heat pump; the car charges in the cheap night."""
    from custom_components.function_x.demo import DEMO_SPEED, DemoSite
    from custom_components.function_x.optimizer import (
        HeatPumpSnapshot,
        HomeSnapshot,
        Settings,
        optimize,
    )

    site = DemoSite()
    start = site._started
    boost_hours, now_hours = set(), set()
    for step in range(24 * 4):  # every simulated 15 min
        when = start + timedelta(hours=step / 4 / DEMO_SPEED)
        state = site.state_at(when)
        plan = optimize(
            HomeSnapshot(
                now=when,
                pv_power=state.pv_power,
                grid_power=state.grid_power,
                home_power=state.home_power,
                battery_soc=state.battery_soc,
                battery_power=state.battery_power,
                grid_price=state.grid_price,
                price_forecast=state.price_forecast,
                loadpoints=state.loadpoints,
                heat_pump=HeatPumpSnapshot(site.heat_pump_boost, None),
                managed_now=frozenset({1}),
            ),
            Settings(),
        )
        site.heat_pump_boost = bool(plan.heat_pump_boost)
        hour = int(site.sim_hour(when))
        if plan.heat_pump_boost:
            boost_hours.add(hour)
        if plan.loadpoint_modes.get(1) == "now":
            now_hours.add(hour)
            await site.async_set_loadpoint_mode(1, "now")
        elif 1 in plan.loadpoint_modes:
            await site.async_set_loadpoint_mode(1, plan.loadpoint_modes[1])

    assert boost_hours & {11, 12, 13, 14}
    assert not boost_hours & {19, 20, 21}  # no boost on battery after sunset
    assert now_hours
    assert not now_hours & {17, 18, 19, 20}  # never fast-charge at the evening peak


async def test_demo_dashboard_entities_exist(hass: HomeAssistant) -> None:
    import re
    from pathlib import Path

    await _setup_demo(hass)
    dashboard = (Path(__file__).parent.parent / "dashboards" / "function_x_demo.yaml").read_text()
    entity_ids = set(
        re.findall(r"\b(?:sensor|binary_sensor|switch)\.function_x_demo_\w+", dashboard)
    )
    assert entity_ids
    assert {e for e in entity_ids if hass.states.get(e) is None} == set()
