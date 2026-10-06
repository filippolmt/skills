#!/usr/bin/env python3
# /// script
# dependencies = ["jsonschema"]
# ///
"""Check a Claude Code settings.json against the published schema.

Usage: check.py <settings.json> [--schema <file or URL>] [--reference <file>]

--schema points at a local copy when the default URL can't be fetched.
--reference is the raw settings-reference.md: each UNKNOWN key is then tagged
(documented) when the reference has a `### `<key>`` section, else (undocumented).

Reports one line per problem:
  SYNTAX   invalid JSON (line and column)
  DUP      key repeated in the same object (the last one wins, silently)
  SCHEMA   schema violation (type, enum, key not allowed in a closed object)
  UNKNOWN  key the schema does not list in an object that accepts any key
Exit 0 when clean, 1 on problems, 2 when jsonschema, the schema, the reference
or an option's value is missing.
"""
import json
import re
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


def documented_keys(reference):
    """Key names that have their own `### `<key>`` section in the reference."""
    return set(re.findall(r"^### `([^`]+)`\s*$", reference, re.MULTILINE))


def take_option(args, name):
    """Remove `name <value>` from args and return the value, or None if absent."""
    if name not in args:
        return None
    i = args.index(name)
    if i + 1 == len(args) or args[i + 1].startswith("--"):
        print(f"{name} needs a value\n\n{__doc__}")
        sys.exit(2)
    value = args[i + 1]
    del args[i:i + 2]
    return value


def main():
    args = sys.argv[1:]
    schema_src = take_option(args, "--schema") or SCHEMA_URL
    reference_src = take_option(args, "--reference")
    if not args:
        print(__doc__)
        sys.exit(2)

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
        print("jsonschema module missing: rerun with `uv run check.py ...`, or "
              "python3 -m pip install --target <dir> jsonschema, then rerun with PYTHONPATH=<dir>")
        sys.exit(2)
    documented = None
    if reference_src:
        try:
            with open(reference_src, encoding="utf-8") as f:
                documented = documented_keys(f.read())
        except OSError as e:
            print(f"Reference not loaded from {reference_src}: {e}")
            sys.exit(2)
        if not documented:  # a changed heading format would tag every key undocumented
            print(f"No `### `<key>`` sections in {reference_src}: not the settings reference, "
                  "or its heading format changed")
            sys.exit(2)

    problems = [f"DUP {k}" for k in dups]
    validator = jsonschema.validators.validator_for(schema)(schema)
    for e in sorted(validator.iter_errors(data), key=lambda e: list(e.absolute_path)):
        where = ".".join(str(p) for p in e.absolute_path) or "(root)"
        problems.append(f"SCHEMA {where}: {e.message[:300]}")
    for k in unknown_keys(data, schema):
        tag = ""
        if documented is not None:
            tag = " (documented)" if k in documented else " (undocumented)"
        problems.append(f"UNKNOWN {k}{tag}")

    for p in problems:
        print(p)
    print(f"{len(problems)} problems" if problems else "Clean: no schema problems")
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
