"""Everything, as JSON. The base for any tracker not covered here — read this
to see what an exporter receives before writing one."""
import json


def write(tasks, outdir, meta):
    p = outdir / "tasks.json"
    p.write_text(json.dumps({"plan": meta["plan"], "tasks": tasks},
                            indent=2, ensure_ascii=False, default=str) + "\n",
                 encoding="utf-8")
    return [p]
