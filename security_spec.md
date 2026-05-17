# Security Specification for NapNav

## Data Invariants
- Each user has exactly one profile document at `/users/{userId}`.
- All user data (saved places, history, alarms) must exist within the `/users/{userId}/` hierarchy.
- A user can only access (read/write) their own data.
- Timestamps must be server-generated (`request.time`).
- Alarm radius must be a positive number.

## The "Dirty Dozen" Payloads

1. **Identity Theft (Write)**: Attempt to create a user profile with a `userId` that doesn't match `request.auth.uid`.
2. **Access Override (Read)**: User A attempts to read User B's `/history/` subcollection.
3. **Ghost Field (Integrity)**: Attempt to update a `SavedPlace` with an extra field `isVerified: true`.
4. **Invalid Type (Type Safety)**: Attempt to set `radius` to a string `"500"`.
5. **Resource Exhaustion (ID Poisoning)**: Attempt to create a document with a 2KB string as ID.
6. **Self-Promotion**: User attempts to set `role: "admin"` in their profile (not supported in blueprint, but good to test).
7. **Negative Radius**: Attempt to set an alarm radius to `-100`.
8. **Malicious Recurrence**: Attempt to send a `days` array with 1000 items.
9. **Email Spoofing**: Attempt to gain admin access (if implemented) with an unverified email.
10. **Immutable Tampering**: Attempt to change `id` or `dateAdded` on a `SavedPlace` update.
11. **Future Invariant**: Attempt to set `updatedAt` to a past date instead of `request.time`.
12. **Orphaned Write**: Attempt to write to a subcollection for a user that hasn't been created yet (handled by hierarchy).

## Test Runner (Simplified `firestore.rules.test.ts` concept)

```typescript
// Conceptual tests
it('should deny cross-user access', async () => {
  const db = authedApp({ uid: 'userA' });
  await assertFails(getDoc(doc(db, 'users', 'userB')));
});

it('should enforce strict schema on SavedPlace', async () => {
  const db = authedApp({ uid: 'userA' });
  await assertFails(setDoc(doc(db, 'users/userA/savedPlaces/p1'), { name: 'Bug', extra: 'bad' }));
});
```
