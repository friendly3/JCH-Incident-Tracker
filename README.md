# JCH Pham AusPost Incident Tracker

A secure incident tracking application for courier operations, built with SvelteKit and Supabase.

## Features

- **User Authentication** - Secure login/signup with Supabase Auth
- **Incident Management** - Create, update, and track incidents
- **Team Management** - Manage team leaders and drivers
- **Secure Data Isolation** - Row-Level Security (RLS) ensures users only see their own data
- **Real-time Dashboard** - Analytics and incident overview
- **Facility Management** - Track facility information and compliance

## Tech Stack

- **SvelteKit 2.50.2** - Full-stack framework with SSR
- **Svelte 5** - Reactive components with latest runes
- **Supabase** - Backend, authentication, and database
- **Tailwind CSS** - Responsive styling
- **TypeScript** - Type-safe development
- **Chart.js** - Data visualization

## Getting Started

### Prerequisites

- Node.js 18+
- Supabase project (create at supabase.com)

### Installation

```bash
npm install
```

### Environment Setup

Copy `.env.example` to `.env.local` and fill in your Supabase credentials:

```bash
cp .env.example .env.local
```

### Development

```bash
npm run dev
```

Visit `http://127.0.0.1:5173` and create an account.

### Build

```bash
npm run build
npm run preview
```

### Deploy to Cloudflare Pages

1. Push this repo to GitHub and connect it in Cloudflare Pages.
2. Configure the build:
   - **Build command:** `npm run build`
   - **Build output directory:** `.svelte-kit/cloudflare`
   - **Node.js version:** 18 or 20
3. Set environment variables (Production and Preview):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. In Supabase → Authentication → URL Configuration, add your Pages URL (e.g. `https://your-project.pages.dev`) as Site URL and redirect URL.
5. Apply all SQL migrations in `supabase/migrations/` via the Supabase SQL editor.

## Project Structure

```
src/
├── routes/          # SvelteKit pages and layouts
├── lib/
│   ├── components/  # Reusable Svelte components
│   ├── data/        # Data stores and types
│   └── supabase/    # Database queries and client
└── app.html         # HTML entry point
```

## Security

- ✅ Server-side JWT verification
- ✅ Row-Level Security (RLS) on all tables
- ✅ Protected routes with authentication guards
- ✅ Secure logout with session clearing

## Developing

Once you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:

```sh
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Building

To create a production version of your app:

```sh
npm run build
```

You can preview the production build with `npm run preview`.

This project uses [`@sveltejs/adapter-cloudflare`](https://svelte.dev/docs/kit/adapter-cloudflare) for Cloudflare Pages deployment.
