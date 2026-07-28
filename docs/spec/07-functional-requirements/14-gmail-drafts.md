# 7.14 Gmail drafts

> Part of **7. Functional Requirements**

The system must use Gmail OAuth and `drafts.create`.

It must not call:

```text
drafts.send
messages.send
```

Email-draft record:

- application ID;
- recruiter ID;
- Gmail draft ID;
- subject;
- body;
- source links;
- created timestamp;
- scheduled timestamp;
- sent timestamp;
- reply timestamp;
- status.

After the user sends manually, reconciliation may detect:

- draft deleted;
- SENT message with matching headers/thread;
- reply in the thread.

Manual confirmation must remain available.

---
