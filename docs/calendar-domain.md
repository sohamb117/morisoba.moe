# calendar.morisoba.moe

The hosted portal is registered for this domain. DNS verification is pending.

Add these records to the morisoba.moe zone:

| Type | Name | Value |
| --- | --- | --- |
| CNAME | calendar | custom-domains.chatgpt.site. |
| TXT | _openai-site-verification.calendar | openai-site-verification=AEXyafKrWCDDqag0_pRU28RKuH8saysi_YpX9J58yvQ |
| TXT | _cf-custom-hostname.calendar | 8f51a66d-0315-47ae-bf11-ce66f27708d6 |

These records select the separately hosted portal with its own database, not the original morisoba Worker. Preserve the root domain's existing records. Do not also attach this hostname to the original Worker.

The portal is at /admin/; booking pages use /<booking_name>. The preview remains private to the owner account in addition to the admin password. Guest bookings require launching with the intended audience and configuring Google Calendar. Admin passwords and calendar credentials are secrets, absent from this repository.

After DNS verification, refresh the domain status and verify HTTPS, admin login and a named page. Registration alone does not mean the custom hostname is live.
