---
status: accepted
---

# The wordsplit guard flags one array element in a loop

Amends [ADR-0005](0005-what-the-wordsplit-guard-flags.md), which counts
`$arr[1]` among the forms that "iterate once because that is what they ask
for". The exemption was not drawn on purpose: the `[` of the subscript matched
the glob metacharacters of `HARMLESS_AROUND`, while in zsh `$name[` always
opens a subscript. The braced form fell through for another reason: the loop
rule read the `$i` inside `${arr[$i]}` as the unsplit word and named it in the
reason, and the same reading denied the correct `${=arr[$i]}` (#773).

Measured in zsh 5.9, `arr=("a" "2 3")`, `i=2`:

| loop list | zsh | bash |
|---|---|---|
| `${arr[$i]}`, `${arr[2]}` | 1 iteration | 2 iterations |
| `$arr[$i]`, `$arr[2]` | 1 iteration | not a subscript |
| `${=arr[$i]}` | 2 iterations | — |
| `${arr[1,2]}`, `$arr[1,2]` | 2 (a slice is an array) | — |
| `${arr[@]}`, `${arr[*]}`, `$arr[*]` | 2 | — |

## The line

In a `for` list, one element (`$v[i]`, `${v[i]}`, with any modifier after
the subscript) is a non-splitting expansion like `$v`, and an array
assignment earlier in the command does not exempt it. A subscript of `@` or
`*`, or a slice holding `,`, is an array and stays allowed. Only the outer
expansion of a `${…}` group is read: an expansion in its subscript or after
its flags is never a loop word, so `${=arr[$i]}` and `${(f)arr[$i]}` pass.

## Why

A `for` list exists to iterate, which is the premise of the whole loop rule.
An element that holds one word iterates correctly either way; one that holds
several, the case a loop is written for, goes wrong silently, and the braced
form is the bash habit the guard targets. ADR-0005 asks for a replay before
widening an exemption; narrowing one is checked the same way. The replay over
9945 unique `for` commands against `main` changed 2 verdicts, both from deny
to allow and both the #773 false positive. It added no deny.

## Consequences

- `for c in $v[1]` on a scalar (one character) is denied. No such command is
  in the replay corpus.
- A subscript holding `]` or `,` inside a nested expression is read
  syntactically, like the rest of the rule.
