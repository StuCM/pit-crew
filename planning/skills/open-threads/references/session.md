# Running a session

## Opening a thread

Four moves, in order. Keep it to a short paragraph or two — this is the start
of a conversation, not a briefing.

1. **Name the thread and why it is first.** One line, using the ranking's own
   reasoning. "Conversion worker — ten parts sit downstream of it."
2. **State a position.** What you actually think, with the reason.
3. **Name the thing you do not know**, specifically, and say how it would
   change your answer.
4. **Stop.** Do not stack a second question behind the first.

### Worked example

> **Conversion worker** is first because ten parts sit downstream of it and it
> carries two open questions.
>
> I think you start with a Celery worker on the same host. A heritage platform
> takes uploads in the tens per day, not thousands, and a dedicated conversion
> pod buys scaling you have no evidence you need yet — at the cost of a second
> deployment, a second image and a queue you now have to watch.
>
> What would change my mind is the size distribution. If a normal upload is a
> 40-million-triangle scan rather than a 20MB mesh, one worker saturates a node
> and starts starving the web workers on the same host, and then the pod is
> worth it on day one. Do you know roughly what the Queensland uploads look
> like?

Note what that does: it commits, it gives the reason, it names the single fact
that would flip it, and it asks one thing.

## During

- **Follow the user.** If they go sideways, go with them.
- **Push back when you still disagree.** "That is fair, but I still think X,
  because Y" is more useful than agreement.
- **Say when you have changed your mind, and why.** It tells them which
  argument did the work.
- **Notice when a thread splits.** Often one question turns out to be two. Say
  so — it may be worth writing both back as separate open questions rather than
  forcing one answer.
- **Do not summarise every turn.** It stalls the conversation.

## Closing

Say which outcome you think it is and let them correct you.

> That sounds like a decision: same-host Celery worker, revisit if conversion
> starts starving the web workers. Want me to write that in, or keep it as
> options for now?

### Decided

Only when the user made the call.

```bash
python3 scripts/resolve.py --map arch.json --part p-queue \
  --question "Same-server Celery worker" \
  --decided "Same-host Celery worker to start." \
  --why "Upload volume is tens per day; revisit if conversion starves the web workers." \
  --dry-run
```

The question leaves the map. The record stays in `decisions` forever, so
someone reading the map in six months can see how it was settled, not just what
was settled.

### Options

When the conversation narrowed the field without picking one.

```bash
python3 scripts/resolve.py --map arch.json --part p-filestore \
  --question "S3-compatible" \
  --options "Azure Blob with native range support|Django FileResponse with byte-range handling|CDN in front of either" \
  --why "Serving through Django without range support is out: the Nexus loader needs it."
```

The question stays open. What got ruled out is recorded, so the next session
does not re-litigate it.

### Note

When you explored and settled nothing. Still worth writing — it stops the same
ground being covered again.

```bash
python3 scripts/resolve.py --map arch.json --part p-widget \
  --note "Walked through Knockout vs Vue; blocked on which Arches version the client lands on."
```

## The `decisions` list

Every write appends a record:

```json
{"id": "d1", "part": "p-queue", "part_label": "Conversion worker",
 "date": "2026-09-20", "source": "session", "kind": "decided",
 "question": "Same-server Celery worker to start, or a dedicated conversion pod?",
 "decided": "Same-host Celery worker to start.",
 "why": "Upload volume is tens per day; revisit if conversion starves the web workers."}
```

`kind` is `decided`, `options` or `note`. Nothing is ever removed from this
list. If a decision is later reversed, append the reversal — do not edit the
original, or the map loses the record of having changed its mind.
