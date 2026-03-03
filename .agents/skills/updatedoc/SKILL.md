---
name: updatedoc
description: Updates a document by appending a new line of content at the end each time it's called.
---

# Skill Instructions

This skill handles automatic document updates. Use it whenever a process requires logging changes or appending notes to a file without overwriting existing content.

## Detailed Functionality
- **Input**: Path to the document (e.g., a Markdown or text file) and the new content to append.
- **Process**: Open the file in append mode, add the new line, and save it. Include a timestamp for tracking.
- **Output**: Confirmation message with the updated file path and a preview of the added line.
- **When to Use**: After any modification in a workflow, research, or code change to maintain an audit trail.

## Step-by-Step Procedure
1. Receive the document path and new content as inputs.
2. Check if the file exists; create it if not.
3. Append the new line (e.g., prefixed with current date/time).
4. Handle errors like permission issues gracefully.

## Examples
- Input: File = "notes.md", Content = "Added feature X"
  Output: Appended "2026-03-03: Added feature X" to notes.md.

- Script Reference: If needed, use a helper script like [./append-script.py](./append-script.py) for custom logic.

## Guidelines
- Always append, never overwrite.
- Limit line length to 80 characters for readability.
- Support common formats: .md, .txt, .log.