# Security Architecture

## Overview

This document describes the security measures implemented to protect the admin dashboard and prevent unauthorized access to administrative functionality.

## Admin Dashboard Security

### 1. **Separated Admin Build**

The admin dashboard is **NOT** included in the static client-side bundle served to end users. This prevents:

- Reverse engineering of admin functionality
- Discovery of admin API endpoints through client code inspection
- Access to admin UI components by examining browser developer tools

**Implementation:**
- Admin dashboard is served as a standalone server-side rendered HTML page (`/launcher/admin_template.html`)
- The React-based dashboard build in `/dash/` excludes the Admin component from the production bundle
- Admin routes (`/admin`, `/admin/*`) are blocked from the SPA static file handler

### 2. **Authentication Required**

All admin functionality requires authentication:

- **Password-based login**: Admin password is set via `ADMIN_PASSWORD` environment variable (defaults to "iloveblackrock" - **MUST be changed in production**)
- **Session tokens**: Upon successful login, a secure token is generated and stored in sessionStorage
- **Token expiry**: Tokens expire after 24 hours
- **Token validation**: All admin API endpoints require a valid Bearer token in the Authorization header

### 3. **API Endpoint Protection**

All admin endpoints are protected by the `requireAdmin` middleware:

```
POST   /api/admin/auth                    - Login (no auth required)
GET    /api/admin/state                   - Get ad state (requires auth)
GET    /api/admin/stats                   - Get system stats (requires auth)
GET    /api/admin/screenshot              - Get kiosk preview (requires auth)
DELETE /api/admin/submitted/{id}          - Reject submitted ad (requires auth)
POST   /api/admin/submitted/{id}/approve  - Approve submitted ad (requires auth)
DELETE /api/admin/active/{id}             - Delete active ad (requires auth)
PUT    /api/admin/reorder                 - Reorder playlist (requires auth)
POST   /api/admin/restart-kiosk           - Restart kiosk process (requires auth)
... and more
```

### 4. **Route Blocking**

The SPA handler explicitly blocks `/admin` routes from being served from static files:

```go
if strings.HasPrefix(r.URL.Path, "/admin") {
    http.Error(w, "Forbidden", http.StatusForbidden)
    return
}
```

This ensures that even if someone tries to access `/admin` directly, they get a 403 Forbidden response unless they go through the proper admin page handler.

### 5. **Server-Side Rendering**

The admin dashboard is served as a complete HTML page with inline JavaScript. Benefits:

- No client-side routing for admin pages
- All admin logic stays on the server
- Cannot be reverse-engineered from bundled JavaScript
- Secure by default - no code exposure

### 6. **Security Headers**

The admin page handler sets strict security headers:

```
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Cache-Control: no-cache, no-store, must-revalidate
```

## Data Security

### 1. **Submission Tracking**

All ad submissions are tracked with metadata:

```go
type submissionRecord struct {
    Ad           kioskAd
    OwnerSub     string    // Google account ID
    OwnerEmail   string    // Submitter email
    OwnerName    string    // Submitter name
    Stage        string    // submitted|approved|active|removed
    ShownOnKiosk bool      // Whether displayed on kiosk
    SubmittedAt  time.Time // When submitted
    ApprovedAt   time.Time // When approved by admin
}
```

This provides a full audit trail of every ad submission.

### 2. **Google OAuth Integration**

User submissions require Google authentication:

- ID tokens are verified via Google's tokeninfo endpoint
- Token results are cached to prevent excessive API calls
- Only authenticated users can submit or view their own ads

### 3. **Token Cleanup**

Expired tokens are automatically cleaned up every 15 minutes to prevent memory leaks:

```go
go cleanupTokens()
```

## Kiosk Security

### 1. **Screenshot Privacy**

Kiosk screenshots are:
- Sent to the launcher every 3 seconds
- Stored only in memory (not on disk)
- Only accessible to authenticated admins
- Overwritten with each new screenshot (no history)

### 2. **Current Ad Tracking**

The kiosk reports which ad is currently playing:
- Used for admin preview metadata
- No sensitive user data exposed
- Only accessible via authenticated admin API

### 3. **Limited Public API**

Public kiosk endpoints are minimal and read-only:

```
GET  /api/playlist           - Current active playlist (read-only)
POST /api/kiosk/report-shown - Mark ad as shown (write-only, no return data)
POST /api/kiosk/screenshot   - Upload screenshot (write-only)
POST /api/kiosk/current-ad   - Report current ad (write-only)
```

## Best Practices

### For Production Deployment

1. **Change the admin password immediately**:
   ```bash
   export ADMIN_PASSWORD="your-secure-password-here"
   ```

2. **Use HTTPS**: Always deploy behind a reverse proxy with TLS:
   ```
   Cloudflare Tunnel / nginx / Caddy → launcher:6969
   ```

3. **Restrict network access**: Use firewall rules to limit who can reach port 6969:
   ```bash
   # Only allow from trusted IPs
   ufw allow from 10.0.0.0/8 to any port 6969
   ```

4. **Monitor logs**: The launcher logs all admin actions:
   ```
   Admin: login
   Admin: approved submitted "ad-123" → approved queue
   Admin: removed active "ad-456"
   ```

5. **Regular updates**: Keep the system updated via the built-in updater or manual deployments

### For Developers

1. **Never commit credentials**: Admin password should only be in environment variables
2. **Test authentication**: Always verify that admin endpoints reject unauthenticated requests
3. **Audit new endpoints**: Any new admin functionality must use `requireAdmin` middleware
4. **Code review**: Admin-related changes should be carefully reviewed for security implications

## Threat Model

### Protected Against

✅ **Unauthorized admin access** - Password + token required
✅ **Client-side code inspection** - Admin code not in public bundle
✅ **Reverse engineering** - Server-side rendering, no exposed logic
✅ **Token theft** - Tokens stored in sessionStorage (not localStorage), expire after 24h
✅ **CSRF attacks** - API requires explicit Authorization header
✅ **XSS in admin panel** - All user content properly escaped

### Additional Considerations

⚠️ **Physical access to server** - Anyone with SSH/RDP access can read env vars
⚠️ **Network sniffing** - Use HTTPS in production
⚠️ **Brute force attacks** - No rate limiting implemented (add if needed)
⚠️ **Session fixation** - Tokens are random 16-byte hex strings (collision resistant)

## Compliance Notes

This system handles:
- User email addresses (from Google OAuth)
- User names
- Screenshot data from kiosk displays
- Ad submission metadata

Ensure compliance with:
- **GDPR**: If operating in EU, implement data deletion requests
- **FERPA**: If university-operated with student data
- **Local privacy laws**: Check your jurisdiction

## Incident Response

If admin credentials are compromised:

1. **Immediately change the admin password**:
   ```bash
   export ADMIN_PASSWORD="new-secure-password"
   systemctl restart shell-ads-launcher
   ```

2. **Invalidate all tokens**: Restart the launcher (all tokens are in-memory)

3. **Audit logs**: Check launcher logs for unauthorized actions

4. **Review submissions**: Check for any malicious ads that were approved

5. **Update all systems**: Ensure you're running the latest version

## Contact

For security concerns or to report vulnerabilities, contact:
- GitHub Issues: https://github.com/exoad/ShellNews-Bernard/issues (for non-sensitive bugs)
- Direct email: [Add security contact email]

---

Last updated: 2026-02-25
