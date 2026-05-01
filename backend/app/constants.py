"""Shared constants used across multiple routers."""
import re

# Warehouse rack location format. Matches "AV-01", "AVG-12", etc.
# Distinct from bundle_code format ("AV-0001" / "AVG-0001").
LOCATION_RE = re.compile(r"^(AV|AVG)-\d{1,3}$", re.IGNORECASE)
