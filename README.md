# Photo-to-Procedural-Art (`sketch-maker`)

A high-precision creative image-processing platform that transforms photographs into stylized, progressively drawn procedural vector artwork.

---

## Persistent Project Knowledge System

This repository follows a strict **persistent documentation system** designed for long-term engineering continuity across sessions. All engineering agents and contributors must consult and update these documents:

* **[Project Context & Vision](docs/PROJECT_CONTEXT.md):** Identity, product vision, user journey, and foundational philosophies.
* **[Development Rules](docs/DEVELOPMENT_RULES.md):** 18 non-negotiable engineering principles, refactoring rules, and session protocols.
* **[Actual & Target Architecture](docs/ARCHITECTURE.md):** Modular monorepo architecture, Universal Intermediate Representations (`SubjectModel`, `Stroke`), and pipeline data flows.
* **[Current State Snapshot](docs/CURRENT_STATE.md):** Real-time project status: active phase, what is finished, what is in progress, current blockers, and immediate next steps.
* **[Master Roadmap](docs/ROADMAP.md):** Phases 0 through 12, milestone definitions, and version targets (v0.1 to v5.0+).
* **[Task Tracker](docs/TASK_TRACKER.md):** Granular task statuses, priorities, dependencies, and verification tracking.
* **[Decisions Log (ADRs)](docs/DECISIONS.md):** Architectural decision records capturing context, alternatives, and rationale.
* **[Debugging Log](docs/DEBUG_LOG.md):** Persistent log of root-cause investigations, reproduction steps, and fixes.
* **[Changelog](docs/CHANGELOG.md):** Semantic version history and chronological changes.
* **[Benchmarks & Quality](docs/BENCHMARKS.md):** Performance targets (latency, FPS, RAM), 12-category test set, and quality scoring rubrics.
* **[Testing Strategy](docs/TESTING.md):** Multi-tier testing pyramid and Definition of Done (DoD).

---

## Core Philosophy
> *"The application is the experience; the engine is the product."*
> 
> The core algorithmic pipeline is built headless and decoupled from UI frameworks so it can be deployed on the web (Vercel) today and ported natively to mobile (React Native) tomorrow.
