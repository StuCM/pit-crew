"""Output formats for task packets.

An exporter is a function `write(tasks, outdir, meta) -> [paths written]`.
Register it below and it becomes available as `--format <name>`. Adding a
tracker means adding one file here; nothing in build_tasks.py changes.
"""
from . import markdown, crew, taiga, generic

EXPORTERS = {
    "markdown": markdown.write,
    "crew": crew.write,
    "taiga": taiga.write,
    "generic": generic.write,
}
