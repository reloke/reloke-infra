Date-only handling for Search (searchStartDate/searchEndDate)

- API contract: dates are transported as `YYYY-MM-DD` (no time component). Responses return the same format.
- Validation is timezone-aware via the client-provided IANA timezone (fallback UTC) using `Intl.DateTimeFormat`, so comparisons are calendar-based, not timestamp-based.
- Storage: incoming date-only strings are converted to a stable UTC timestamp (noon UTC) to avoid day shifts, then re-rendered as `YYYY-MM-DD` in responses.
- Frontend formats dates with local calendar values (`formatLocalYmd`) and parses API values with `parseYmdToLocalDate` to avoid UTC shifts.
- Validators compare day keys (`YYYYMMDD`) instead of timestamps to stay immune to server/client timezone differences.
- If the client timezone is missing or invalid, validation falls back to UTC but still honors date-only semantics.
