-- Email + password sign-in: scrypt hash, null for Google-only users.
ALTER TABLE "users" ADD COLUMN "passwordHash" TEXT;
