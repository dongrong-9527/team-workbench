// Business prose requests: 100 entries with 4,000 units each, plus bounded
// metadata. Even six-byte JSON Unicode escapes fit below 4 MiB. Auth stays 16 KiB;
// report generation/edit policies and their route limits are independent.
export const BUSINESS_BODY_LIMIT = 4 * 1024 * 1024;
export const CHECK_ENTRY_LIMIT = 100;
