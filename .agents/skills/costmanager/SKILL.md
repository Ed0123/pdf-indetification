---
name: costmanager
description: Evaluates running costs during research or changes, suggests cheaper alternatives if costs are high while maintaining similar function/quality.
---

# Skill Instructions

This skill acts as a cost manager role. Invoke it during planning, research pivots, or modifications to assess and optimize expenses.

## Detailed Functionality
- **Input**: Current plan/research direction, estimated costs, and target function/quality.
- **Process**: Analyze costs, flag if excessive, research and propose alternatives.
- **Output**: Cost assessment report with alternatives if needed.
- **When to Use**: Before committing to a new direction or tool to avoid budget overruns.

## Step-by-Step Procedure
1. Parse the proposed change and extract cost elements (e.g., API calls, compute resources).
2. Compare against thresholds (e.g., >$100/month is "high").
3. If high, search for alternatives (e.g., open-source vs. paid SaaS).
4. Ensure alternatives match function (e.g., same API endpoints) and quality (e.g., reliability metrics).

## Examples
- Input: "Switch to AWS Lambda for hosting, estimated $150/month"
  Output: "Cost high. Alternative: Vercel free tier for similar serverless hosting with auto-scaling."

- Input: "Use premium AI model for analysis"
  Output: "Cost moderate. Alternative: OpenAI's cheaper GPT-3.5 if quality drop is acceptable."

## Guidelines
- Prioritize free/open-source options.
- Include pros/cons for each alternative.
- Reference cost calculators if available (e.g., AWS pricing tool).