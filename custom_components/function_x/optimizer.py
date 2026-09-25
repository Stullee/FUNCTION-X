"""Orchestration logic.

Pure Python with no Home Assistant imports, so it can be unit-tested and later
moved into a standalone service. Every decision carries a human-readable reason:
explaining *why* is part of the product.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta

# Loadpoint intents. MODE_SOLAR is translated to evcc's own mode name by the client.
MODE_SOLAR = "solar"
MODE_NOW = "now"
MODE_OFF = "off"

PRICE_CHEAP = "cheap"
PRICE_NORMAL = "normal"
PRICE_UNKNOWN = "unknown"

# Below this many future slots a price comparison is meaningless.
_MIN_FORECAST_SLOTS = 4
# A fixed tariff reports a flat forecast; nothing in it is "cheap".
_MIN_PRICE_SPREAD = 0.02


@dataclass(frozen=True)
class PriceSlot:
    start: datetime
    end: datetime
    price: float


@dataclass(frozen=True)
class LoadpointSnapshot:
    id: int
    title: str
    mode: str
    connected: bool
    charging: bool
    charge_power: float
    vehicle_soc: float | None = None
    limit_soc: float | None = None


@dataclass(frozen=True)
class HeatPumpSnapshot:
    boost_active: bool
    changed_at: datetime | None


@dataclass(frozen=True)
class HomeSnapshot:
    now: datetime
    pv_power: float
    grid_power: float  # W, positive = import, negative = export
    home_power: float
    battery_soc: float | None = None
    battery_power: float | None = None  # W, positive = discharge, negative = charge
    grid_price: float | None = None
    price_forecast: list[PriceSlot] = field(default_factory=list)
    loadpoints: list[LoadpointSnapshot] = field(default_factory=list)
    heat_pump: HeatPumpSnapshot | None = None
    # Loadpoints the orchestrator itself switched to MODE_NOW; only these are
    # switched back, so a mode the user picked by hand is never overridden.
    managed_now: frozenset[int] = frozenset()


@dataclass(frozen=True)
class Settings:
    hp_boost_export_w: float = 1500
    hp_stop_import_w: float = 300
    hp_min_on: timedelta = timedelta(minutes=20)
    hp_min_off: timedelta = timedelta(minutes=10)
    battery_full_soc: float = 95
    cheap_quantile: float = 0.25
    ev_control: bool = True


@dataclass(frozen=True)
class Decision:
    device: str
    action: str
    reason: str


@dataclass
class Plan:
    surplus_power: float
    price_level: str
    heat_pump_boost: bool | None = None
    loadpoint_modes: dict[int, str] = field(default_factory=dict)
    decisions: list[Decision] = field(default_factory=list)

    @property
    def summary(self) -> str:
        changes = [d for d in self.decisions if d.action not in ("keep", "skip")]
        if changes:
            return "; ".join(f"{d.device}: {d.action}" for d in changes)
        return "No changes"


def surplus_power(snap: HomeSnapshot, settings: Settings) -> float:
    """Solar power that would otherwise leave the house (W).

    Battery charging power counts as surplus once the battery is nearly full,
    because it is about to turn into grid export anyway.
    """
    surplus = max(0.0, -snap.grid_power)
    if (
        snap.battery_soc is not None
        and snap.battery_power is not None
        and snap.battery_soc >= settings.battery_full_soc
    ):
        surplus += max(0.0, -snap.battery_power)
    return surplus


def price_level(snap: HomeSnapshot, settings: Settings) -> str:
    """Classify the current price against the next 24 h of the forecast."""
    if snap.grid_price is None:
        return PRICE_UNKNOWN
    horizon = snap.now + timedelta(hours=24)
    upcoming = sorted(
        s.price for s in snap.price_forecast if s.end > snap.now and s.start < horizon
    )
    if len(upcoming) < _MIN_FORECAST_SLOTS:
        return PRICE_UNKNOWN
    if upcoming[-1] - upcoming[0] < _MIN_PRICE_SPREAD:
        return PRICE_NORMAL
    index = min(len(upcoming) - 1, int(len(upcoming) * settings.cheap_quantile))
    return PRICE_CHEAP if snap.grid_price <= upcoming[index] else PRICE_NORMAL


def _plan_heat_pump(
    snap: HomeSnapshot, settings: Settings, surplus: float, level: str
) -> tuple[bool | None, Decision | None]:
    hp = snap.heat_pump
    if hp is None:
        return None, None

    cheap = level == PRICE_CHEAP
    grid_import = max(0.0, snap.grid_power)
    battery_discharge = max(0.0, snap.battery_power or 0.0)

    if hp.boost_active:
        if grid_import + battery_discharge > settings.hp_stop_import_w and not cheap:
            want = False
            sources = []
            if grid_import:
                sources.append(f"{grid_import:.0f} W from the grid")
            if battery_discharge:
                sources.append(f"{battery_discharge:.0f} W from the battery")
            reason = "Solar is no longer enough, using " + " and ".join(sources)
        elif surplus > 0 or not cheap:
            want, reason = True, f"Still running on solar ({surplus:.0f} W spare)"
        else:
            want, reason = True, "Electricity is cheap right now"
    elif surplus >= settings.hp_boost_export_w:
        want, reason = True, f"{surplus:.0f} W of solar would otherwise be exported"
    elif cheap:
        want, reason = True, "Electricity is cheap right now"
    else:
        want = False
        reason = f"Not enough solar ({surplus:.0f} W spare) and price not cheap"

    if want != hp.boost_active and hp.changed_at is not None:
        min_time = settings.hp_min_off if want else settings.hp_min_on
        remaining = hp.changed_at + min_time - snap.now
        if remaining > timedelta(0):
            minutes = max(1, round(remaining.total_seconds() / 60))
            return hp.boost_active, Decision(
                "Heat pump",
                "keep",
                f"{reason}, but holding {minutes} min longer to protect the compressor",
            )

    if want == hp.boost_active:
        return want, Decision("Heat pump", "keep", reason)
    return want, Decision("Heat pump", "boost on" if want else "boost off", reason)


def _plan_loadpoint(
    lp: LoadpointSnapshot, snap: HomeSnapshot, level: str
) -> tuple[str | None, Decision]:
    name = lp.title
    if not lp.connected:
        return None, Decision(name, "skip", "No vehicle connected")
    if lp.mode == MODE_OFF:
        return None, Decision(name, "skip", "Charging switched off by user")
    if lp.mode == MODE_NOW and lp.id not in snap.managed_now:
        return None, Decision(name, "skip", "Fast charging chosen by user")
    if lp.vehicle_soc is not None and lp.limit_soc and lp.vehicle_soc >= lp.limit_soc:
        target = MODE_SOLAR
        reason = f"Vehicle already at its {lp.limit_soc:.0f}% limit"
    elif level == PRICE_CHEAP and lp.mode == MODE_SOLAR and lp.charging:
        target, reason = MODE_SOLAR, "Already charging from solar, which is cheaper still"
    elif level == PRICE_CHEAP:
        target, reason = MODE_NOW, "Grid price is among the cheapest of the day"
    else:
        target, reason = MODE_SOLAR, "Charge from solar surplus"

    if target == lp.mode:
        return target, Decision(name, "keep", reason)
    return target, Decision(name, "charge now" if target == MODE_NOW else "solar charging", reason)


def optimize(snap: HomeSnapshot, settings: Settings) -> Plan:
    """Compute what every controllable device should be doing right now."""
    surplus = surplus_power(snap, settings)
    level = price_level(snap, settings)
    plan = Plan(surplus_power=surplus, price_level=level)

    boost, decision = _plan_heat_pump(snap, settings, surplus, level)
    plan.heat_pump_boost = boost
    if decision:
        plan.decisions.append(decision)

    if settings.ev_control:
        for lp in snap.loadpoints:
            target, decision = _plan_loadpoint(lp, snap, level)
            if target is not None:
                plan.loadpoint_modes[lp.id] = target
            plan.decisions.append(decision)

    return plan
