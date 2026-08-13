// The physical table names, in one place. Every statement builder in this directory interpolates
// from here rather than spelling a name out, so a rename is one edit and so test/schema-name-sync.test.ts
// can assert that each of these exists in the control-plane schema — a statement referring to a
// table nobody created fails at runtime otherwise, and only on the path that uses it.
export const COMMUNITY_PROFILE_TABLE = "community_profile";
export const COMMUNITY_POST_TABLE = "community_post";
export const COMMUNITY_VOTE_TABLE = "community_vote";
export const COMMUNITY_COMMENT_TABLE = "community_comment";
export const COMMUNITY_FLAG_TABLE = "community_flag";
export const COMMUNITY_MODERATION_ACTION_TABLE = "community_moderation_action";
export const COMMUNITY_POST_NUMBER_COUNTER_TABLE = "community_post_number_counter";
export const COMMUNITY_POST_NUMBER_ALLOCATION_TABLE = "community_post_number_allocation";

export const COMMUNITY_TABLES = [
  COMMUNITY_PROFILE_TABLE,
  COMMUNITY_POST_TABLE,
  COMMUNITY_VOTE_TABLE,
  COMMUNITY_COMMENT_TABLE,
  COMMUNITY_FLAG_TABLE,
  COMMUNITY_MODERATION_ACTION_TABLE,
  COMMUNITY_POST_NUMBER_COUNTER_TABLE,
  COMMUNITY_POST_NUMBER_ALLOCATION_TABLE,
] as const;
