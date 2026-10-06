"""Smoke test for the marketsdk package. See smoke/run.mjs for what every test does."""

import os
import time
import uuid

from marketsdk import MarketSDK
from marketsdk.core.api_error import ApiError

key = os.environ["MARKETSDK_KEY"]
base_url = os.environ["MARKETSDK_BASE_URL"]
mock_url = os.environ["MARKETSDK_MOCK_URL"]

client = MarketSDK(token=key, base_url=base_url)
external_id = f"smoke-py-{int(time.time() * 1000)}"
idempotency_key = f"smoke-py-{uuid.uuid4()}"
headers = {"additional_headers": {"Idempotency-Key": idempotency_key}}

created = client.sellers.create_seller(external_id=external_id, request_options=headers)
assert created.id.startswith("sel_"), "created seller has an id"
assert created.external_id == external_id, "created seller carries external_id"
replayed = client.sellers.create_seller(external_id=external_id, request_options=headers)
assert replayed.id == created.id, "replay returns the same seller"

page = client.sellers.list_sellers(limit=2)
assert len(page.data) <= 2, "list honours limit"
assert isinstance(page.has_more, bool), "list has has_more"
fetched = client.sellers.get_seller(created.id)
assert fetched.id == created.id, "get returns the seller"

try:
    client.sellers.create_seller(external_id="x" * 201)
    raise AssertionError("bad request did not raise")
except ApiError as e:
    assert e.status_code == 400, f"bad request status is 400 (got {e.status_code})"
    body = e.body
    error = body["error"] if isinstance(body, dict) else body.error
    code = error["code"] if isinstance(error, dict) else error.code
    request_id = error["request_id"] if isinstance(error, dict) else error.request_id
    assert code, "error has code"
    assert request_id, "error has request_id"

mock = MarketSDK(token=key, base_url=mock_url)
odd = mock.sellers.get_seller("sel_mock000000000000000000")
assert odd.status == "hibernating", f"unknown enum value passes through (got {odd.status})"
assert odd.id == "sel_mock000000000000000000", "mock seller parsed"

print("ok")
