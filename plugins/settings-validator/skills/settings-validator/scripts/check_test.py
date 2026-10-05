#!/usr/bin/env python3
"""check.py's own logic, without jsonschema or the network: run with python3."""
import json
import os
import sys

sys.dont_write_bytecode = True  # no __pycache__ inside the shipped skill
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from check import parse, unknown_keys  # noqa: E402

SCHEMA = {
    "properties": {
        "theme": {"type": "string"},
        "sandbox": {"properties": {"enabled": {}}, "additionalProperties": False},
        "env": {"properties": {"DEBUG": {}}, "additionalProperties": {"type": "string"}},
    },
}

data, dups = parse('{"theme": "dark", "theme": "light"}')
assert dups == ["theme"] and data == {"theme": "light"}, dups

try:
    parse('{"a": 1,}')
    raise AssertionError("a trailing comma must be a syntax error")
except json.JSONDecodeError:
    pass

found = list(unknown_keys({
    "theme": "dark",
    "syncClaudeAiPlugins": False,  # open top level: reported
    "$schema": "x",  # the editor hint: never reported
    "sandbox": {"foo": 1},  # closed object: left to the schema check
    "env": {"MY_VAR": "1"},  # env takes any name: never reported
}, SCHEMA))
assert found == ["syncClaudeAiPlugins"], found

print("check.py: all checks passed")
