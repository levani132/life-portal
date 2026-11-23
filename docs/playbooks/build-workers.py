"""Builds one ready-to-paste file per worker from docs/playbooks/pages-assistant.md.

Each worker gets 8 food, 6 gym, 4 mixed and 2 general pages, and creates them in an order that
keeps that 40/30/20/10 mix at every step of the ramp. Run from the repository root.
"""
import os
import re

SRC = 'docs/playbooks/pages-assistant.md'
OUT = 'docs/playbooks/workers'
WORKERS = 'ABCDE'
RAMP = [('30 Nov', 3), ('7 Dec', 6), ('14 Dec', 9), ('21 Dec', 13), ('28 Dec', 18), ('1 Jan', 20)]

text = open(SRC).read()
prompt = text[text.index('```text\n') + len('```text\n'):text.index('\n```\n', text.index('```text\n'))]

rows = []
for line in text.splitlines():
    m = re.match(r'^\| (\d+) \| ([^|]+) \| ([a-z0-9-]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$', line)
    if m:
        n = int(m.group(1))
        name = m.group(2).strip()
        rows.append({
            'n': n,
            'name': name.replace(' †', ''),
            'local': name.endswith('†'),
            'username': m.group(3),
            'focus': m.group(4).strip(),
            'hooks': m.group(5).strip(),
            'attaches': m.group(6).strip(),
        })
assert [r['n'] for r in rows] == list(range(1, 101)), len(rows)

# Category and sub-cluster of each page, by its number in the roster.
SUBS = [
    ('food', 'Recipes by goal', range(1, 9)), ('food', 'World cuisines', range(9, 21)), ('food', 'Ways of eating', range(21, 26)),
    ('food', 'Food knowledge', range(26, 34)), ('food', 'Situations', range(34, 38)), ('food', 'Methods', range(38, 41)),
    ('gym', 'Programmes', range(41, 49)), ('gym', 'Body and skills', range(49, 57)), ('gym', 'Sports', range(57, 62)),
    ('gym', 'Gym knowledge', range(62, 71)),
    ('both', 'Goals', range(71, 79)), ('both', 'Programmes with food', range(79, 86)), ('both', 'Athletes', range(86, 91)),
    ('general', 'General', range(91, 101)),
]
for cat, sub, numbers in SUBS:
    for n in numbers:
        rows[n - 1]['cat'] = cat
        rows[n - 1]['sub'] = sub

LABEL = {'food': 'Food', 'gym': 'Gym', 'both': 'Food and training', 'general': 'General'}
SHARE = {'food': 8, 'gym': 6, 'both': 4, 'general': 2}


def interleave(groups):
    """One from each group in turn, longest groups first, until all are used."""
    groups = sorted((list(g) for g in groups), key=len, reverse=True)
    out = []
    while any(groups):
        for g in groups:
            if g:
                out.append(g.pop(0))
    return out


# Within a category: sub-clusters take turns, and pages that need local facts go last.
by_cat = {}
for cat in SHARE:
    subs = {}
    for r in rows:
        if r['cat'] == cat and not r['local']:
            subs.setdefault(r['sub'], []).append(r)
    by_cat[cat] = interleave(subs.values()) + [r for r in rows if r['cat'] == cat and r['local']]
    assert len(by_cat[cat]) == SHARE[cat] * 5, (cat, len(by_cat[cat]))

# Deal each category round-robin, starting one worker further each time so no worker always
# gets the first pick.
worker_cat = {w: {cat: [] for cat in SHARE} for w in WORKERS}
for offset, cat in enumerate(SHARE):
    for i, r in enumerate(by_cat[cat]):
        worker_cat[WORKERS[(i + offset) % 5]][cat].append(r)


def order(pages):
    """Creation order: at every step, the category furthest behind its share goes next."""
    left = {cat: list(v) for cat, v in pages.items()}
    done = {cat: 0 for cat in SHARE}
    out = []
    for step in range(1, 21):
        cat = max((c for c in SHARE if left[c]), key=lambda c: (SHARE[c] * step / 20 - done[c], SHARE[c]))
        out.append(left[cat].pop(0))
        done[cat] += 1
    return out


os.makedirs(OUT, exist_ok=True)
summary = []
for index, w in enumerate(WORKERS):
    pages = order(worker_cat[w])
    assert len(pages) == 20
    lines = []
    for position, r in enumerate(pages, 1):
        lines.append(
            f"{position}. {r['name']} | username: {r['username']} | {LABEL[r['cat']]} | focus: {r['focus']} | "
            f"hooks: {r['hooks']} | attaches: {r['attaches']}"
            + (' | NEEDS VERIFIED LOCAL FACTS: post only what a web search in this run confirms, and name the source' if r['local'] else ''))
    body = prompt
    body = body.replace('WORKER: <<A | B | C | D | E>>', f'WORKER: {w}')
    marker = "<<paste this worker's rows: number, name, username, focus, hooks, attaches>>"
    assert marker in body
    body = body.replace(marker, 'Create them in exactly this order.\n' + '\n'.join(lines))
    assert '<<' not in body, body[body.index('<<'):][:80]

    mix = []
    for label, count in RAMP:
        got = {cat: sum(1 for r in pages[:count] if r['cat'] == cat) for cat in SHARE}
        mix.append(f"| {label} | {count} | {got['food']} | {got['gym']} | {got['both']} | {got['general']} |")
    minute = index * 10
    doc = f"""# Worker {w}

One of five workers that run the pages (see [the playbook](../pages-assistant.md)). Twenty pages:
8 food, 6 gym, 4 food and training, 2 general, created in the order below so the mix holds at
every step.

**To use:** create a scheduled task in ChatGPT that runs **every hour at minute {minute:02d}**, with
everything in the block below as its instructions. To test by hand, paste the block into a chat
and write `PLAN now`.

Generated from the playbook by `docs/playbooks/build-workers.py`. Change the playbook and run it
again rather than editing this file.

## What exists by when

| By | Pages | Food | Gym | Both | General |
|---|---|---|---|---|---|
{chr(10).join(mix)}

## Instructions for the task

```text
{body}
```
"""
    open(f'{OUT}/worker-{w.lower()}.md', 'w').write(doc)
    summary.append((w, pages))

# A table of who runs what, for the playbook.
table = ['| # | Page | Worker | Created |', '|---|---|---|---|']
where = {}
for w, pages in summary:
    for position, r in enumerate(pages, 1):
        where[r['n']] = (w, position)
for w, pages in summary:
    print(w, [f"{r['n']}{'†' if r['local'] else ''}" for r in pages])
for label, count in RAMP:
    got = {cat: sum(1 for w, pages in summary for r in pages[:count] if r['cat'] == cat) for cat in SHARE}
    print(label, count * 5, got)
