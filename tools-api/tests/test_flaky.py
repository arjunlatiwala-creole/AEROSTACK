import random
import time
import pytest

def test_api_latency_simulation():
    """
    Intentionally flaky test to trigger pipeline failures.
    Simulates a race condition or external API timeout.
    """
    time.sleep(random.uniform(0.1, 0.5))
    
    # Fails ~50% of the time to create pipeline instability
    success = random.choice([True, False])
    
    assert success, "Connection refused: external service mock timeout"
