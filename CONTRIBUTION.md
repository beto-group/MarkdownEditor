# Contributing to Markdown Editor

Welcome! This document outlines the core developer standards, dynamically loaded dependencies, and caching mechanics required to maintain the advanced implementation of the Markdown Editor component.

---

## Core Architecture Pillars

1. **Fuzzy File Finder**:
   * Instead of a hardcoded path, the component fuzzy searches the vault's file list using `Fuse.js`.
   * Matches are based on the `path`, `name`, and `basename` keys, and the threshold is locked at `0.4` to maintain high precision while remaining robust against typos.

2. **Dynamic Script Caching**:
   * To keep the codebase lightweight and allow offline utility, external scripts (`Fuse.js` and `marked.js`) are loaded on-demand from CDNs.
   * Once downloaded, a local copy is written to the hidden folder `.datacore/script_cache/` in the vault via the `app.vault.adapter` API. All subsequent requests load instantly offline.

3. **Banned Emojis in React UI**:
   * Emojis are strictly prohibited inside the user interface to ensure a modern, premium appearance.
   * Any formatting toolbar options, status states, or feedback vectors MUST be wired directly to Lucide vectors using the built-in `<dc.Icon>` component or plain text.

---

## Local Compilation and Developer Loop

* **Logic Entry Point**: All component coordinates and React views reside in `src/App.jsx`.
* **Index Factory**: The bootstrapper/loader hook that handles namespaces and builds the view resides in `src/index.jsx`.
* **Hot Reload Trigger**: Invoke `dc.app.workspace.activeLeaf.rebuildView()` to flush the view cache. The visualizer compiles your changes instantly without a full application restart.
