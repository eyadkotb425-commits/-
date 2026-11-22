# Mashroei Firestore Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. **Verified-Only Public Data**: Public search and AI trip assistant read ONLY `/places` and `/routes`. Neither collection can be written by non-admin users.
2. **No Auto-Approval Without Hybrid Audit**: Any user-submitted document in `/place_suggestions` or `/route_suggestions` MUST start with `status == 'pending'` (admins may seed `field_check` or transition statuses via manual review or hybrid AI batch approval).
3. **Identity Integrity**: Every community submission (`place_suggestions`, `route_suggestions`, `reports`) MUST have `submittedByUid == request.auth.uid`, and `request.auth.token.email_verified == true`.
4. **Immutable Authorship & Creation Timestamp**: `submittedByUid` and `createdAt` cannot be altered after creation; `createdAt` and `updatedAt` are validated against `request.time`.
5. **PII & Admin Isolation**: `/admins/{uid}` is readable only by the owner (`request.auth.uid == uid`) or an existing admin. Non-admins cannot create or mutate `/admins/{uid}`.
6. **Strict Schema Enforcement**: Every document create/update checks `keys().hasAll(...)` and `keys().hasOnly(...)` to block shadow fields, plus explicit `.size()` bounds on all strings and lists.
7. **Terminal State Locking**: Once a suggestion is `approved` or `rejected` (or a report is `resolved` or `dismissed`), non-admin users cannot modify it.

## 2. The "Dirty Dozen" Adversarial Payloads (Must Return PERMISSION_DENIED)
1. **Unverified Place Injection**: Non-admin writes directly to `/places/hacked-place` with `isActive: true`.
2. **Unverified Route Injection**: Non-admin writes directly to `/routes/fake-route` with unverified stops.
3. **Auto-Approval Bypass**: Contributor creates `/place_suggestions/s1` with `status: "approved"`.
4. **Shadow Field Injection**: Contributor creates `/place_suggestions/s2` with extra ghost field `isVerified: true`.
5. **Identity Spoofing**: User A creates `/reports/r1` with `submittedByUid: "user-b-uid"`.
6. **Self-Privilege Escalation**: Non-admin writes `/admins/{myUid}` to grant themselves admin role.
7. **Unverified Email Bypass**: User with `email_verified: false` attempts to submit `/place_suggestions/s3`.
8. **ID Poisoning**: User attempts to create `/place_suggestions/invalid$id*with!bad@chars` or >128 char ID.
9. **Denial-of-Wallet String Bloat**: User submits `/reports/r2` with a 50,000-char `details` string.
10. **Array Overflow**: User submits `/route_suggestions/rs1` with 100 `stopIds` (> max 25).
11. **Timestamp Forgery**: User submits `/place_suggestions/s4` with backdated `createdAt` (`!= request.time`).
12. **Blanket List Scraping**: Non-admin runs `list` on `/place_suggestions` without filtering `where('submittedByUid', '==', uid)`.
