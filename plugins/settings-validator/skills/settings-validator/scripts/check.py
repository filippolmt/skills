#!/usr/bin/env python3
"""Check a Claude Code settings.json against the published schema.

Usage: check.py <settings.json> [--schema <file or URL>]

--schema points at a local copy when the default URL can't be fetched.

Reports one line per problem:
  SYNTAX   invalid JSON (line and column)
  DUP      key repeated in the same object (the last one wins, silently)
  SCHEMA   schema violation (type, enum, key not allowed in a closed object)
  UNKNOWN  key the schema does not list in an object that accepts any key
Exit 0 when clean, 1 on problems, 2 when jsonschema or the schema is missing.
"""
import json
import sys
import urllib.request

SCHEMA_URL = "https://json.schemastore.org/claude-code-settings.json"


def parse(text):
    """Return (data, duplicate keys); raises json.JSONDecodeError."""
    dups = []

    def hook(pairs):
        seen = set()
        for k, _ in pairs:
            if k in seen:
                dups.append(k)
            seen.add(k)
        return dict(pairs)

    return json.loads(text, object_pairs_hook=hook), dups


def load_schema(src):
    if src.startswith("http"):
        with urllib.request.urlopen(src, timeout=30) as r:
            return json.load(r)
    with open(src, encoding="utf-8") as f:
        return json.load(f)


def unknown_keys(node, schema, path=""):
    """Keys the schema does not list, in objects that accept any key.

    An object whose additionalProperties is a schema (env) accepts arbitrary
    names by design: its extra keys are not reported. Only plain `properties`
    are followed; in the current schema the top level is the one open object.
    """
    if not isinstance(node, dict) or not isinstance(schema, dict):
        return
    props = schema.get("properties")
    if props is None:
        return
    open_object = schema.get("additionalProperties", True) is True
    for k, v in node.items():
        where = f"{path}.{k}" if path else k
        if k in props:
            yield from unknown_keys(v, props[k], where)
        elif open_object and k != "$schema":
            yield where


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(2)
    schema_src = SCHEMA_URL
    if "--schema" in args:
        i = args.index("--schema")
        schema_src = args[i + 1]
        del args[i:i + 2]

    with open(args[0], encoding="utf-8") as f:
        text = f.read()
    try:
        data, dups = parse(text)
    except json.JSONDecodeError as e:
        print(f"SYNTAX line {e.lineno} column {e.colno}: {e.msg}")
        sys.exit(1)
    try:
        schema = load_schema(schema_src)
    except Exception as e:  # network or file: without the schema the check means nothing
        print(f"Schema not loaded from {schema_src}: {e}")
        sys.exit(2)
    try:
        import jsonschema
    except ImportError:
        print("jsonschema module missing: python3 -m pip install --target <dir> jsonschema, "
              "then rerun with PYTHONPATH=<dir>")
        sys.exit(2)

    problems = [f"DUP {k}" for k in dups]
    validator = jsonschema.validators.validator_for(schema)(schema)
    for e in sorted(validator.iter_errors(data), key=lambda e: list(e.absolute_path)):
        where = ".".join(str(p) for p in e.absolute_path) or "(root)"
        problems.append(f"SCHEMA {where}: {e.message[:300]}")
    problems += [f"UNKNOWN {k}" for k in unknown_keys(data, schema)]

    for p in problems:
        print(p)
    print(f"{len(problems)} problems" if problems else "Clean: no schema problems")
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
