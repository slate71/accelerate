import numpy as np
import pandas as pd
from typing import List, Tuple
from datetime import datetime
import logging
from .models import AccelerationResponse

logger = logging.getLogger(__name__)

class AccelerationDetector:
    """
    Acceleration detection engine for team velocity metrics.

    This class implements the core algorithm for detecting acceleration trends
    in team velocity using exponential smoothing and derivative calculations.
    """

    def __init__(self, min_data_points: int = 7, confidence_threshold: float = 0.7):
        """
        Initialize the acceleration detector.

        Args:
            min_data_points: Minimum number of data points required for calculation
            confidence_threshold: Threshold for high confidence classification
        """
        self.min_data_points = min_data_points
        self.confidence_threshold = confidence_threshold

    def calculate_acceleration(
        self,
        timestamps: List[datetime],
        throughput_values: List[float],
        smoothing_alpha: float = 0.3
    ) -> AccelerationResponse:
        """
        Calculate acceleration metrics from time-series throughput data.

        Args:
            timestamps: List of timestamps for each data point
            throughput_values: List of throughput metrics (e.g., PRs per day)
            smoothing_alpha: Exponential smoothing parameter (0-1)

        Returns:
            AccelerationResponse with calculated metrics
        """

        if len(timestamps) < self.min_data_points:
            raise ValueError(f"Need at least {self.min_data_points} data points, got {len(timestamps)}")

        if len(timestamps) != len(throughput_values):
            raise ValueError("Timestamps and throughput values must have same length")

        # Convert to pandas for easier handling
        df = pd.DataFrame({
            'timestamp': timestamps,
            'throughput': throughput_values
        }).sort_values('timestamp')

        # Remove any NaN values
        df = df.dropna()

        logger.info(f"Processing {len(df)} data points for acceleration calculation")

        # Apply exponential smoothing to reduce noise
        velocity_history = self._apply_exponential_smoothing(df['throughput'].values, smoothing_alpha)

        # Calculate acceleration (second derivative)
        acceleration_history = self._calculate_acceleration(velocity_history)

        # Get current values
        current_velocity = velocity_history[-1] if len(velocity_history) > 0 else 0.0
        current_acceleration = acceleration_history[-1] if len(acceleration_history) > 0 else 0.0

        # Classify trend and calculate confidence
        trend, confidence = self._classify_trend(acceleration_history)

        return AccelerationResponse(
            current_velocity=current_velocity,
            current_acceleration=current_acceleration,
            trend=trend,
            confidence=confidence,
            velocity_history=velocity_history.tolist(),
            acceleration_history=acceleration_history.tolist()
        )

    def _apply_exponential_smoothing(self, values: np.ndarray, alpha: float) -> np.ndarray:
        """
        Apply exponential smoothing to reduce noise in the data.

        Args:
            values: Raw throughput values
            alpha: Smoothing parameter (0-1, higher = more responsive)

        Returns:
            Smoothed values array
        """
        if len(values) == 0:
            return np.array([])

        smoothed = np.zeros_like(values, dtype=float)
        smoothed[0] = values[0]

        for i in range(1, len(values)):
            smoothed[i] = alpha * values[i] + (1 - alpha) * smoothed[i-1]

        return smoothed

    def _calculate_acceleration(self, velocity: np.ndarray) -> np.ndarray:
        """
        Calculate acceleration (second derivative) from velocity data.

        Args:
            velocity: Smoothed velocity values

        Returns:
            Acceleration values (second derivative)
        """
        if len(velocity) < 3:
            return np.array([0.0] * len(velocity))

        # Calculate first derivative (change in velocity)
        first_derivative = np.gradient(velocity)

        # Calculate second derivative (acceleration)
        acceleration = np.gradient(first_derivative)

        return acceleration

    def _classify_trend(self, acceleration_history: np.ndarray) -> Tuple[str, float]:
        """
        Classify the acceleration trend and calculate confidence.

        Args:
            acceleration_history: Array of acceleration values

        Returns:
            Tuple of (trend_classification, confidence_score)
        """
        if len(acceleration_history) < 3:
            return "stable", 0.5

        # Look at recent acceleration values (last 7 days or half the data, whichever is smaller)
        recent_window = min(7, len(acceleration_history) // 2)
        recent_accel = acceleration_history[-recent_window:]

        # Calculate mean and standard deviation of recent acceleration
        mean_accel = np.mean(recent_accel)
        std_accel = np.std(recent_accel)

        # Calculate confidence based on consistency of trend
        # Higher std = lower confidence (more noise)
        if std_accel == 0:
            confidence = 1.0
        else:
            # Normalize confidence based on signal-to-noise ratio
            signal_to_noise = abs(mean_accel) / (std_accel + 1e-6)
            confidence = min(1.0, signal_to_noise / 2.0)

        # Classify trend based on mean acceleration
        threshold = 0.1  # Acceleration threshold for classification

        if mean_accel > threshold:
            trend = "improving"
        elif mean_accel < -threshold:
            trend = "declining"
        else:
            trend = "stable"

        # Boost confidence for clear trends
        if abs(mean_accel) > threshold * 2:
            confidence = min(1.0, confidence * 1.2)

        logger.info(f"Trend classification: {trend}, confidence: {confidence:.3f}, mean_accel: {mean_accel:.3f}")

        return trend, round(confidence, 3)