---
name: hello
description: Example skill (template). Greets the user and shows the minimal structure of a skill. Use it as a base to copy when creating new skills. Triggers on "/example-plugin:hello", "example skill", "skill template".
---

# hello

Template skill. Copy it to create new ones.

When invoked:
1. Greet the user by name if known, otherwise generically.
2. Remember that this file (`SKILL.md`) is the entry point: the **frontmatter**
   (`name` + `description`) determines when the skill activates; the **body** is
   the instructions Claude follows.

## How to create a new skill from this template
1. Copy the `skills/hello/` folder to `skills/<new-skill-name>/`.
2. Edit the frontmatter: `name` = skill name, `description` = when/why to use it
   (the description drives automatic triggering — be specific).
3. Replace the body with the real operating instructions.
4. The skill will be invocable as `/example-plugin:<new-skill-name>`.

No dependencies. Just Markdown with YAML frontmatter.
