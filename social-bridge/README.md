# Social session adapter

Private Cloud Run service for X (twikit) and Instagram (instagrapi). Slack uses its official API directly from the Worker.

The Worker verifies the owner session and CSRF, decrypts the provider session, signs a service identity assertion, exchanges it for a Google ID token, and calls the IAM-protected service. Session updates return to the Worker and are encrypted in D1. The browser receives only normalized content. No account sessions are kept on the service filesystem, and request bodies and exception details are not logged.

Required Worker configuration:
- `SOCIAL_BRIDGE_URL`: canonical Cloud Run URL (also the ID-token audience).
- `SOCIAL_BRIDGE_CREDENTIALS`: encrypted Worker secret containing a service-account JSON credential, with only `roles/run.invoker` on this service. Provisioning is pending explicit credential approval.

Deploy the directory with `gcloud run deploy morisoba-social --source . --project personal-use-493017 --region us-east1 --no-allow-unauthenticated --min-instances 0 --max-instances 1 --concurrency 4 --memory 512Mi --timeout 60`. Never grant `allUsers` invocation. Service-to-service authentication follows https://docs.cloud.google.com/run/docs/authenticating/service-to-service .

Connection Manager accepts Slack OAuth user tokens, X `auth_token` and `ct0` cookies, and Instagram `sessionid`. Enter them only in the authenticated form. Instagram validates the session through the authenticated account endpoint and preserves device settings. No passwords, CAPTCHA solving, challenge bypass, proxies, or paid X API calls are used. Service hosting is metered separately; scale-to-zero is enabled.

Session-based adapters can break when the services change. X encrypted chats may not be available through the legacy inbox endpoints. Real feeds and DMs require acceptance of the owner's sessions and have not been verified. A failed send is never automatically retried: check the original app before trying again.

Slack user-token scopes: channels:read, groups:read, im:read, mpim:read, channels:history, groups:history, im:history, mpim:history, users:read, chat:write. Workspace approval and retention limits still apply.
