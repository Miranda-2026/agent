"""Resolve the endpoint from the app resource, with the user's chosen default."""

import os

DEFAULT_MODEL_ENDPOINT = "databricks-gpt-oss-120b"


def get_model_endpoint() -> str:
    # app.yaml resolves llm-endpoint to its actual Serving endpoint name.
    # IFC_MODEL_ENDPOINT also supports existing local IFC configurations.
    return (
        os.getenv("DATABRICKS_MODEL_ENDPOINT", "").strip()
        or os.getenv("IFC_MODEL_ENDPOINT", "").strip()
        or DEFAULT_MODEL_ENDPOINT
    )
