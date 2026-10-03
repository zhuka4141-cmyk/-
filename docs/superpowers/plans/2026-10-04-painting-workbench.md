# Painting Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax.

**Goal:** Make model painting pleasant and reliable on desktop, phone, tablet, and Apple Pencil.

**Architecture:** Keep Three.js and zero server dependencies. Add pure input/pressure helpers, richer stroke metadata, an eraser and redo stack, and a responsive tool strip.

**Tech Stack:** Three.js 0.160.0, native Pointer Events, Node test runner.

## Global Constraints

- Preserve zero CDN deployment and the existing model part hierarchy.
- Automatic mode maps `pen` to paint and `touch` to orbit.
- Painting remains attached to part-local coordinates.
- Maximum 6,000 stamps per model.

## Tasks

- [x] Add failing input tests for mode classification and pressure normalization, then implement `classifyPointerInput`, `normalizePressure`, and coalesced sample handling in `interaction.js`.
- [x] Add failing paint tests for opacity and soft/hard brush metadata; implement v3 paint serialization, eraser removal and redo restoration.
- [x] Add tool controls and a compact responsive toolbar to `index.html` and `style.css`, including visible active tool, pressure toggle, opacity and eraser.
- [x] Update `app.js` to use pointer capture in the correct phase, fix automatic mode camera control after loading, consume Pencil pressure/coalesced events, and maintain undo/redo stacks.
- [ ] Run all tests, syntax checks, detector, and the local static server smoke check. Commit and publish the updated Pages branch.
