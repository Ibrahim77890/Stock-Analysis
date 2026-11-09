-- One-time, idempotent setup of the application role and database on a local PostgreSQL.
-- Run as the postgres superuser (from services/market-data):
--     uv run poe db-init
-- or manually:
--     sudo -u postgres psql -v pw=YOUR_PASSWORD -f scripts/db/db_init.sql
-- Safe to run again: nothing is dropped or overwritten.

SELECT format('CREATE ROLE marketlab LOGIN PASSWORD %L', :'pw')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'marketlab')
\gexec

SELECT 'CREATE DATABASE marketlab OWNER marketlab'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'marketlab')
\gexec
