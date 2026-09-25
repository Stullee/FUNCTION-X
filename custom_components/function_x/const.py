"""Constants for the FUNCTION-X Energy Orchestrator."""

from __future__ import annotations

from datetime import timedelta
from typing import Final

DOMAIN: Final = "function_x"
MANUFACTURER: Final = "FUNCTION-X"

UPDATE_INTERVAL: Final = timedelta(seconds=30)

# Connection (config entry data)
CONF_SOURCE: Final = "source"
SOURCE_EVCC: Final = "evcc"
SOURCE_DEMO: Final = "demo"
CONF_EVCC_URL: Final = "evcc_url"
CONF_API_KEY: Final = "api_key"
DEFAULT_EVCC_URL: Final = "http://localhost:7070"

# Device roles (config entry options)
CONF_HEAT_PUMP_SWITCH: Final = "heat_pump_switch"
CONF_PRICE_SENSOR: Final = "price_sensor"
CONF_EV_CONTROL: Final = "ev_control"

# Tuning (config entry options)
CONF_HP_BOOST_EXPORT_W: Final = "hp_boost_export_w"
CONF_HP_STOP_IMPORT_W: Final = "hp_stop_import_w"
CONF_HP_MIN_ON_MIN: Final = "hp_min_on_minutes"
CONF_HP_MIN_OFF_MIN: Final = "hp_min_off_minutes"
CONF_CHEAP_QUANTILE: Final = "cheap_price_quantile"

DEFAULT_HP_BOOST_EXPORT_W: Final = 1500
DEFAULT_HP_STOP_IMPORT_W: Final = 300
DEFAULT_HP_MIN_ON_MIN: Final = 20
DEFAULT_HP_MIN_OFF_MIN: Final = 10
DEFAULT_CHEAP_QUANTILE: Final = 25
DEFAULT_EV_CONTROL: Final = True
