// The per-firm job topic whose backlog explains a member who is in the firm but not yet in its
// database. Read by the session module (the member's own bootstrap, me.ts) and the platform module
// (the database-health probe, meta-database-health.ts); the consumer that drains it is
// src/member-provision-consumer.ts, which neither route may import.
/** The topic whose backlog explains a member who is in the firm but not yet in its database. */
export const MEMBER_PROVISION_TOPIC = "member.provision";
