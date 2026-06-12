Create a detailed specification file for a feature or module.

## Instructions

The user will provide arguments in the format: `<name> <description>`

- `$ARGUMENTS` contains the full input — parse the **first word** as the `name` and everything after as the `description`.

Steps to follow:

1. Parse `$ARGUMENTS`: the first word is the folder/spec name, the rest is the description.
2. Create a new folder at `./<name>/` in the current working directory.
3. Inside that folder, create `spec.md` — a detailed specification document.

## Spec file structure

The spec file must be thorough and cover all aspects derivable from the description. Use this structure:

```
# <Name> — Specification

## Overview
A concise summary of what this feature/module does and why it exists.

## Goals
Bullet list of what this spec aims to achieve.

## Non-Goals
What is explicitly out of scope.

## Background & Context
Any relevant context, motivation, or prior art.

## Functional Requirements
Numbered list of concrete, testable requirements (MUST / SHOULD / MAY).

## Technical Design
### Architecture
High-level design and component breakdown.

### Data Model
Key data structures, schemas, or state.

### API / Interface
Inputs, outputs, and contracts (functions, endpoints, events, etc.).

### Dependencies
External systems, libraries, or services required.

## Edge Cases & Error Handling
Known edge cases and how they should be handled.

## Security Considerations
Any auth, validation, or data-safety concerns.

## Performance Considerations
Expected load, latency targets, or bottlenecks to watch.

## Testing Strategy
Unit, integration, and end-to-end test approach.

## Open Questions
Unresolved decisions or things needing further research.

## Revision History
| Date | Author | Change |
|------|--------|--------|
| <today> | — | Initial spec |
```

Fill every section based on the description. Infer reasonable details where the description is brief — mark inferred items with *(assumed)*. Do not leave sections blank; write "N/A" with a one-line reason if truly not applicable.

After creating the files, confirm with: `Created spec at ./<name>/spec.md`
