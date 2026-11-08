# ADR 0002: PostgreSQL only, with schemas by owner

Status: accepted (Sprint 01); benchmark evidence pending (task 01_09)

## Context
The expected data size (about 12.6M daily rows, tens of millions at most) does not justify more infrastructure (blueprint 24).

## Decision
One PostgreSQL 18 instance. Schema `market` is owned and migrated only by the Python service (Alembic, hand-written SQL migrations); schema `app` will be owned by NestJS later. No Kafka, ClickHouse, Redis or Docker.

## Alternatives
DuckDB or ClickHouse for analytics; one shared schema.

## Consequences
Revisit only if the 01_09 benchmark shows the primary-key index is insufficient (partitioning/BRIN are decided there). Until the benchmark is run on a real machine, this decision rests on the blueprint's estimate, not on a measurement.
