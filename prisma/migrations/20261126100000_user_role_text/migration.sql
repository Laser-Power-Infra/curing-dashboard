-- users.roles (a list) becomes users.role (plain text): 'user' by default, 'admin' for an admin.
-- More than one role is written with commas, e.g. 'lab, production_head'.
ALTER TABLE "users" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'user';
UPDATE "users" SET "role" = lower(array_to_string("roles", ', ')) WHERE cardinality("roles") > 0;
ALTER TABLE "users" DROP COLUMN "roles";
