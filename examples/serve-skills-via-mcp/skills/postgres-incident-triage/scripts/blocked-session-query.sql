select
  blocked.pid as blocked_pid,
  blocked.query as blocked_query,
  blocking.pid as blocking_pid,
  blocking.query as blocking_query,
  blocked.wait_event_type,
  blocked.wait_event
from pg_stat_activity blocked
join pg_locks blocked_locks
  on blocked.pid = blocked_locks.pid
join pg_locks blocking_locks
  on blocked_locks.locktype = blocking_locks.locktype
 and blocked_locks.database is not distinct from blocking_locks.database
 and blocked_locks.relation is not distinct from blocking_locks.relation
 and blocked_locks.page is not distinct from blocking_locks.page
 and blocked_locks.tuple is not distinct from blocking_locks.tuple
 and blocked_locks.virtualxid is not distinct from blocking_locks.virtualxid
 and blocked_locks.transactionid is not distinct from blocking_locks.transactionid
 and blocked_locks.classid is not distinct from blocking_locks.classid
 and blocked_locks.objid is not distinct from blocking_locks.objid
 and blocked_locks.objsubid is not distinct from blocking_locks.objsubid
join pg_stat_activity blocking
  on blocking.pid = blocking_locks.pid
where not blocked_locks.granted
  and blocking_locks.granted
  and blocked.pid <> blocking.pid;
