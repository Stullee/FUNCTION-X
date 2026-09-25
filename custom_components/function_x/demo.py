"""Simulated house, so the integration can be tried without evcc or hardware.

It starts on a sunny late morning with the home battery nearly full, so there
is spare solar to put to work right away. The car is out during the day, comes
home at 17:00 (price peak) and leaves at 08:00, so it has to be charged in
the cheap night hours. The simulated clock runs DEMO_SPEED
times faster than real time from 10:00, so a full solar day and price cycle
pass in about two real hours. Price forecast slots are still stamped in real
time, which is what the optimizer compares against.
"""

from __future__ import annotations

import math
import random
from datetime import datetime, timedelta

from homeassistant.util import dt as dt_util

from .evcc import SiteState
from .optimizer import MODE_NOW, MODE_OFF, MODE_SOLAR, LoadpointSnapshot, PriceSlot

DEMO_SPEED = 12
_START_HOUR = 10.0

_PV_PEAK_W = 8000
_BASE_LOAD_W = 450
_HEAT_PUMP_BOOST_W = 2200
_EV_MAX_W = 11000
_EV_MIN_W = 1400
_EV_CAPACITY_KWH = 60
_EV_LIMIT_SOC = 90
_EV_ARRIVAL_SOC = 40.0
_EV_HOME_FROM = 17
_EV_HOME_UNTIL = 8
_BATTERY_CAPACITY_KWH = 10
_BATTERY_MAX_W = 5000
_BATTERY_MIN_SOC = 10
_SLOT = timedelta(minutes=15)


def _pv_power(hour: float) -> float:
    """Clear-sky bell curve between 06:00 and 20:00."""
    if not 6 <= hour <= 20:
        return 0.0
    return _PV_PEAK_W * math.sin(math.pi * (hour - 6) / 14) ** 2


def _price(hour: float) -> float:
    """Dynamic tariff shape: cheap at midday and night, expensive in the evening."""
    evening_peak = 0.10 * math.exp(-(((hour - 19) / 2.5) ** 2))
    solar_dip = 0.08 * math.exp(-(((hour - 13) / 2.5) ** 2))
    night_dip = 0.04 * math.exp(-(((hour - 3) / 2.5) ** 2))
    return round(0.30 + evening_peak - solar_dip - night_dip, 4)


class DemoSite:
    """Stands in for EvccClient."""

    base_url = "demo"

    def __init__(self, now: datetime | None = None) -> None:
        self._started = now or dt_util.utcnow()
        self._last = self._started
        self._battery_soc = 96.0
        self._vehicle_soc = _EV_ARRIVAL_SOC
        self._car_home = False
        self._mode = MODE_SOLAR
        self._rng = random.Random(42)
        # Used when no real heat pump switch is mapped: the demo simulates one.
        self.heat_pump_boost = False
        self.heat_pump_changed_at: datetime | None = None

    def sim_hour(self, now: datetime) -> float:
        elapsed_h = (now - self._started).total_seconds() / 3600 * DEMO_SPEED
        return (_START_HOUR + elapsed_h) % 24

    def _forecast(self, now: datetime) -> list[PriceSlot]:
        start = now.replace(second=0, microsecond=0)
        start -= timedelta(minutes=start.minute % 15)
        return [
            PriceSlot(
                start + i * _SLOT,
                start + (i + 1) * _SLOT,
                _price(self.sim_hour(start + i * _SLOT + _SLOT / 2)),
            )
            for i in range(96)
        ]

    def state_at(self, now: datetime) -> SiteState:
        hours = (now - self._last).total_seconds() / 3600 * DEMO_SPEED
        self._last = now
        hour = self.sim_hour(now)

        pv = _pv_power(hour) * (0.9 + 0.1 * self._rng.random())
        home = _BASE_LOAD_W + 150 * self._rng.random()
        if self.heat_pump_boost:
            home += _HEAT_PUMP_BOOST_W

        car_home = hour >= _EV_HOME_FROM or hour < _EV_HOME_UNTIL
        if car_home and not self._car_home:
            self._vehicle_soc = _EV_ARRIVAL_SOC  # back from a day of driving
        self._car_home = car_home

        ev = 0.0
        if car_home and self._vehicle_soc < _EV_LIMIT_SOC and self._mode != MODE_OFF:
            if self._mode == MODE_NOW:
                ev = _EV_MAX_W
            else:
                spare = pv - home
                ev = min(_EV_MAX_W, spare) if spare >= _EV_MIN_W else 0.0
        self._vehicle_soc = min(
            float(_EV_LIMIT_SOC),
            self._vehicle_soc + ev / 1000 * hours / _EV_CAPACITY_KWH * 100,
        )

        # Positive battery power = discharging (evcc convention). Like evcc's
        # battery discharge control, fast charging never empties the battery.
        balance = home + ev - pv
        battery_balance = balance - ev if self._mode == MODE_NOW else balance
        if battery_balance < 0 and self._battery_soc < 100:
            battery = max(battery_balance, -_BATTERY_MAX_W)
        elif battery_balance > 0 and self._battery_soc > _BATTERY_MIN_SOC:
            battery = min(battery_balance, _BATTERY_MAX_W)
        else:
            battery = 0.0
        self._battery_soc -= battery / 1000 * hours / _BATTERY_CAPACITY_KWH * 100
        self._battery_soc = min(100.0, max(float(_BATTERY_MIN_SOC), self._battery_soc))

        forecast = self._forecast(now)
        return SiteState(
            site_title="Demo house",
            version="demo",
            currency="EUR",
            pv_power=round(pv),
            grid_power=round(balance - battery),
            home_power=round(home),
            battery_soc=round(self._battery_soc, 1),
            battery_power=round(battery),
            grid_price=_price(hour),
            feed_in_price=0.08,
            has_pv=True,
            price_forecast=forecast,
            loadpoints=[
                LoadpointSnapshot(
                    id=1,
                    title="Demo car",
                    mode=self._mode,
                    connected=car_home,
                    charging=ev > 0,
                    charge_power=round(ev),
                    vehicle_soc=round(self._vehicle_soc, 1),
                    limit_soc=_EV_LIMIT_SOC,
                )
            ],
        )

    async def async_get_state(self) -> SiteState:
        return self.state_at(dt_util.utcnow())

    async def async_set_loadpoint_mode(self, loadpoint_id: int, mode: str) -> None:
        self._mode = mode
