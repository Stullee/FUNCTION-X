"""Tests for the pure orchestration logic."""

from datetime import UTC, datetime, timedelta

from custom_components.function_x.optimizer import (
    MODE_NOW,
    MODE_OFF,
    MODE_SOLAR,
    PRICE_CHEAP,
    PRICE_NORMAL,
    PRICE_UNKNOWN,
    HeatPumpSnapshot,
    HomeSnapshot,
    LoadpointSnapshot,
    PriceSlot,
    Settings,
    optimize,
)

NOW = datetime(2026, 6, 1, 12, 0, tzinfo=UTC)
LONG_AGO = NOW - timedelta(hours=2)


def _forecast(prices):
    return [
        PriceSlot(NOW + timedelta(hours=i), NOW + timedelta(hours=i + 1), p)
        for i, p in enumerate(prices)
    ]


def _snap(**kwargs) -> HomeSnapshot:
    base = {"now": NOW, "pv_power": 0, "grid_power": 0, "home_power": 500}
    return HomeSnapshot(**{**base, **kwargs})


def _car(mode=MODE_SOLAR, **kwargs) -> LoadpointSnapshot:
    base = {
        "id": 1,
        "title": "Car",
        "mode": mode,
        "connected": True,
        "charging": False,
        "charge_power": 0,
        "vehicle_soc": 40,
        "limit_soc": 80,
    }
    return LoadpointSnapshot(**{**base, **kwargs})


def test_heat_pump_boosts_on_solar_surplus():
    plan = optimize(
        _snap(grid_power=-2500, heat_pump=HeatPumpSnapshot(False, LONG_AGO)), Settings()
    )
    assert plan.heat_pump_boost is True
    assert plan.decisions[0].action == "boost on"
    assert "2500 W" in plan.decisions[0].reason


def test_heat_pump_stays_off_with_small_surplus():
    plan = optimize(_snap(grid_power=-500, heat_pump=HeatPumpSnapshot(False, LONG_AGO)), Settings())
    assert plan.heat_pump_boost is False
    assert plan.decisions[0].action == "keep"


def test_full_battery_charge_counts_as_surplus():
    snap = _snap(
        grid_power=-600,
        battery_soc=97,
        battery_power=-1200,
        heat_pump=HeatPumpSnapshot(False, LONG_AGO),
    )
    plan = optimize(snap, Settings())
    assert plan.surplus_power == 1800
    assert plan.heat_pump_boost is True


def test_running_boost_stops_on_grid_import():
    plan = optimize(_snap(grid_power=800, heat_pump=HeatPumpSnapshot(True, LONG_AGO)), Settings())
    assert plan.heat_pump_boost is False
    assert plan.decisions[0].action == "boost off"


def test_running_boost_does_not_drain_battery():
    plan = optimize(
        _snap(
            grid_power=0,
            battery_soc=80,
            battery_power=1800,
            heat_pump=HeatPumpSnapshot(True, LONG_AGO),
        ),
        Settings(),
    )
    assert plan.heat_pump_boost is False
    assert "1800 W from the battery" in plan.decisions[0].reason


def test_running_boost_continues_with_small_import():
    plan = optimize(_snap(grid_power=100, heat_pump=HeatPumpSnapshot(True, LONG_AGO)), Settings())
    assert plan.heat_pump_boost is True


def test_min_on_time_protects_compressor():
    started = NOW - timedelta(minutes=5)
    plan = optimize(_snap(grid_power=2000, heat_pump=HeatPumpSnapshot(True, started)), Settings())
    assert plan.heat_pump_boost is True
    assert "15 min" in plan.decisions[0].reason


def test_price_level():
    prices = [0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.55]
    assert (
        optimize(_snap(grid_price=0.20, price_forecast=_forecast(prices)), Settings()).price_level
        == PRICE_CHEAP
    )
    assert (
        optimize(_snap(grid_price=0.40, price_forecast=_forecast(prices)), Settings()).price_level
        == PRICE_NORMAL
    )
    assert optimize(_snap(grid_price=0.20), Settings()).price_level == PRICE_UNKNOWN


def test_fixed_tariff_is_never_cheap():
    flat = _forecast([0.32] * 24)
    assert (
        optimize(_snap(grid_price=0.32, price_forecast=flat), Settings()).price_level
        == PRICE_NORMAL
    )


def test_cheap_price_charges_car_now():
    prices = [0.20, 0.30, 0.30, 0.30, 0.30, 0.30, 0.30, 0.30]
    plan = optimize(
        _snap(grid_price=0.20, price_forecast=_forecast(prices), loadpoints=[_car()]),
        Settings(),
    )
    assert plan.loadpoint_modes == {1: MODE_NOW}
    assert plan.decisions[0].action == "charge now"


def test_solar_charging_beats_cheap_grid():
    prices = [0.20] + [0.30] * 7
    plan = optimize(
        _snap(
            grid_price=0.20,
            price_forecast=_forecast(prices),
            loadpoints=[_car(charging=True, charge_power=3000)],
        ),
        Settings(),
    )
    assert plan.loadpoint_modes == {1: MODE_SOLAR}
    assert plan.decisions[0].action == "keep"


def test_user_choices_are_respected():
    prices = [0.20] + [0.30] * 7
    snap = _snap(
        grid_price=0.20,
        price_forecast=_forecast(prices),
        loadpoints=[_car(mode=MODE_OFF), _car(id=2, mode=MODE_NOW)],
    )
    plan = optimize(snap, Settings())
    assert plan.loadpoint_modes == {}
    assert [d.action for d in plan.decisions] == ["skip", "skip"]


def test_managed_fast_charge_returns_to_solar():
    prices = [0.40] + [0.30] * 7
    snap = _snap(
        grid_price=0.40,
        price_forecast=_forecast(prices),
        loadpoints=[_car(mode=MODE_NOW)],
        managed_now=frozenset({1}),
    )
    assert optimize(snap, Settings()).loadpoint_modes == {1: MODE_SOLAR}


def test_ev_control_can_be_disabled():
    plan = optimize(_snap(loadpoints=[_car()]), Settings(ev_control=False))
    assert plan.loadpoint_modes == {}
    assert plan.decisions == []
