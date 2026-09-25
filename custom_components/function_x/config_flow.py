"""Config flow: pick a data source, then map the house's devices to roles."""

from __future__ import annotations

from typing import Any

import voluptuous as vol
from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlow,
    ConfigFlowResult,
    OptionsFlowWithReload,
)
from homeassistant.core import callback
from homeassistant.helpers import selector
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import (
    CONF_API_KEY,
    CONF_CHEAP_QUANTILE,
    CONF_EV_CONTROL,
    CONF_EVCC_URL,
    CONF_HEAT_PUMP_SWITCH,
    CONF_HOUSE,
    CONF_HP_BOOST_EXPORT_W,
    CONF_HP_MIN_OFF_MIN,
    CONF_HP_MIN_ON_MIN,
    CONF_HP_STOP_IMPORT_W,
    CONF_PRICE_SENSOR,
    CONF_SOURCE,
    DEFAULT_CHEAP_QUANTILE,
    DEFAULT_EV_CONTROL,
    DEFAULT_EVCC_URL,
    DEFAULT_HP_BOOST_EXPORT_W,
    DEFAULT_HP_MIN_OFF_MIN,
    DEFAULT_HP_MIN_ON_MIN,
    DEFAULT_HP_STOP_IMPORT_W,
    DOMAIN,
    SOURCE_DEMO,
    SOURCE_EVCC,
)
from .evcc import EvccAuthError, EvccClient, EvccError


def _roles_schema(options: dict[str, Any]) -> vol.Schema:
    def suggested(key: str) -> dict[str, Any]:
        return {"suggested_value": options.get(key)}

    return vol.Schema(
        {
            vol.Optional(
                CONF_HEAT_PUMP_SWITCH, description=suggested(CONF_HEAT_PUMP_SWITCH)
            ): selector.EntitySelector(
                selector.EntitySelectorConfig(domain=["switch", "input_boolean"])
            ),
            vol.Optional(
                CONF_PRICE_SENSOR, description=suggested(CONF_PRICE_SENSOR)
            ): selector.EntitySelector(selector.EntitySelectorConfig(domain="sensor")),
            vol.Required(
                CONF_EV_CONTROL,
                default=options.get(CONF_EV_CONTROL, DEFAULT_EV_CONTROL),
            ): selector.BooleanSelector(),
        }
    )


def _number(minimum: int, maximum: int, step: int, unit: str) -> selector.NumberSelector:
    return selector.NumberSelector(
        selector.NumberSelectorConfig(
            min=minimum,
            max=maximum,
            step=step,
            unit_of_measurement=unit,
            mode=selector.NumberSelectorMode.BOX,
        )
    )


def _tuning_schema(options: dict[str, Any]) -> vol.Schema:
    return vol.Schema(
        {
            vol.Required(
                CONF_HP_BOOST_EXPORT_W,
                default=options.get(CONF_HP_BOOST_EXPORT_W, DEFAULT_HP_BOOST_EXPORT_W),
            ): _number(200, 10000, 100, "W"),
            vol.Required(
                CONF_HP_STOP_IMPORT_W,
                default=options.get(CONF_HP_STOP_IMPORT_W, DEFAULT_HP_STOP_IMPORT_W),
            ): _number(0, 5000, 50, "W"),
            vol.Required(
                CONF_HP_MIN_ON_MIN,
                default=options.get(CONF_HP_MIN_ON_MIN, DEFAULT_HP_MIN_ON_MIN),
            ): _number(0, 120, 1, "min"),
            vol.Required(
                CONF_HP_MIN_OFF_MIN,
                default=options.get(CONF_HP_MIN_OFF_MIN, DEFAULT_HP_MIN_OFF_MIN),
            ): _number(0, 120, 1, "min"),
            vol.Required(
                CONF_CHEAP_QUANTILE,
                default=options.get(CONF_CHEAP_QUANTILE, DEFAULT_CHEAP_QUANTILE),
            ): _number(5, 50, 5, "%"),
        }
    )


class FunctionXConfigFlow(ConfigFlow, domain=DOMAIN):
    VERSION = 1

    def __init__(self) -> None:
        self._data: dict[str, Any] = {}

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> FunctionXOptionsFlow:
        return FunctionXOptionsFlow()

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        return self.async_show_menu(step_id="user", menu_options=["evcc", "demo"])

    async def async_step_demo(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        await self.async_set_unique_id(SOURCE_DEMO)
        self._abort_if_unique_id_configured()
        self._data = {CONF_SOURCE: SOURCE_DEMO}
        return await self.async_step_roles()

    async def async_step_evcc(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            url = user_input[CONF_EVCC_URL].rstrip("/")
            client = EvccClient(
                async_get_clientsession(self.hass), url, user_input.get(CONF_API_KEY)
            )
            try:
                await client.async_get_state()
            except EvccAuthError:
                errors["base"] = "invalid_auth"
            except EvccError:
                errors["base"] = "cannot_connect"
            else:
                await self.async_set_unique_id(url)
                self._abort_if_unique_id_configured()
                self._data = {
                    CONF_SOURCE: SOURCE_EVCC,
                    CONF_EVCC_URL: url,
                    CONF_API_KEY: user_input.get(CONF_API_KEY),
                }
                return await self.async_step_roles()

        return self.async_show_form(
            step_id="evcc",
            data_schema=self.add_suggested_values_to_schema(
                vol.Schema(
                    {
                        vol.Required(CONF_EVCC_URL, default=DEFAULT_EVCC_URL): str,
                        vol.Optional(CONF_API_KEY): selector.TextSelector(
                            selector.TextSelectorConfig(type=selector.TextSelectorType.PASSWORD)
                        ),
                    }
                ),
                user_input,
            ),
            errors=errors,
        )

    async def async_step_roles(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is not None:
            title = "FUNCTION-X (demo)" if self._data[CONF_SOURCE] == SOURCE_DEMO else "FUNCTION-X"
            return self.async_create_entry(title=title, data=self._data, options=user_input)
        return self.async_show_form(step_id="roles", data_schema=_roles_schema({}))


class FunctionXOptionsFlow(OptionsFlowWithReload):
    """Change device roles and tuning after setup."""

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is not None:
            # Optional entity fields are simply absent when cleared.
            self._roles = user_input
            return await self.async_step_tuning()
        return self.async_show_form(
            step_id="init", data_schema=_roles_schema(dict(self.config_entry.options))
        )

    async def async_step_tuning(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is not None:
            # Keep what the panel's house setup guide stored.
            kept = {k: v for k, v in self.config_entry.options.items() if k == CONF_HOUSE}
            return self.async_create_entry(data={**kept, **self._roles, **user_input})
        return self.async_show_form(
            step_id="tuning", data_schema=_tuning_schema(dict(self.config_entry.options))
        )
