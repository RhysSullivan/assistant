# Common PostgreSQL Incident Signals

- `55P03` often points to lock contention or explicit lock timeouts.
- `53300` indicates too many connections.
- Long idle-in-transaction sessions are frequently the hidden blocker behind lock trees.
- A high count of active queries is not enough to prove saturation; check wait events.
