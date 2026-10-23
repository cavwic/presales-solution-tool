# Example: conditional log retention response

Requirement: retain key operation, interface, exception, and manual handling logs for at least 180 days.

Available evidence: the current product manual proves configurable retention and role-based log access. It does not prove the proposed server has enough capacity for 180 days under the customer's concurrency and log volume.

Correct handling:

- Response status: conditional.
- Deviation: pending until sizing and customer confirmation are complete.
- Formal response: describe configurable retention, the logs covered, access control, the sizing inputs needed, and the planned capacity calculation.
- Evidence: bind the current product manual and the reviewed sizing record when available.
- Acceptance: configure the policy, generate representative logs, verify access control and retrieval, and inspect the approved retention/capacity record.
- Action: assign concurrency, log volume, and storage confirmation to named customer and solution owners.

Incorrect handling: "The product fully satisfies 180-day log retention" when only a configuration feature is documented.
