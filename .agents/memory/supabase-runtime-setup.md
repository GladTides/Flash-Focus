---
name: Supabase runtime setup
description: Hosted Supabase Auth settings are separate from SQL and MCP database/function deployment.
---

The Supabase MCP can create the database schema and deploy Edge Functions, but hosted Auth provider settings such as Anonymous Sign-Ins must be enabled from the project dashboard.

**Why:** The project accepted the migration and JWT-verified function deployment, but `/auth/v1/signup` returned 422 until Anonymous Sign-Ins is enabled.

**How to apply:** Before testing the shared Flash Focus path, enable Anonymous Sign-Ins under Supabase Authentication → Providers and then verify the browser can create an anonymous session.