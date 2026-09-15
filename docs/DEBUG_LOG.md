# DEBUG_LOG.md

## Persistent Bug & Debugging Log

> **Protocol:** When an error occurs:
> `ERROR` → `REPRODUCE` → `IDENTIFY ROOT CAUSE` → `TRACE DEPENDENCIES` → `DESIGN FIX` → `IMPLEMENT FIX` → `TEST FIX` → `CHECK REGRESSION` → `DOCUMENT RESULT`

---

## Log Entries

*(No bugs recorded yet. The repository is in pre-implementation Phase 0).*

---

### Bug Template (Reference)
```markdown
### BUG-XXX: [Short Descriptive Title]
* **Date:** YYYY-MM-DD
* **Status:** [INVESTIGATING | ROOT_CAUSE_IDENTIFIED | FIX_IN_PROGRESS | VERIFIED | CLOSED]
* **Symptom:** What went wrong? What was the observed error message or visual defect?
* **Reproduction Steps:**
  1. Step 1
  2. Step 2
* **Root Cause:** Deep explanation of why the failure occurred.
* **Affected Files:**
  * `path/to/file1.ts`
  * `path/to/file2.ts`
* **Fix Applied:** Description of code change.
* **Verification:** How was the fix verified? (Automated test command or visual confirmation).
* **Regression Risk:** Could this fix negatively impact other styles, image ratios, or performance?
```
