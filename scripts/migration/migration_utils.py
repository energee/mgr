"""
Shared utilities for MongoDB-to-PostgreSQL migration scripts.

Provides deterministic UUID generation, BSON collection loading,
and SQL string escaping.
"""
import bson
import gzip
import uuid
from pathlib import Path
from typing import Any, Optional


# Custom namespace UUID for deterministic migration IDs (uuid5)
MIGRATION_NAMESPACE = uuid.UUID("a1b2c3d4-e5f6-7890-abcd-ef1234567890")


def object_id_to_uuid(object_id_str: str) -> str:
    """Generate a deterministic UUID v5 from a MongoDB ObjectID.

    Uses uuid5 (SHA-1 based, RFC 4122 compliant) with a fixed
    migration namespace so the same ObjectID always maps to the
    same UUID.
    """
    return str(uuid.uuid5(MIGRATION_NAMESPACE, object_id_str))


def load_collection(backup_dir: Path, name: str) -> list[dict[str, Any]]:
    """Load and decode a gzipped BSON collection from a MongoDB backup."""
    with gzip.open(f"{backup_dir}/{name}.bson.gz", "rb") as f:
        data = f.read()
    return bson.decode_all(data)


def escape_sql_string(s: Optional[str]) -> Optional[str]:
    """Escape a string for safe inclusion in a SQL literal.

    Handles single quotes, backslashes, NULL bytes, and newlines
    to prevent SQL injection and syntax errors in generated SQL files.
    """
    if s is None:
        return None
    return (
        str(s)
        .replace("\\", "\\\\")
        .replace("'", "''")
        .replace("\0", "")
        .replace("\n", "\\n")
        .replace("\r", "")
    )
