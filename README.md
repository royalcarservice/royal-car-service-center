# GarageAI — Royal Car Service Center

GarageAI is a responsive garage management app focused on the internal garage operations workspace for Royal Car Service Center. Customer and vehicle records remain available internally for service history, work orders, billing, and communications; there is no customer-facing portal in the launch scope.

Garage profile:

- Royal Car Service Center
- 73, Dasarahalli Main Road, Mariyannapalya, Nagavara, Bengaluru, Karnataka 560024
- Phone: 09535666858
- WhatsApp: 9880131114
- Hours: Monday–Saturday 9:30 AM–9:00 PM; Sunday 9:30 AM–1:30 PM
- Payments: Cash and UPI, in INR
- Slogan: Expert care every drive

## Run locally

```bash
python3 server.py
```

Open `http://localhost:4173`.

The preview server binds to `0.0.0.0` so it can run in a hosted preview environment.

## Current milestone: Backend foundation

`server.py` serves the front-end and exposes a small REST API backed by `garageai.db`.
The database is initialized and seeded on first run. The app now starts behind a role-aware login screen.

Demo accounts:

- Owner: Shiva Rajkumara R — `owner` / `garage123`
- Advisor: Sandhesh — `advisor` / `advisor123`

Mechanics and workshop staff do not require phone logins in the current delivery; the owner and advisor manage their work orders from the operations workspace.

### Endpoints

- `GET /api/health`
- `GET /api/summary`
- `GET /api/work-orders`
- `GET /api/work-orders/:id`
- `POST /api/work-orders`
- `PATCH /api/work-orders/:id`
- `GET /api/work-orders/:id/media`
- `POST /api/work-orders/:id/media`
- `PATCH /api/appointments/:id`
- `PATCH /api/inventory/:id`
- `PATCH /api/invoices/:id`
- `GET /api/customers`
- `POST /api/customers`
- `GET /api/vehicles`
- `POST /api/vehicles`
- `GET /api/appointments`
- `POST /api/appointments`
- `GET /api/inventory`
- `POST /api/inventory`
- `GET /api/invoices`
- `POST /api/invoices`
- `POST /api/estimates/:work_order_id/approve`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `GET /api/integrations`
- `POST /api/integrations/test`
- `GET /api/marketing/status`
- `GET /api/marketing/posts`
- `POST /api/marketing/generate`
- `POST /api/marketing/connect`
- `POST /api/marketing/posts/:id/approve`
- `POST /api/marketing/posts/:id/publish`
- `POST /api/integrations/connect`
- `GET /api/notifications`
- `GET /api/notifications/metrics`
- `POST /api/notifications/queue`
- `POST /api/notifications/send`
- `POST /api/notifications/retry/:id`
- `POST /api/notifications/run-scheduler`
- `POST /api/payments/checkout`
- `POST /api/vehicle/decode`
- `POST /api/suppliers/search`
- `POST /api/accounting/export`
- `POST /api/accounting/sync`
- `GET /api/reports/financial`
- `POST /api/reports/close-day`
- `POST /api/assistant`
- `GET /api/audit-log`

All mutations write to an audit log. The UI currently consumes live work-order data from the API and persists newly created work orders, appointments, customers, and parts when the API is available.

Marketing Studio creates AI-assisted drafts from garage topics, supports language/format/CTA choices, and keeps owner approval ahead of scheduling or publishing. The current connector endpoints intentionally return setup status until Meta professional/Page access and YouTube OAuth credentials are configured; the app does not claim live social publishing in the demo environment.

## File map

- `index.html` — application shell
- `styles.css` — responsive UI styles
- `app.js` — views, interactions, demo flows, and API client calls
- `server.py` — SQLite/PostgreSQL-compatible schema, seed data, REST API, and static-file server
- `schema.sql` — PostgreSQL production schema
- `migrate_postgres.py` — PostgreSQL migration command
- `backup.py` — SQLite/PostgreSQL backup utility
- `tests/test_api.py` — API integration test suite
- `Dockerfile`, `docker-compose.yml`, `entrypoint.sh` — deployment assets
- `garageai.db` — local development database created by `server.py`

## QA and deployment

Run the automated API suite:

```bash
python -m unittest discover -s tests -v
```

Create a local backup:

```bash
python backup.py
```

Run the PostgreSQL production stack:

```bash
cp .env.example .env
# Change the database password and provider credentials.
docker compose up --build
```

`entrypoint.sh` applies the PostgreSQL schema before starting the API when `DATABASE_URL` is configured. The Docker deployment includes a PostgreSQL health check and persistent database volume.

## Planned next milestones

1. Production provider credentials and webhook verification
2. Custom domain, HTTPS, monitoring, and alerting
3. Pilot onboarding, data import, and staff training
