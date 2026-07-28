# 7.2 Discovery

> Part of **7. Functional Requirements**

The system must support pluggable source adapters:

- `GithubMarkdownFeedAdapter`;
- `GreenhouseBoardAdapter`;
- `LeverBoardAdapter`;
- `AshbyBoardAdapter`;
- optional `JobSpyAdapter`, disabled by default;
- manual URL import.

Every source result must record:

- source type;
- source URL;
- source external ID;
- fetched timestamp;
- raw title;
- raw company;
- raw location;
- raw application URL;
- normalized result;
- content hash.
