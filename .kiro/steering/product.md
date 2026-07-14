# Product Overview

a10dit is a serverless event check-in system with real-time presenter queue management for meetups and community events.

## Core Features

- QR code-based event check-in
- Google Sign-In integration for auto-fill
- Optional presenter queue signup
- Real-time organizer dashboard
- Product origin tracking for attendees
- Access code sharing for active events (link to event game/presentation interface)

## Current State

Multi-tenant platform deployed at:
- Public site: `https://a10dit.com` (redirects to `app.a10dit.com` when no path)
- App (organizers + admin): `https://app.a10dit.com`
  - Organizer routes: `/app/dashboard`, `/app/events`, `/app/settings`, etc.
  - Admin routes: `/admin/system`, `/admin/users`, `/admin/finance`, etc.
  - Public routes: `/`, `/pricing`, `/login`, `/register`
- Event check-in (tiered URL scheme):
  - Free/$1 tier: `https://a10dit.com/{organizerSlug}/{eventSlug}`
  - Free/$1 QR: `https://a10dit.com/qr/{organizerSlug}/{eventSlug}`
  - $3 Starter: `https://{organizerSlug}.a10dit.com/{eventSlug}`
  - $3 Starter QR: `https://{organizerSlug}.a10dit.com/qr/{eventSlug}`
  - $10 Pro: `https://{customDomain}/{eventSlug}` (CNAME to CloudFront, DNS TXT verification)
  - $10 Pro QR: `https://{customDomain}/qr/{eventSlug}`

## Target State

Multi-tenant platform where federated admins can create and manage their own events. Each event gets unique URLs and QR codes. Organizers manage only their events while platform admin oversees the system.

## User Personas

1. Platform Admin - Approves organizers, manages system
2. Event Organizer - Creates and manages their events
3. Attendee - Checks in and optionally joins presenter queue

## Cost

~$1/month typical usage (AWS Free Tier eligible)
