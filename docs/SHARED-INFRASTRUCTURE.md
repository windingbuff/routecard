# Shared application infrastructure

`lib/` and `public/` provide shared project persistence, HTTP/payment handling, form rendering, history and review UI across nine AI-assisted evaluation repositories. They are intentionally common code. This is not evidence of nine independently developed application or payment frameworks.

`core.mjs`, `project.mjs`, business fixtures and `project.test.mjs` define the distinct domain logic, structured forms, output views, release blockers and actual file exports. Each repository runs standalone and owns its private workspace directory.

