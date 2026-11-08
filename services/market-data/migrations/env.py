"""Alembic environment for the `market` schema.

Conventions:
* The database URL comes from the DATABASE_URL environment variable
  (loaded from the repository's .env file when present).
* Migrations are written by hand (no autogenerate), so target_metadata is None.
* Alembic's own bookkeeping table lives in the `market` schema, so this
  service never touches other services' schemas (e.g. `app`, owned by NestJS).
"""

import os
from logging.config import fileConfig

from alembic import context
from dotenv import find_dotenv, load_dotenv
from sqlalchemy import create_engine, pool, text

SCHEMA = "market"

load_dotenv(find_dotenv())

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = None


def get_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError(
            "DATABASE_URL is not set. Copy .env.example to .env at the repository "
            "root (or export DATABASE_URL) before running migrations."
        )
    # SQLAlchemy needs the driver name; we use psycopg 3.
    for prefix in ("postgresql://", "postgres://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


def _configure(**kwargs) -> None:
    context.configure(
        target_metadata=target_metadata,
        version_table="alembic_version",
        version_table_schema=SCHEMA,
        transaction_per_migration=True,
        **kwargs,
    )


def run_migrations_offline() -> None:
    """Emit SQL to stdout instead of executing it (`poe migration-sql`)."""
    _configure(url=get_url(), literal_binds=True, dialect_opts={"paramstyle": "named"})
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = create_engine(get_url(), poolclass=pool.NullPool)
    with engine.connect() as connection:
        # The version table lives in this schema, so it must exist first.
        connection.execute(text(f"CREATE SCHEMA IF NOT EXISTS {SCHEMA}"))
        connection.commit()

        _configure(connection=connection)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
