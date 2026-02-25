# Admin Dashboard Migration Guide

## Overview

The admin dashboard has been redesigned with a focus on security and functionality. This guide explains the changes and how to use the new system.

## What Changed

### 🔒 Security Improvements

1. **Admin dashboard is no longer in the public bundle**
   - Previously: Admin UI was part of the React SPA, visible to anyone who inspected the code
   - Now: Admin UI is served as a standalone page, only accessible after authentication

2. **Server-side rendering for admin**
   - Previously: Client-side React Router handled admin routes
   - Now: Server-side HTML template prevents code exposure

3. **Stronger authentication flow**
   - Session tokens with 24-hour expiry
   - Automatic cleanup of expired tokens
   - All admin API calls require authentication

### 📊 New Features

1. **Live Kiosk Preview**
   - See what's currently displayed on the kiosk in real-time
   - Screenshot updates every 3 seconds
   - Shows metadata about the current ad (name, submitter, timestamps)

2. **Enhanced Ad Metadata**
   - **Submitted At**: Timestamp when ad was submitted
   - **Approved At**: Timestamp when admin approved the ad
   - Full audit trail for every ad

3. **Simplified, Functional UI**
   - Less design-heavy, more data-dense
   - Faster approval workflow
   - Better visibility of system stats

## Migration Steps

### For Administrators

1. **Access the new admin dashboard**:
   ```
   http://localhost:6969/admin
   ```

2. **Login with admin password**:
   - Default: `iloveblackrock` (⚠️ **CHANGE THIS IN PRODUCTION**)
   - Set via environment variable: `ADMIN_PASSWORD=your-password`

3. **Workflow changes**:
   - Submitted ads now show submitter info and submission time
   - Preview shows live kiosk display with current ad metadata
   - Approve/reject actions are more prominent

### For Developers

1. **Rebuild the dashboard**:
   ```bash
   cd dash
   npm install
   npm run build
   ```

2. **Rebuild the launcher**:
   ```bash
   cd launcher
   go build
   ```

3. **Environment variables**:
   ```bash
   export ADMIN_PASSWORD="your-secure-password"
   export PLAYLIST_URL="http://localhost:6969/api/playlist"
   ```

4. **Test authentication**:
   - Try accessing `/admin` without logging in (should see login page)
   - Try accessing `/api/admin/state` without token (should get 401)
   - Login and verify all admin features work

### For CI/CD

Update your build pipeline to:

1. **Build the dashboard** (which now excludes admin routes from the SPA):
   ```bash
   cd dash
   npm ci
   npm run build
   cp -r dist/* ../launcher/static/
   ```

2. **Build the launcher** (which embeds admin_template.html):
   ```bash
   cd launcher
   go build -ldflags "-X main.BuildNumber=${BUILD_NUMBER}"
   ```

3. **Bundle everything**:
   ```bash
   zip shell-ads-bundle-windows-x64.zip \
     launcher.exe \
     kiosk.exe
   ```

## New Admin Dashboard Features

### 1. Live Kiosk Preview

```
┌─────────────────────────────────────────┐
│  Current Kiosk Display                  │
├─────────────────────────────────────────┤
│  [Screenshot of current ad]             │
│                                         │
│  Ad Name: Spring Festival 2026          │
│  Type: image | Duration: 10s            │
│  Submitted by: John Doe (john@umd.edu)  │
│  Submitted: Feb 25, 2026 2:30 PM        │
│  Approved: Feb 25, 2026 2:35 PM         │
│                                         │
│  Last updated: 3 seconds ago            │
└─────────────────────────────────────────┘
```

### 2. Enhanced Ad Cards

Each ad now shows:
- Submitter name and email
- Submission timestamp
- Approval timestamp (if approved)
- Ad duration and type
- Source URL (if applicable)

### 3. System Stats

Real-time monitoring:
- Kiosk status (Running/Stopped)
- Number of active ads
- Pending submissions count
- Kiosk restart count

### 4. Streamlined Actions

- **Approve All**: Quickly approve all pending submissions
- **Quick Preview**: Click ⊙ icon to preview any ad
- **Instant Feedback**: Toast notifications for all actions
- **Navigation Controls**: ← → buttons to control kiosk from dashboard

## API Changes

### New Endpoints

```
POST   /api/kiosk/screenshot      - Kiosk uploads screenshot (JPEG bytes)
POST   /api/kiosk/current-ad      - Kiosk reports current ad ID
GET    /api/admin/screenshot      - Admin retrieves kiosk preview
GET    /admin                     - Admin dashboard page
```

### Modified Endpoints

```
GET    /api/admin/state           - Now includes approvedAt timestamp
```

### Response Format Changes

**AdminState** now includes `approvedAt`:
```json
{
  "active": [...],
  "approved": [...],
  "submitted": [
    {
      "id": "ad-123",
      "name": "Spring Festival",
      "submitterName": "John Doe",
      "submitterEmail": "john@umd.edu",
      "submittedAt": "2026-02-25T14:30:00Z",
      "approvedAt": "2026-02-25T14:35:00Z"
    }
  ]
}
```

**AdminScreenshot** response:
```json
{
  "hasScreenshot": true,
  "screenshot": [255, 216, ...],  // JPEG bytes
  "screenshotTime": "2026-02-25T14:40:23Z",
  "currentAd": {
    "id": "ad-123",
    "name": "Spring Festival",
    "type": "image",
    "durationMs": 10000,
    "submitterName": "John Doe",
    "submitterEmail": "john@umd.edu",
    "submittedAt": "2026-02-25T14:30:00Z",
    "approvedAt": "2026-02-25T14:35:00Z"
  }
}
```

## Troubleshooting

### Admin Dashboard Not Loading

1. Check that launcher is running: `curl http://localhost:6969/api/admin/stats`
2. Verify admin password is set: `echo $ADMIN_PASSWORD`
3. Clear sessionStorage and try logging in again

### Screenshots Not Showing

1. Verify kiosk is running and playing ads
2. Check browser console for CORS errors
3. Screenshots only work for image/video ads (not HTML iframes)
4. Wait up to 3 seconds for first screenshot to arrive

### Authentication Issues

1. Tokens expire after 24 hours - log in again
2. Restart launcher to clear all tokens
3. Check that `Authorization: Bearer <token>` header is sent

### Missing Metadata

1. `submittedAt` is only available for ads submitted through the dashboard
2. `approvedAt` is only set when admin approves an ad
3. Older ads may not have these fields (they were added in this update)

## Rollback Plan

If you need to revert to the old dashboard:

1. **Restore the old App.tsx**:
   ```bash
   git checkout HEAD~1 dash/src/App.tsx
   ```

2. **Remove security blocks**:
   ```bash
   git checkout HEAD~1 launcher/main.go
   ```

3. **Rebuild**:
   ```bash
   cd dash && npm run build
   cd ../launcher && go build
   ```

Note: You will lose the security improvements and new features.

## Questions?

- Check the [SECURITY.md](./SECURITY.md) document for security details
- Review [README.md](./README.md) for general usage
- Open an issue on GitHub for bugs or feature requests

---

Last updated: 2026-02-25
