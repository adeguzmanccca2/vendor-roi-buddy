# Vendor ROI Buddy

## Overview
This repository contains a React + TypeScript web app for managing dealerships, vendors, leads, sales, users, and invitations.

## Tech stack
- Frontend: Vite + React + TypeScript
- UI: Tailwind CSS + shadcn/ui-inspired components
- Data/auth: Supabase
- Tests: Vitest + Testing Library

## Key folders
- src/pages: route-level pages such as Auth, Inventory, Sales, Vendors, AdminUsers, and AcceptInvite
- src/components: shared UI and dialogs, including invite and organization-management flows
- src/hooks: auth and organization helpers
- src/integrations/supabase: Supabase client and generated database types
- supabase/functions: edge functions such as invite-user and receive-leads
- supabase/migrations: database schema migrations

## Local development
1. Install dependencies:
   - npm install
2. Start the app:
   - npm run dev
3. Run tests:
   - npm test
4. Build for production:
   - npm run build

## Environment variables
The app expects Supabase env vars in the local environment or .env file, including:
- VITE_SUPABASE_URL
- VITE_SUPABASE_PUBLISHABLE_KEY
- VITE_SUPABASE_PROJECT_ID

The Supabase Edge Functions may also require:
- SUPABASE_URL
- SUPABASE_PUBLISHABLE_KEY or SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY
- BREVO_API_KEY

## Important product flows
- Authentication and invite acceptance happen in src/pages/Auth.tsx and src/pages/AcceptInvite.tsx
- User invitations are initiated from src/components/InviteUserDialog.tsx and handled by supabase/functions/invite-user/index.ts
- Admin user management lives in src/pages/admin/AdminUsers.tsx
- Organization membership and assignment are managed through the dialogs/components under src/components

## Notes for Supabase recovery
If Supabase was paused and is now resumed:
- Confirm the project is reachable before testing auth and invite flows
- Verify that the Edge Functions are deployed and the secrets are configured
- Re-test login, signup, and invitation acceptance flow after the project is healthy

## Conventions
- Keep UI changes aligned with the existing shadcn-style component patterns
- Prefer existing hooks and Supabase client helpers over ad-hoc API logic
- Add or update tests when changing auth, invite, or data-access behavior
