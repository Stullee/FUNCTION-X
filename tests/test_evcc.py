"""Tests for evcc state parsing across API versions."""

from custom_components.function_x.evcc import parse_state
from custom_components.function_x.optimizer import MODE_NOW, MODE_SOLAR

CURRENT = {
    "siteTitle": "Home",
    "version": "0.300.0",
    "currency": "EUR",
    "pvPower": 5200,
    "homePower": 700,
    "grid": {"power": -1500},
    "battery": {"soc": 80, "power": -3000},
    "tariffGrid": 0.28,
    "forecast": {"grid": [[1780000000, 1780000900, 0.25], [1780000900, 1780001800, 0.3]]},
    "loadpoints": [
        {
            "title": "Garage",
            "mode": "smart",
            "connected": True,
            "charging": True,
            "chargePower": 4100,
            "vehicleSoc": 55,
            "effectiveLimitSoc": 80,
        }
    ],
}

LEGACY = {
    "result": {
        "pvPower": 3000,
        "gridPower": 200,
        "homePower": 900,
        "batterySoc": 30,
        "batteryPower": 500,
        "loadpoints": [{"mode": "now", "connected": False, "chargePower": 0}],
    }
}


def test_parse_current_shape():
    state = parse_state(CURRENT)
    assert state.grid_power == -1500
    assert state.battery_soc == 80
    assert state.battery_power == -3000
    assert state.grid_price == 0.28
    assert [s.price for s in state.price_forecast] == [0.25, 0.3]
    lp = state.loadpoints[0]
    assert (lp.id, lp.title, lp.mode, lp.charge_power) == (1, "Garage", MODE_SOLAR, 4100)


def test_parse_legacy_shape():
    state = parse_state(LEGACY)
    assert state.grid_power == 200
    assert state.battery_soc == 30
    assert state.grid_price is None
    assert state.loadpoints[0].mode == MODE_NOW
    assert state.loadpoints[0].title == "Loadpoint 1"


def test_parse_without_battery():
    state = parse_state({"pvPower": 0, "grid": {"power": 300}})
    assert state.battery_soc is None
    assert state.loadpoints == []
