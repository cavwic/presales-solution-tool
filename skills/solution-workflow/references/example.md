# Example: enterprise knowledge assistant

Input files are a discovery note, a text-based tender PDF, one amendment, a product manual, and a deployment guide. The discovery note asks for traceable answers. The tender adds a 180-day log retention requirement.

Expected handling:

1. Keep the traceability request in the discovery baseline.
2. Extract the 180-day clause into the tender baseline with its page locator.
3. Link the tender row to the discovery row and mark it changed.
4. Mark the response conditional until concurrency, log volume, and storage capacity are confirmed.
5. Bind the logging manual as evidence only for configurable retention. Do not claim that capacity is sufficient.
6. Add an internal action for the customer IT owner and solution owner to confirm the missing sizing inputs.
7. Draft the logging and audit section with the condition visible.
8. Keep the row unapproved until the response and acceptance method are reviewed.
