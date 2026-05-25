"""
MatAnyone stub service.

MatAnyone provides high-quality alpha matting, especially for hair / semi-transparent edges.
This module is a placeholder — enable it once MatAnyone is installed.

Reference: https://github.com/pq-yang/MatAnyone
"""

import logging
import numpy as np
from PIL import Image

logger = logging.getLogger(__name__)

_matanyone_available = False


def is_available() -> bool:
    """Check whether MatAnyone is installed."""
    return _matanyone_available


def refine_mask(
    frame_path: str,
    coarse_mask: np.ndarray
) -> np.ndarray:
    """
    Refine a coarse binary mask using MatAnyone alpha matting.

    Args:
        frame_path:   Path to original RGB frame (JPEG).
        coarse_mask:  Binary mask uint8 (H, W), 0=bg 255=fg.

    Returns:
        Refined alpha matte as uint8 (H, W), 0-255.
    """
    if not _matanyone_available:
        logger.debug("MatAnyone not available — returning coarse mask unchanged.")
        return coarse_mask

    # Future: call MatAnyone inference here
    raise NotImplementedError("MatAnyone integration pending.")
