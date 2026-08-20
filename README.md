# Akkis Salon Full-Stack Website

## Run locally
1. Install Node.js 18+.
2. Open a terminal in `backend`.
3. Create `.env` with your local port, admin key, and notification credentials.
4. Run `npm install` then `npm start`.
5. Visit http://localhost:3000
6. Dashboard: http://localhost:3000/dashboard

The backend uses Express + SQLite. Bookings are stored in `backend/akkis.db`.

Set `WHATSAPP_NUMBER` in `.env` using digits only, e.g. `919876543210`.

Booking notifications are sent to you by email/SMS, and the customer receives a confirmation email and WhatsApp message when valid SMTP and Twilio WhatsApp credentials are configured. Set `WHATSAPP_FROM` to a WhatsApp-enabled Twilio sender in `.env`.

Do not publish `.env`, your admin password, or the database publicly.

## Before production

- Set a long random `ADMIN_KEY` and a production `FRONTEND_ORIGIN`.
- Replace all SMTP and Twilio placeholders with valid provider credentials.
- Run behind HTTPS and configure a process manager, firewall, database backups, and log monitoring.
- Confirm business hours, prices, cancellation terms, and contact details before launch.
- Review `privacy.html` and `terms.html` with the business owner or legal adviser.

The booking API validates future dates, prevents duplicate date/time slots, supports cancellation, and records notification delivery status for dashboard review.
