"""Minimal async client for the evcc REST API.

evcc's /api/state "carries no compatibility promise", so parsing is tolerant:
it accepts both the current nested shape (``grid.power``, ``battery.soc``) and
the older flat one (``gridPower``, ``batterySoc``), with or without the legacy
``result`` wrapper.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import aiohttp

from .optimizer import MODE_NOW, MODE_SOLAR, LoadpointSnapshot, PriceSlot

# evcc renamed its solar charge modes ("pv"/"minpv" -> "smart").
_LEGACY_SOLAR_MODES = frozenset({"pv", "minpv"})
_TIMEOUT = aiohttp.ClientTimeout(total=10)


class EvccError(Exception):
    """evcc could not be reached or returned an error."""


class EvccAuthError(EvccError):
    """evcc rejected the API key."""


@dataclass(frozen=True)
class SiteState:
    """The parts of evcc's state the orchestrator uses."""

    site_title: str | None
    version: str | None
    currency: str | None
    pv_power: float
    grid_power: float
    home_power: float
    battery_soc: float | None
    battery_power: float | None
    grid_price: float | None
    feed_in_price: float | None
    price_forecast: list[PriceSlot] = field(default_factory=list)
    loadpoints: list[LoadpointSnapshot] = field(default_factory=list)


def _num(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _parse_slot(slot: Any) -> PriceSlot | None:
    if isinstance(slot, list | tuple) and len(slot) == 3:
        start, end, value = slot
        start_dt = datetime.fromtimestamp(start, UTC)
        end_dt = datetime.fromtimestamp(end, UTC)
    elif isinstance(slot, dict):
        value = slot.get("value", slot.get("price"))
        try:
            start_dt = datetime.fromisoformat(slot["start"])
            end_dt = datetime.fromisoformat(slot["end"])
        except (KeyError, TypeError, ValueError):
            return None
    else:
        return None
    price = _num(value)
    if price is None:
        return None
    return PriceSlot(start_dt, end_dt, price)


def parse_state(raw: dict[str, Any]) -> SiteState:
    """Turn a raw /api/state payload into a SiteState."""
    state = raw.get("result", raw)

    grid = state.get("grid")
    grid_power = _num(grid.get("power")) if isinstance(grid, dict) else None
    if grid_power is None:
        grid_power = _num(state.get("gridPower"))

    battery = state.get("battery")
    if isinstance(battery, dict):
        battery_soc = _num(battery.get("soc"))
        battery_power = _num(battery.get("power"))
    else:
        battery_soc = _num(state.get("batterySoc"))
        battery_power = _num(state.get("batteryPower"))

    forecast = state.get("forecast") or {}
    slots = [_parse_slot(s) for s in forecast.get("grid") or []]

    loadpoints = [
        LoadpointSnapshot(
            id=index,
            title=lp.get("title") or f"Loadpoint {index}",
            mode=evcc_mode_to_intent(str(lp.get("mode", ""))),
            connected=bool(lp.get("connected")),
            charging=bool(lp.get("charging")),
            charge_power=_num(lp.get("chargePower")) or 0.0,
            vehicle_soc=_num(lp.get("vehicleSoc")),
            limit_soc=_num(lp.get("effectiveLimitSoc")),
        )
        for index, lp in enumerate(state.get("loadpoints") or [], start=1)
    ]

    return SiteState(
        site_title=state.get("siteTitle"),
        version=state.get("version"),
        currency=state.get("currency"),
        pv_power=_num(state.get("pvPower")) or 0.0,
        grid_power=grid_power or 0.0,
        home_power=_num(state.get("homePower")) or 0.0,
        battery_soc=battery_soc,
        battery_power=battery_power,
        grid_price=_num(state.get("tariffGrid")),
        feed_in_price=_num(state.get("tariffFeedIn")),
        price_forecast=[s for s in slots if s is not None],
        loadpoints=loadpoints,
    )


class EvccClient:
    """Talks to one evcc instance."""

    def __init__(
        self, session: aiohttp.ClientSession, base_url: str, api_key: str | None = None
    ) -> None:
        self._session = session
        self._base_url = base_url.rstrip("/")
        self._headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        self._solar_mode: str | None = None

    @property
    def base_url(self) -> str:
        return self._base_url

    async def _request(self, method: str, path: str) -> Any:
        url = f"{self._base_url}/api/{path}"
        try:
            async with self._session.request(
                method, url, headers=self._headers, timeout=_TIMEOUT
            ) as resp:
                if resp.status in (401, 403):
                    raise EvccAuthError(f"{method} {path}: HTTP {resp.status}")
                if resp.status >= 400:
                    raise EvccError(f"{method} {path}: HTTP {resp.status}")
                text = await resp.text()
        except (aiohttp.ClientError, TimeoutError) as err:
            raise EvccError(f"{method} {path}: {err}") from err
        if not text:
            return None
        try:
            return json.loads(text)
        except ValueError as err:
            raise EvccError(f"{method} {path}: invalid JSON") from err

    async def async_get_state(self) -> SiteState:
        raw = await self._request("GET", "state")
        if not isinstance(raw, dict):
            raise EvccError("Unexpected /api/state response")
        if self._solar_mode is None:
            loadpoints = raw.get("result", raw).get("loadpoints") or []
            modes = {lp.get("mode") for lp in loadpoints if isinstance(lp, dict)}
            if modes & _LEGACY_SOLAR_MODES:
                self._solar_mode = "pv"
            elif "smart" in modes:
                self._solar_mode = "smart"
        return parse_state(raw)

    async def async_set_loadpoint_mode(self, loadpoint_id: int, mode: str) -> None:
        """Set a loadpoint's mode; MODE_SOLAR maps to evcc's solar mode name."""
        if mode != MODE_SOLAR:
            await self._request("POST", f"loadpoints/{loadpoint_id}/mode/{mode}")
            return
        if self._solar_mode:
            await self._request("POST", f"loadpoints/{loadpoint_id}/mode/{self._solar_mode}")
            return
        # Unknown evcc version: try the current name, fall back to the legacy one.
        try:
            await self._request("POST", f"loadpoints/{loadpoint_id}/mode/smart")
            self._solar_mode = "smart"
        except EvccAuthError:
            raise
        except EvccError:
            await self._request("POST", f"loadpoints/{loadpoint_id}/mode/pv")
            self._solar_mode = "pv"


def evcc_mode_to_intent(mode: str) -> str:
    """Map an evcc mode name onto the optimizer's vocabulary."""
    if mode == "smart" or mode in _LEGACY_SOLAR_MODES:
        return MODE_SOLAR
    if mode == "now":
        return MODE_NOW
    return mode
