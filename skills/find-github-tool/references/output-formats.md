# Output formats

## Everyday users: recommendation cards

Use this shape for each of the top 3. Keep every line short. Fill it only from tool results and
evidence; write "unknown" rather than guess.

```
🏆 Best pick: <Name>  (<link>)
<One sentence: what it is, in everyday words.>

Why it fits you
✅ <need 1>   ✅ <need 2>   ⚠️ <partial need, with a few words why>

Cost: <Free and open source | Free to run yourself, hosted plan from $X/month | Unknown>

How to start (easiest first)
1. <Easiest option from setup.hints, e.g. "Sign up for their hosted version at …">
2. <Next option, e.g. "Or download the Windows installer from …">

Trust
🟢 <health signal, e.g. "Actively maintained (last update 3 days ago)">
🟢 <e.g. "Large community: 9,600 people starred it">
🟡 <e.g. "Security practices score 4/10">

Watch out: <one honest caveat, e.g. "The mobile app is basic">
```

Then `🥈 Runner-up` and `🥉 Also good` in the same shape, but shorter (cost, how to start,
one trust line, one watch-out).

Close with:
- One line: "I checked GitHub, <other sources used> on <date>."
- If any lead could not be verified, say so briefly.
- The next-step offer: "Want me to explain any of these more, compare two side by side, help you
  set one up, or save this as a report?"

Tone dots: 🟢 good · 🟡 OK · 🟠 caution · 🔴 problem. Never use colour alone: the text must say it too.

## Developers: comparison table

| | Tool A | Tool B | Tool C |
|---|---|---|---|
| Fit (must-haves met) | 4/4 | 3/4 (no X) | 4/4 |
| License | MIT | AGPL-3.0 | Apache-2.0 |
| Language | Go | TypeScript | Rust |
| Stars / forks | 12.3k / 900 | 4.1k / 300 | 2.2k / 120 |
| Contributors | 180 | 35 | 9 |
| Last commit / release | 2 days / 3 weeks | 1 month / 2 months | 5 days / 1 week |
| OpenSSF Scorecard | 7.1 | 5.2 | n/a |
| Known vulns (OSV) | 0 | 2 (fixed) | 0 |
| Setup | docker-compose, Helm | npm, Docker | cargo, binaries |

Then:
- **Pick:** one or two sentences on which to choose and when you'd choose another.
- **Considered but rejected:** bullets of `name: reason` (archived, license, missing must-have…).
- Links: repo, docs, and `https://deepwiki.com/<owner>/<repo>` for an AI explanation of the code.

## Mixed or unsure audience

Lead with the cards, then add a collapsible-style "Details for developers" section with the
table.
