# Example with amendment

Tender v1, page 18 states: "System logs shall be retained for at least 90 days." Amendment 2, item 7 states: "Section 4.3.2 is changed to 180 days."

Expected row:

- Original text: preserve both clauses in their separate source records.
- Normalized text: retain key operations and audit logs for at least 180 days.
- Category: technical.
- Mandatory: according to the actual source marker, not assumption.
- Source reference: Amendment 2, item 7, with a linked note to Tender v1, page 18, section 4.3.2.
- Baseline relation: changed.
- Response status: missing evidence.
- Deviation: pending.
- Review state: draft.

The row does not say "satisfied" merely because logging appears in a product manual. Capacity, log scope, access control, and configured retention still require evidence and review.
