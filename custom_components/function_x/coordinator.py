"""Polls the site, runs the optimizer and applies its plan."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import STATE_ON, STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed
from homeassistant.util import dt as dt_util

from .const import (
    CONF_CHEAP_QUANTILE,
    CONF_EV_CONTROL,
    CONF_HEAT_PUMP_SWITCH,
    CONF_HP_BOOST_EXPORT_W,
    CONF_HP_MIN_OFF_MIN,
    CONF_HP_MIN_ON_MIN,
    CONF_HP_STOP_IMPORT_W,
    CONF_PRICE_SENSOR,
    DEFAULT_CHEAP_QUANTILE,
    DEFAULT_EV_CONTROL,
    DEFAULT_HP_BOOST_EXPORT_W,
    DEFAULT_HP_MIN_OFF_MIN,
    DEFAULT_HP_MIN_ON_MIN,
    DEFAULT_HP_STOP_IMPORT_W,
    DOMAIN,
    UPDATE_INTERVAL,
)
from .demo import DemoSite
from .evcc import EvccAuthError, EvccClient, EvccError, SiteState
from .optimizer import MODE_NOW, HeatPumpSnapshot, HomeSnapshot, Plan, Settings, optimize

_LOGGER = logging.getLogger(__name__)

type FunctionXConfigEntry = ConfigEntry[FunctionXCoordinator]


@dataclass
class FunctionXData:
    site: SiteState
    plan: Plan
    updated_at: datetime
    orchestrating: bool
    errors: list[str] = field(default_factory=list)


def settings_from_options(options: dict) -> Settings:
    return Settings(
        hp_boost_export_w=options.get(CONF_HP_BOOST_EXPORT_W, DEFAULT_HP_BOOST_EXPORT_W),
        hp_stop_import_w=options.get(CONF_HP_STOP_IMPORT_W, DEFAULT_HP_STOP_IMPORT_W),
        hp_min_on=timedelta(minutes=options.get(CONF_HP_MIN_ON_MIN, DEFAULT_HP_MIN_ON_MIN)),
        hp_min_off=timedelta(minutes=options.get(CONF_HP_MIN_OFF_MIN, DEFAULT_HP_MIN_OFF_MIN)),
        cheap_quantile=options.get(CONF_CHEAP_QUANTILE, DEFAULT_CHEAP_QUANTILE) / 100,
        ev_control=options.get(CONF_EV_CONTROL, DEFAULT_EV_CONTROL),
    )


class FunctionXCoordinator(DataUpdateCoordinator[FunctionXData]):
    """Every UPDATE_INTERVAL: read the house, decide, act.

    Orchestration starts switched off ("shadow mode"): decisions are computed
    and shown but nothing is changed until the user turns it on.
    """

    config_entry: FunctionXConfigEntry

    def __init__(
        self,
        hass: HomeAssistant,
        entry: FunctionXConfigEntry,
        source: EvccClient | DemoSite,
    ) -> None:
        super().__init__(
            hass,
            _LOGGER,
            config_entry=entry,
            name=DOMAIN,
            update_interval=UPDATE_INTERVAL,
        )
        self.source = source
        self.settings = settings_from_options(dict(entry.options))
        self.heat_pump_entity: str | None = entry.options.get(CONF_HEAT_PUMP_SWITCH)
        self.price_entity: str | None = entry.options.get(CONF_PRICE_SENSOR)
        self.orchestration_enabled = False
        self._managed_now: set[int] = set()

    @property
    def is_demo(self) -> bool:
        return isinstance(self.source, DemoSite)

    @property
    def has_heat_pump(self) -> bool:
        return self.heat_pump_entity is not None or self.is_demo

    async def async_set_orchestration(self, enabled: bool) -> None:
        self.orchestration_enabled = enabled
        await self.async_request_refresh()

    def _heat_pump_snapshot(self) -> HeatPumpSnapshot | None:
        if self.heat_pump_entity:
            state = self.hass.states.get(self.heat_pump_entity)
            if state is None or state.state in (STATE_UNAVAILABLE, STATE_UNKNOWN):
                return None
            snapshot = HeatPumpSnapshot(state.state == STATE_ON, state.last_changed)
            if isinstance(self.source, DemoSite):
                self.source.heat_pump_boost = snapshot.boost_active
            return snapshot
        if isinstance(self.source, DemoSite):
            return HeatPumpSnapshot(self.source.heat_pump_boost, self.source.heat_pump_changed_at)
        return None

    def _price_override(self) -> float | None:
        if not self.price_entity:
            return None
        state = self.hass.states.get(self.price_entity)
        try:
            return float(state.state) if state else None
        except ValueError:
            return None

    async def _async_update_data(self) -> FunctionXData:
        heat_pump = self._heat_pump_snapshot()
        try:
            site = await self.source.async_get_state()
        except EvccAuthError as err:
            raise UpdateFailed(f"evcc rejected the API key: {err}") from err
        except EvccError as err:
            raise UpdateFailed(f"Cannot reach evcc: {err}") from err

        price = self._price_override()
        now = dt_util.utcnow()
        snapshot = HomeSnapshot(
            now=now,
            pv_power=site.pv_power,
            grid_power=site.grid_power,
            home_power=site.home_power,
            battery_soc=site.battery_soc,
            battery_power=site.battery_power,
            grid_price=price if price is not None else site.grid_price,
            price_forecast=site.price_forecast,
            loadpoints=site.loadpoints,
            heat_pump=heat_pump,
            managed_now=frozenset(self._managed_now),
        )
        plan = optimize(snapshot, self.settings)

        errors: list[str] = []
        if self.orchestration_enabled:
            errors = await self._async_apply(plan, snapshot)

        return FunctionXData(
            site=site,
            plan=plan,
            updated_at=now,
            orchestrating=self.orchestration_enabled,
            errors=errors,
        )

    async def _async_apply(self, plan: Plan, snapshot: HomeSnapshot) -> list[str]:
        errors: list[str] = []

        hp = snapshot.heat_pump
        if hp is not None and plan.heat_pump_boost is not None:
            if plan.heat_pump_boost != hp.boost_active:
                if self.heat_pump_entity:
                    try:
                        await self.hass.services.async_call(
                            self.heat_pump_entity.split(".", 1)[0],
                            "turn_on" if plan.heat_pump_boost else "turn_off",
                            {"entity_id": self.heat_pump_entity},
                            blocking=True,
                        )
                    except HomeAssistantError as err:
                        _LOGGER.warning("Could not switch heat pump: %s", err)
                        errors.append(f"Heat pump: {err}")
                if isinstance(self.source, DemoSite):
                    self.source.heat_pump_boost = plan.heat_pump_boost
                    self.source.heat_pump_changed_at = snapshot.now

        current = {lp.id: lp.mode for lp in snapshot.loadpoints}
        for lp_id, mode in plan.loadpoint_modes.items():
            if current.get(lp_id) == mode:
                continue
            try:
                await self.source.async_set_loadpoint_mode(lp_id, mode)
            except EvccError as err:
                _LOGGER.warning("Could not set loadpoint %s to %s: %s", lp_id, mode, err)
                errors.append(f"Loadpoint {lp_id}: {err}")
                continue
            if mode == MODE_NOW:
                self._managed_now.add(lp_id)
            else:
                self._managed_now.discard(lp_id)

        return errors
