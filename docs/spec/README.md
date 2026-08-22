# MGR Technical Specification

This directory contains the technical specification for MGR, a professional brewery management system.

## Quick Reference

| Document | Contents | When to Use |
|----------|----------|-------------|
| [Overview](./overview.md) | Core principles, key flows, what MGR does | Understanding the system's purpose |
| [Architecture](./architecture.md) | Tech stack, design decisions, performance | Technical implementation details |
| [Decisions](./decisions.md) | Schema review decisions (DEC-*) | Understanding why things are built a certain way |
| [AI Integration](./ai-integration.md) | AI agent patterns, queries, brewing science | AI assistance and automation |
| [Auth](./auth.md) | Roles, permissions, RLS policies | Implementing access control |
| [Modules](./modules.md) | Feature specifications for all modules | Building or modifying features |
| [Workflows](./workflows.md) | State machines, allocations, rollback rules | Implementing state transitions |
| [Operations](./operations.md) | Units, notifications, reporting, storage | Operational concerns |
| [Integrations](./integrations.md) | QuickBooks, Slack, Square | External system integrations |
| [UI Guidelines](./ui-guidelines.md) | Design patterns, navigation, components | Building UI |
| [API](./api.md) | Route structure, response formats | API development |
| [Migration](./migration.md) | Data migration from Payload | System migration |
| [Appendices](./appendices.md) | Env vars, glossary, enums | Reference data |

## Related Documentation

- **[Data Model](../data-model/)** - Database schema details (source of truth for tables)

## Document Conventions

### Decision Status

Schema and architecture decisions use these status markers:

| Status | Meaning |
|--------|---------|
| **Implemented** | Migration created and applied |
| **Documented** | Data model docs updated, migration pending |
| **Rejected** | Considered but not adopted |
| *(no status)* | Proposed, not yet reviewed |

### Decision Prefixes

- `DEC-` - Architecture decision
- `DEC-HP-` - High priority schema decision
- `DEC-MP-` - Medium priority schema decision
- `DEC-GAP-` - Gap resolution
- `DEC-RED-` - Redundancy resolution
- `DEC-SIMP-` - Simplification decision
- `DEC-PERF-` - Performance decision
- `DEC-AI-` - AI integration decision

## How to Use This Specification

1. **New to the project?** Start with [Overview](./overview.md) to understand what MGR does
2. **Building a feature?** Check [Modules](./modules.md) for the feature spec, then [Workflows](./workflows.md) for state handling
3. **Need schema details?** Check [Decisions](./decisions.md) for the reasoning, then [Data Model](../data-model/) for table definitions
4. **Integrating external systems?** See [Integrations](./integrations.md)
5. **Looking up an enum or constant?** See [Appendices](./appendices.md)

---

*Version 1.0 | January 2026*
